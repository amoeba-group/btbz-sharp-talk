import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, LessThanOrEqual, Repository } from 'typeorm';
import { CONVERSATION_STATUS } from '@sharptalk/types';
import { Conversation } from '../chat/entity/conversation.entity';
import { AuditService } from '../audit/audit.service';
import { HandoffRouterService } from '../ai-engine/handoff-router.service';
import type { RoutingPolicy } from '../ai-engine/handoff-router.service';
import { AgentAlertService } from './agent-alert.service';
import {
  UNCLAIMED_PAGES_HARD_CAP,
  planUnclaimedPage,
  unclaimedMaxPages,
  unclaimedMinutes,
} from './unclaimed-plan.util';
import { envNumber } from '../../global/util/env-number.util';
import { isCliContext } from '../../global/util/cli-context.util';

/** How often the sweep looks. The wait limit itself is ALERT_UNCLAIMED_MINUTES. */
const SWEEP_INTERVAL_ENV = 'ALERT_UNCLAIMED_SWEEP_SEC';
const SWEEP_INTERVAL_DEFAULT_SEC = 30;
/** Conversations handled per sweep, so a backlog cannot stall the tick. */
const BATCH = 200;

/**
 * "Nobody has taken this conversation" re-alert (PLN-261012 SG-63, REQ D-10).
 *
 * A targeted alert is visible only to the agent it is addressed to, and a plain alert
 * is easy to dismiss — so a customer who asked for a person could wait with nobody
 * ever looking. Every `ALERT_UNCLAIMED_SWEEP_SEC` seconds (default 30) this finds conversations that are WAITING,
 * unclaimed (no agent) and have been for `ALERT_UNCLAIMED_MINUTES` (default 5), and raises
 * a fresh broadcast alert plus an "UNCLAIMED" Slack/email text (AgentAlertService.pageUnclaimed).
 *
 * De-dupe and cap live on the conversation row (`unclaimed_pages`, `unclaimed_paged_at`),
 * not in memory: a restart, or a second API instance sweeping at the same moment, cannot
 * page twice — the page slot is taken with a conditional UPDATE that only one writer wins.
 * A page is due one interval after the previous one, never on every tick, and at most
 * `ALERT_UNCLAIMED_MAX_PAGES` (default 3) are sent per waiting spell.
 *
 * Only tenants where it can matter are swept (RoutingPolicy.unclaimedAlerts): by default
 * those with assignees, team routing or region routing configured, or that switched it on
 * explicitly; a tenant with no hand-off config is untouched. Off-hours threads that wait
 * on an email reply (`reply_channel = 'email'`) are not swept either — nobody is on shift
 * to take them, and a page at 3 a.m. would only train people to ignore it.
 */
@Injectable()
export class UnclaimedSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(UnclaimedSweepService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    private readonly alerts: AgentAlertService,
    private readonly router: HandoffRouterService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    // A one-off CLI must not run a second copy of this scheduler (PLN-261008 D2).
    if (isCliContext()) return;
    const minutes = unclaimedMinutes();
    if (minutes <= 0) {
      this.logger.warn('Unclaimed-conversation alert sweep DISABLED (ALERT_UNCLAIMED_MINUTES=0)');
      return;
    }
    const sec = envNumber(SWEEP_INTERVAL_ENV, SWEEP_INTERVAL_DEFAULT_SEC);
    const every = Number.isFinite(sec) && sec > 0 ? sec : SWEEP_INTERVAL_DEFAULT_SEC;
    this.logger.log(
      `Unclaimed sweep every ${every}s — re-alert after ${minutes} min, at most ${unclaimedMaxPages()} pages per conversation`,
    );
    this.timer = setInterval(() => void this.sweep(), every * 1000);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass. `nowMs` is injectable so tests can run the clock by hand. */
  async sweep(nowMs = Date.now()): Promise<{ paged: number; considered: number }> {
    const result = { paged: 0, considered: 0 };
    if (this.running) return result;
    const minutes = unclaimedMinutes();
    if (minutes <= 0) return result;
    this.running = true;
    try {
      const maxPages = unclaimedMaxPages();
      const cutoff = new Date(nowMs - minutes * 60_000);
      const base = {
        status: CONVERSATION_STATUS.WAITING,
        agentId: IsNull(),
        replyChannel: IsNull(),
        unclaimedPages: LessThan(UNCLAIMED_PAGES_HARD_CAP),
      };
      // Never paged yet and waiting long enough, or paged before and a full interval ago.
      const candidates = await this.convRepo.find({
        where: [
          { ...base, unclaimedPagedAt: IsNull(), escalatedAt: LessThanOrEqual(cutoff) },
          { ...base, unclaimedPagedAt: LessThanOrEqual(cutoff) },
        ],
        order: { escalatedAt: 'ASC' },
        take: BATCH,
      });
      if (candidates.length >= BATCH) this.logger.warn(`unclaimed sweep: ${BATCH} candidates, the rest wait for the next tick`);

      const policies = new Map<number, RoutingPolicy | null>();
      for (const conv of candidates) {
        result.considered += 1;
        if (conv.tenantId == null || !conv.escalatedAt) continue;
        const tenantId = Number(conv.tenantId);
        if (!policies.has(tenantId)) {
          policies.set(tenantId, await this.router.routingPolicy(tenantId).catch((e: Error) => {
            this.logger.warn(`unclaimed sweep: routing policy failed (tenant ${tenantId}): ${e.message}`);
            return null;
          }));
        }
        const policy = policies.get(tenantId);
        if (!policy?.unclaimedAlerts) continue;

        const plan = planUnclaimedPage({
          nowMs,
          escalatedAtMs: new Date(conv.escalatedAt).getTime(),
          pagedAtMs: conv.unclaimedPagedAt ? new Date(conv.unclaimedPagedAt).getTime() : null,
          pages: Number(conv.unclaimedPages ?? 0),
          intervalMin: minutes,
          maxPages,
          strict: policy.regionMode === 'strict' && !!conv.supportRegion,
          widenAfterMin: policy.widenAfterMinutes,
        });
        if (!plan.page) continue;

        // Take the page slot: only one writer wins this UPDATE, and it fails when the
        // conversation was claimed (or paged by another instance) since it was read.
        const claimed = await this.convRepo.update(
          { id: conv.id, status: CONVERSATION_STATUS.WAITING, agentId: IsNull(), unclaimedPages: Number(conv.unclaimedPages ?? 0) },
          { unclaimedPages: Number(conv.unclaimedPages ?? 0) + 1, unclaimedPagedAt: new Date(nowMs) },
        );
        if (!claimed.affected) continue;

        const waitedMin = Math.max(1, Math.round((nowMs - new Date(conv.escalatedAt).getTime()) / 60_000));
        const alert = await this.alerts.pageUnclaimed(conv, {
          attempt: plan.attempt,
          maxPages: plan.cap,
          waitedMin,
          scopeRegion: plan.crossRegion ? null : (conv.supportRegion ?? null),
          crossRegion: plan.crossRegion,
        });
        if (!alert) continue;
        result.paged += 1;
        await this.audit
          .write({
            tenantId,
            // Nobody clicked anything: a machine's decision must not sit under a person's name.
            actorType: 'system',
            actorId: 0,
            action: 'alert.unclaimed_paged',
            target: `conversation:${conv.id}`,
            metadata: { attempt: plan.attempt, crossRegion: plan.crossRegion, waitedMin },
          })
          .catch((e: Error) => this.logger.warn(`unclaimed audit failed: ${e.message}`));
      }
      if (result.paged) this.logger.log(`unclaimed sweep: paged ${result.paged} of ${result.considered} candidate(s)`);
      return result;
    } catch (e) {
      this.logger.warn(`unclaimed sweep failed: ${(e as Error).message}`);
      return result;
    } finally {
      this.running = false;
    }
  }
}
