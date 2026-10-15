import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
import { CONVERSATION_STATUS } from '@sharptalk/types';
import { AgentAlert } from './entity/agent-alert.entity';
import { AgentAlertService } from './agent-alert.service';
import { TenantAiConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { isCliContext } from '../../global/util/cli-context.util';

/** Sweep cadence. A minute is the finest reminder delay the console offers. */
const SWEEP_MS = 60_000;
/** Upper bound on one pass, so a backlog after downtime cannot stall the loop. */
const BATCH = 200;

/**
 * "Nobody has picked this up" reminder (PLN-261015 D4).
 *
 * A paged agent can be away from the console. After the tenant's
 * `handoff_config.reAlert.afterMinutes`, an alarm that is still unacknowledged
 * on a conversation that is still waiting is mailed again to the same agents,
 * and the escalation lead (`escalateToUserIds`) is paged as well. Each
 * conversation is reminded once: `reminded_at` is stamped on all its rows.
 *
 * Tenants without `reAlert` are never touched, so this is inert until a tenant
 * turns it on.
 */
@Injectable()
export class AgentAlertReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentAlertReminderService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectRepository(AgentAlert) private readonly alertRepo: Repository<AgentAlert>,
    @InjectRepository(TenantAiConfig) private readonly configRepo: Repository<TenantAiConfig>,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    private readonly alerts: AgentAlertService,
  ) {}

  onModuleInit(): void {
    // A one-off CLI must not run a second copy of this scheduler (PLN-261008 D2).
    if (isCliContext()) return;
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass. Returns how many conversations were reminded (for tests/logs). */
  async sweep(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const configs = await this.configRepo.find({
        where: { handoffConfig: Not(IsNull()) },
        select: { id: true, tenantId: true, handoffConfig: true },
      });
      let reminded = 0;
      for (const cfg of configs) {
        const re = cfg.handoffConfig?.reAlert;
        const minutes = Number(re?.afterMinutes);
        if (cfg.tenantId == null || !Number.isFinite(minutes) || minutes <= 0) continue;
        reminded += await this.sweepTenant(Number(cfg.tenantId), minutes, re?.escalateToUserIds ?? [], now);
      }
      if (reminded) this.logger.log(`alarm reminders sent for ${reminded} conversation(s)`);
      return reminded;
    } catch (e) {
      this.logger.warn(`alarm reminder sweep failed: ${(e as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async sweepTenant(tenantId: number, minutes: number, leads: number[], now: Date): Promise<number> {
    const due = await this.alertRepo.find({
      where: {
        tenantId,
        status: 'new',
        remindedAt: IsNull(),
        createdAt: LessThanOrEqual(new Date(now.getTime() - minutes * 60_000)),
      },
      order: { id: 'ASC' },
      take: BATCH,
    });
    if (!due.length) return 0;

    const byConversation = new Map<number, AgentAlert[]>();
    for (const row of due) {
      const key = Number(row.conversationId);
      byConversation.set(key, [...(byConversation.get(key) ?? []), row]);
    }
    const waiting = new Set(
      (
        await this.convRepo.find({
          where: { tenantId, id: In([...byConversation.keys()]), status: CONVERSATION_STATUS.WAITING },
          select: { id: true },
        })
      ).map((c) => Number(c.id)),
    );

    let reminded = 0;
    for (const [conversationId, rows] of byConversation) {
      // Stamp first: a mail failure must not turn into a mail every minute.
      await this.alertRepo.update(
        { tenantId, conversationId, status: 'new', remindedAt: IsNull() },
        { remindedAt: now },
      );
      // Accepted or ended meanwhile (the alarm was simply never clicked) —
      // nothing to remind anyone about.
      if (!waiting.has(conversationId)) continue;

      await this.alerts.notifyRows(rows, { reminder: true });
      const paged = new Set(rows.map((r) => (r.targetUserId != null ? Number(r.targetUserId) : null)));
      const leadIds = [...new Set(leads.map(Number).filter((id) => Number.isFinite(id) && !paged.has(id)))];
      if (leadIds.length) {
        const first = rows[0];
        const leadRows = await this.alertRepo.save(
          leadIds.map((targetUserId) =>
            this.alertRepo.create({
              tenantId,
              conversationId,
              sessionId: first.sessionId,
              reason: first.reason,
              preview: first.preview,
              targetUserId,
              status: 'new',
              // Already a reminder — the lead must not be reminded again.
              remindedAt: now,
            }),
          ),
        );
        await this.alerts.notifyRows(leadRows, { reminder: true });
      }
      reminded += 1;
    }
    return reminded;
  }
}
