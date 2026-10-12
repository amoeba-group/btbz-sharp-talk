import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Or, Repository } from 'typeorm';
import { AgentAlert } from './entity/agent-alert.entity';
import { AgentProfile } from './entity/agent-profile.entity';
import { Assignment } from './entity/assignment.entity';
import { JobLabel } from '../user/entity/job-label.entity';
import { UserJobLabel } from '../user/entity/user-job-label.entity';
import { User } from '../user/entity/user.entity';
import { JOB_LABEL } from '@sharptalk/types';
import { EventBusService, EVENTS, MailerService } from '../../infrastructure/infrastructure.module';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import {
  isPresent,
  PRESENCE_TOUCH_THROTTLE_SEC,
  PROFILE_STATUS_ONLINE,
  presenceTtlSec,
} from '../../global/util/presence.util';

interface EscalationPayload {
  tenantId?: number;
  conversationId?: number;
  sessionId?: number | null;
  reason?: string;
  preview?: string;
  /** Agents to address the alert to (PLN-AiSetting W3). Empty/omitted = broadcast. */
  targetUserIds?: number[];
  /** Set when routing decided this is an off-hours handoff: mail, don't page. */
  offHoursEmail?: string;
  /** Label routing (P2, 결정 4): narrow the alarm to this label's available agents. */
  issueLabel?: string;
  /** Signed partner context, one line (REQ-261006 H4): "Hotel (hotelSn) · role". */
  partnerLabel?: string;
  /** Team the customer picked (PLN-261007 Team Routing) — wording for the channels. */
  supportLabel?: string;
  /**
   * Regional team (north | south) of the hotel (PLN-261007 Hotel Region Routing):
   * the alarm prefers agents of that team. `regionLabel` is the channel wording.
   */
  supportRegion?: string;
  regionLabel?: string;
  /** Region routing is on but the hotel's province is not in the table (PLN-261012 SG-61). */
  regionUnmapped?: string;
}

/** The extra lines an alert text carries beyond the reason and the preview. */
export interface AlertContext {
  /** Signed partner line (REQ-261006 H4). */
  partnerLabel?: string;
  /** Team the customer picked (PLN-261007 Team Routing). */
  teamLabel?: string;
  /** Regional team of the hotel (PLN-261007 Hotel Region Routing). */
  regionLabel?: string;
  /** The province the table did not list; shown as "Region: ? (unmapped: …)" (PLN-261012 SG-61). */
  regionUnmapped?: string;
}

/** `users.status` of someone who can take a conversation (the others are suspended / invited). */
const USER_STATUS_ACTIVE = 'active';

/**
 * "? (unmapped: Tp Quy Nhơn)" for a province the table does not list, or '' when
 * there is none. The province is signed partner data, but it is still free text
 * on its way into a Slack line and a mail body: one line, bounded.
 */
function unmappedRegion(province?: string): string {
  const clean = (province ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  return clean ? `? (unmapped: ${clean})` : '';
}

const REASON_LABEL: Record<string, string> = {
  low_confidence: 'AI could not answer from the knowledge base',
  moderation_blocked: 'AI reply blocked by moderation',
  user_request: 'Customer asked for a human agent',
  policy: 'Policy deny-list — forced human handling',
};

/**
 * Escalation alarm fan-out (FR-S3, PLAN-Scenario-Handoff-Alert §3.3).
 * Subscribes to EVENTS.ESCALATION and (1) stores an agent_alerts row for the
 * console alarm modal, (2) posts to a Slack incoming webhook, (3) sends an
 * email via SMTP. Slack/email are best-effort and individually isolated —
 * the DB alert is always written first. Channels are disabled when their env
 * config is empty (dev default).
 */
@Injectable()
export class AgentAlertService implements OnModuleInit {
  private readonly logger = new Logger(AgentAlertService.name);

  constructor(
    @InjectRepository(AgentAlert) private readonly alertRepo: Repository<AgentAlert>,
    @InjectRepository(JobLabel) private readonly labelRepo: Repository<JobLabel>,
    @InjectRepository(UserJobLabel) private readonly userLabelRepo: Repository<UserJobLabel>,
    @InjectRepository(AgentProfile) private readonly profileRepo: Repository<AgentProfile>,
    @InjectRepository(Assignment) private readonly assignmentRepo: Repository<Assignment>,
    private readonly bus: EventBusService,
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
    // Appended last so positional test doubles that predate it stay valid; it is
    // only read when a regional team is asked for (PLN-261007).
    @InjectRepository(User) private readonly userRepo?: Repository<User>,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe(EVENTS.ESCALATION, async (payload: unknown) => {
      await this.onEscalation((payload ?? {}) as EscalationPayload);
    });
  }

  async onEscalation(payload: EscalationPayload): Promise<void> {
    if (!payload.conversationId) return;
    // Idempotency (at-least-once bus): skip if an un-acked alert already exists
    // for this conversation with the same reason.
    const existing = await this.alertRepo.findOne({
      where: {
        tenantId: payload.tenantId ?? IsNull(),
        conversationId: payload.conversationId,
        reason: payload.reason ?? 'user_request',
        status: 'new',
      },
    });
    // Label routing (P2, PLN-261007): an explicit label — a deny rule's stamp
    // or the team the customer just picked — outranks the tenant's general
    // assignee list, since it says who this conversation is FOR. Least-loaded
    // available agent holding the label; nobody online → the configured
    // assignee; none → NULL, i.e. the pre-P2 broadcast (alarms never drop).
    //
    // A hotel's regional team (PLN-261007 Hotel Region Routing) narrows the same
    // search: same label AND same region, then nationwide staff with the label.
    // With a region but no label (an AI-triggered hand-off) the label is consult,
    // the one that handles conversations.
    let targetUserId: number | null = null;
    const label = payload.issueLabel ?? (payload.supportRegion ? JOB_LABEL.CONSULT : undefined);
    if (label && payload.tenantId) {
      targetUserId = await this.pickLabelAgent(payload.tenantId, label, payload.supportRegion);
    }
    if (targetUserId == null) targetUserId = payload.targetUserIds?.[0] ?? null;
    const alert =
      existing ??
      (await this.alertRepo.save(
        this.alertRepo.create({
          tenantId: payload.tenantId ?? null,
          conversationId: payload.conversationId,
          sessionId: payload.sessionId ?? null,
          reason: payload.reason ?? 'user_request',
          preview: payload.preview?.slice(0, 300) ?? null,
          // One row per addressed agent would duplicate the alarm, so a single
          // row carries the first assignee; the console filters on it and NULL
          // keeps the historical broadcast behaviour.
          targetUserId,
          status: 'new',
        }),
      ));
    if (existing) return; // channels already notified for this escalation
    const ctx: AlertContext = {
      partnerLabel: payload.partnerLabel,
      teamLabel: payload.supportLabel,
      regionLabel: payload.regionLabel,
      regionUnmapped: payload.regionUnmapped,
    };

    // Off hours: the shopper has already been told to expect an email, so the
    // summary goes to the configured mailbox instead of paging the on-call
    // channels (PLN-AiSetting W3).
    if (payload.offHoursEmail) {
      await this.notifyEmail(alert, payload.offHoursEmail, ctx);
      return;
    }
    await Promise.allSettled([this.notifySlack(alert, ctx), this.notifyEmail(alert, undefined, ctx)]);
  }

  /**
   * Least-loaded available agent holding the label (P2, 결정 4): an ACTIVE user (not
   * suspended or invited) with a present profile — on duty and seen lately,
   * PLN-261012 SG-60 — whose active assignments are under maxConcurrent. Null →
   * broadcast fallback.
   *
   * With a `region` (PLN-261007 Hotel Region Routing) the search runs in two
   * rounds, so the hotel's own regional team is always asked first: staff of that
   * region, then nationwide staff (`users.region` empty) who hold the label. Staff
   * of the OTHER region are never picked here; when neither round finds anyone the
   * caller falls back to the configured assignee and then the broadcast, so the
   * conversation is never left unseen.
   */
  private async pickLabelAgent(
    tenantId: number,
    labelCode: string,
    region?: string,
  ): Promise<number | null> {
    try {
      const labelRows = await this.labelRepo.find({ where: { tenantId, code: labelCode } });
      if (!labelRows.length) return null;
      const links = await this.userLabelRepo.find({
        where: { jobLabelId: In(labelRows.map((l) => Number(l.id))) },
      });
      const userIds = [...new Set(links.map((l) => Number(l.userId)))];
      if (!userIds.length) return null;
      // Real user statuses are active / suspended / invited (PLN-261012 SG-65, D-11):
      // only 'active' can take a conversation, in BOTH branches below. (The filter
      // used to read `!== 'inactive'`, a status no user has, so a suspended agent
      // was still paged — and the no-region branch had no check at all.) A test
      // double built without the user repository cannot say, so it is not filtered.
      if (!this.userRepo) return await this.leastLoadedOnline(tenantId, userIds);
      const users = await this.userRepo.find({
        where: { tenantId, id: In(userIds) },
        select: { id: true, region: true, status: true },
      });
      const active = users.filter((u) => u.status === USER_STATUS_ACTIVE);
      if (!region) return await this.leastLoadedOnline(tenantId, active.map((u) => Number(u.id)));
      const ofRegion = active.filter((u) => u.region === region).map((u) => Number(u.id));
      const nationwide = active.filter((u) => u.region == null).map((u) => Number(u.id));
      return (
        (await this.leastLoadedOnline(tenantId, ofRegion)) ??
        (await this.leastLoadedOnline(tenantId, nationwide))
      );
    } catch (e) {
      this.logger.warn(`label routing failed (${labelCode}): ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * The present agent under their concurrency cap with the lowest load; ties go to
   * the lowest user id, so the same inputs always page the same person.
   *
   * Present = on duty AND polled the console within AGENT_PRESENCE_TTL_SEC
   * (PLN-261012 SG-60): a profile left on 'online' by someone who closed the
   * console, or one that has no heartbeat at all, is not asked.
   *
   * Load = conversations they hold + alerts already addressed to them that nobody
   * has acknowledged (PLN-261012 SG-65, D-11). Without the second term, three
   * escalations in a row all went to the same agent because none had been accepted
   * yet. The cap still counts conversations only: a pending alert is not one.
   */
  private async leastLoadedOnline(tenantId: number, userIds: number[]): Promise<number | null> {
    if (!userIds.length) return null;
    const rows = await this.profileRepo.find({
      where: { tenantId, userId: In(userIds), status: PROFILE_STATUS_ONLINE },
    });
    const now = Date.now();
    const ttl = presenceTtlSec(this.config.get('AGENT_PRESENCE_TTL_SEC'));
    const profiles = rows.filter((p) => isPresent(p, now, ttl));
    let best: { userId: number; load: number } | null = null;
    for (const p of profiles) {
      const userId = Number(p.userId);
      const open = await this.assignmentRepo.count({ where: { tenantId, agentId: userId, status: 'active' } });
      if (open >= p.maxConcurrent) continue;
      const pending = await this.alertRepo.count({ where: { tenantId, targetUserId: userId, status: 'new' } });
      const load = open + pending;
      if (!best || load < best.load || (load === best.load && userId < best.userId)) best = { userId, load };
    }
    return best?.userId ?? null;
  }

  /**
   * Heartbeat (PLN-261012 SG-60): the console polls the alert feed about every 10 s,
   * and each poll by an on-duty agent stamps `agent_profiles.last_seen`. One UPDATE
   * that matches only an on-duty profile whose stamp is missing or older than the
   * throttle, so an idle poll costs no write and a user without a profile (or off
   * duty) is never touched. Never throws: presence must not break the alarm feed.
   */
  async touchPresence(userId: number, tenantId: number, nowMs = Date.now()): Promise<void> {
    if (!userId || !tenantId) return;
    try {
      await this.profileRepo.update(
        {
          tenantId,
          userId,
          status: PROFILE_STATUS_ONLINE,
          lastSeen: Or(IsNull(), LessThan(new Date(nowMs - PRESENCE_TOUCH_THROTTLE_SEC * 1000))),
        },
        { lastSeen: new Date(nowMs) },
      );
    } catch (e) {
      this.logger.warn(`presence touch failed (user ${userId}): ${(e as Error).message}`);
    }
  }

  /**
   * Broadcast alerts plus the ones addressed to this agent — always fenced to
   * the caller's tenant (REQ-260824 R2). A broadcast row is a broadcast within
   * its tenant, never across tenants.
   */
  async list(status: string, userId: number, tenantId: number): Promise<AgentAlert[]> {
    if (!tenantId) return []; // platform admins have no tenant alarm feed
    return this.alertRepo.find({
      where: [
        { status, tenantId, targetUserId: IsNull() },
        { status, tenantId, targetUserId: userId },
      ],
      order: { id: 'DESC' },
      take: 50,
    });
  }

  async ack(id: number, userId: number, tenantId: number): Promise<AgentAlert> {
    const alert = tenantId
      ? await this.alertRepo.findOne({ where: { id, tenantId } })
      : null;
    if (!alert) {
      // Same 404 whether the row is missing or belongs to another tenant, but
      // the cross-tenant attempt is worth a server-side trace (4xx are silent).
      this.logger.warn(`alert ack refused: id=${id} tenant=${tenantId} user=${userId}`);
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    if (alert.status === 'new') {
      alert.status = 'acked';
      alert.ackedBy = userId;
      alert.ackedAt = new Date();
      await this.alertRepo.save(alert);
    }
    return alert;
  }

  // ---- channels ----

  /**
   * One text for every channel. Each extra line is appended only when its input
   * exists: the partner line (REQ-261006 H4) when the escalating session carried
   * signed claims, the team line (PLN-261007) when the customer picked a team,
   * the region line (PLN-261007 Hotel Region Routing) when the hotel's province
   * resolved — or, when region routing is on and the province is not in the table,
   * "Region: ? (unmapped: <province>)" so the person paged sees why no regional
   * team was asked (PLN-261012 SG-61). Tenants with none of them get the exact text
   * they always got. Order is fixed: Reason, Team, Region, Partner, preview.
   */
  summary(alert: AgentAlert, ctx: AlertContext = {}): string {
    const reason = REASON_LABEL[alert.reason] ?? alert.reason;
    const line = (name: string, value?: string) => (value?.trim() ? `\n${name}: ${value.trim()}` : '');
    const preview = alert.preview ? `\n> ${alert.preview}` : '';
    return (
      `Chat escalation — conversation #${alert.conversationId}\nReason: ${reason}` +
      line('Team', ctx.teamLabel) +
      line('Region', ctx.regionLabel?.trim() ? ctx.regionLabel : unmappedRegion(ctx.regionUnmapped)) +
      line('Partner', ctx.partnerLabel) +
      preview
    );
  }

  /** Slack incoming webhook (SLACK_WEBHOOK_URL; empty = disabled). */
  private async notifySlack(alert: AgentAlert, ctx: AlertContext): Promise<void> {
    const url = this.config.get<string>('SLACK_WEBHOOK_URL');
    if (!url) return;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `:rotating_light: ${this.summary(alert, ctx)}` }),
      });
      if (!res.ok) this.logger.warn(`Slack alert failed: HTTP ${res.status}`);
    } catch (e) {
      this.logger.warn(`Slack alert failed: ${(e as Error).message}`);
    }
  }

  /** Escalation summary to the ops mailbox (or the off-hours override). */
  private async notifyEmail(alert: AgentAlert, overrideTo: string | undefined, ctx: AlertContext): Promise<void> {
    const to = overrideTo ?? this.config.get<string>('ALERT_EMAIL_TO');
    if (!to) return;
    await this.mailer.send({
      to,
      subject: `[IVY Chat] Escalation — conversation #${alert.conversationId}`,
      text: this.summary(alert, ctx),
    });
  }
}
