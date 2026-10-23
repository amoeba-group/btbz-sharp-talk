import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { AgentAlert } from './entity/agent-alert.entity';
import { AgentProfile } from './entity/agent-profile.entity';
import { Assignment } from './entity/assignment.entity';
import { JobLabel } from '../user/entity/job-label.entity';
import { UserJobLabel } from '../user/entity/user-job-label.entity';
import { User } from '../user/entity/user.entity';
import { Session } from '../session/entity/session.entity';
import { EventBusService, EVENTS, MailerService } from '../../infrastructure/infrastructure.module';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

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
  /**
   * Set when a region × topic rule chose the group (PLN-261015 D3):
   * least_loaded = one available agent, else the whole group; broadcast = the group.
   */
  assignMode?: string;
  ruleName?: string;
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
    // Personal alert mail (PLN-261015 D4): the paged agent's own address and the
    // hotel/region the host signed. Optional so older unit fixtures still build;
    // without them every mail goes to the ops mailbox, as before.
    @InjectRepository(User) private readonly userRepo?: Repository<User>,
    @InjectRepository(Session) private readonly sessionRepo?: Repository<Session>,
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
    if (existing) return; // channels already notified for this escalation

    const targets = await this.resolveTargets(payload);
    const base = {
      tenantId: payload.tenantId ?? null,
      conversationId: payload.conversationId,
      sessionId: payload.sessionId ?? null,
      reason: payload.reason ?? 'user_request',
      preview: payload.preview?.slice(0, 300) ?? null,
      status: 'new',
    };
    // One row per addressed agent: each sees the alarm in their own feed, and
    // acking one acks its siblings (see ack). NULL = tenant-wide broadcast.
    const rows = await this.alertRepo.save(
      targets.map((targetUserId) => this.alertRepo.create({ ...base, targetUserId })),
    );
    const alert = rows[0];

    // Off hours: the shopper has already been told to expect an email, so the
    // summary goes to the configured mailbox instead of paging the on-call
    // channels (PLN-AiSetting W3).
    if (payload.offHoursEmail) {
      await this.notifyEmail(alert, payload.offHoursEmail);
      return;
    }
    await Promise.allSettled([this.notifySlack(alert), this.notifyRows(rows)]);
  }

  /**
   * Mail for a set of alert rows (PLN-261015 D4): each addressed agent gets
   * their own mail at their own address; a broadcast row (NULL target) keeps
   * the historical ops-mailbox mail. An agent whose address cannot be read
   * falls back to the ops mailbox, so a page is never silently lost.
   */
  async notifyRows(rows: AgentAlert[], opts: { reminder?: boolean } = {}): Promise<void> {
    const context = rows[0] ? await this.alertContext(rows[0]) : null;
    let opsMailed = false;
    for (const row of rows) {
      const to = row.targetUserId != null ? await this.agentEmail(row.tenantId, row.targetUserId) : null;
      if (to) {
        await this.notifyEmail(row, to, { context, reminder: opts.reminder });
      } else if (!opsMailed) {
        opsMailed = true;
        await this.notifyEmail(row, undefined, { context, reminder: opts.reminder });
      }
    }
  }

  /** The paged agent's login address, fenced to the alert's tenant. */
  private async agentEmail(tenantId: number | null, userId: number): Promise<string | null> {
    if (!this.userRepo || tenantId == null) return null;
    try {
      const user = await this.userRepo.findOne({ where: { id: userId, tenantId }, select: { id: true, email: true } });
      return user?.email?.trim() || null;
    } catch (e) {
      this.logger.warn(`agent email lookup failed (user ${userId}): ${(e as Error).message}`);
      return null;
    }
  }

  /** Hotel · region the host signed for this session (D2) — shown in the mail. */
  private async alertContext(alert: AgentAlert): Promise<string | null> {
    if (!this.sessionRepo || alert.sessionId == null) return null;
    try {
      const session = await this.sessionRepo.findOne({
        where: { id: alert.sessionId },
        select: { id: true, identityAttributes: true, identityLevel: true },
      });
      const a = session?.identityAttributes;
      if (!a) return null;
      const hotel = a.hotel_name || a.hotel_id;
      const facts = [hotel && `Hotel: ${hotel}`, a.region && `Region: ${a.region}`, a.role && `Role: ${a.role}`].filter(Boolean);
      // Unsigned host (PLN-261022): say so, the facts are the host's word only.
      if (facts.length && session?.identityLevel === 'claimed') facts.push('Unverified');
      return facts.join(' · ') || null;
    } catch {
      return null;
    }
  }

  /**
   * Who the alarm is addressed to — one entry per alert row; `null` = broadcast.
   *
   * - Routing rule (PLN-261015 D3): least_loaded → the available agent, or the
   *   whole group when nobody in it is online/free; broadcast → the whole group.
   * - Legacy assignee list: the first assignee (one row, as before).
   * - Deny-rule label (P2): least-loaded agent holding it, else broadcast.
   * Alarms never drop: every path ends in at least one row.
   */
  private async resolveTargets(payload: EscalationPayload): Promise<Array<number | null>> {
    const group = [...new Set((payload.targetUserIds ?? []).map(Number).filter(Number.isFinite))];
    if (payload.assignMode && group.length && payload.tenantId) {
      if (payload.assignMode === 'least_loaded') {
        const pick = await this.pickLeastLoaded(payload.tenantId, group);
        if (pick != null) return [pick];
      }
      return group;
    }
    if (group.length) return [group[0]];
    if (payload.issueLabel && payload.tenantId) {
      return [await this.pickLabelAgent(payload.tenantId, payload.issueLabel)];
    }
    return [null];
  }

  /** Least-loaded available agent holding the label (P2, 결정 4). Null → broadcast fallback. */
  private async pickLabelAgent(tenantId: number, labelCode: string): Promise<number | null> {
    try {
      const labelRows = await this.labelRepo.find({ where: { tenantId, code: labelCode } });
      if (!labelRows.length) return null;
      const links = await this.userLabelRepo.find({
        where: { jobLabelId: In(labelRows.map((l) => Number(l.id))) },
      });
      return this.pickLeastLoaded(tenantId, [...new Set(links.map((l) => Number(l.userId)))]);
    } catch (e) {
      this.logger.warn(`label routing failed (${labelCode}): ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Online agent among `userIds` with the fewest active assignments, under
   * their maxConcurrent. Null when nobody qualifies (or on a lookup error —
   * the caller then widens the alarm instead of dropping it).
   */
  private async pickLeastLoaded(tenantId: number, userIds: number[]): Promise<number | null> {
    if (!userIds.length) return null;
    try {
      const profiles = await this.profileRepo.find({
        where: { tenantId, userId: In(userIds), status: 'online' },
      });
      let best: { userId: number; load: number } | null = null;
      for (const p of profiles) {
        const active = await this.assignmentRepo.count({
          where: { tenantId, agentId: Number(p.userId), status: 'active' },
        });
        if (active >= p.maxConcurrent) continue;
        if (!best || active < best.load) best = { userId: Number(p.userId), load: active };
      }
      return best?.userId ?? null;
    } catch (e) {
      this.logger.warn(`least-loaded pick failed: ${(e as Error).message}`);
      return null;
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
      // A group alarm is one row per agent (PLN-261015 D3). Once somebody has
      // it, the rest of the group should stop being paged for it.
      await this.alertRepo.update(
        { tenantId, conversationId: alert.conversationId, reason: alert.reason, status: 'new' },
        { status: 'acked', ackedBy: userId, ackedAt: alert.ackedAt },
      );
    }
    return alert;
  }

  // ---- channels ----

  private summary(alert: AgentAlert, context: string | null = null): string {
    const reason = REASON_LABEL[alert.reason] ?? alert.reason;
    const preview = alert.preview ? `\n> ${alert.preview}` : '';
    const who = context ? `\n${context}` : '';
    const base = this.config.get<string>('APP_PUBLIC_URL')?.replace(/\/+$/, '');
    const link = base ? `\nOpen: ${base}/live-chat?c=${alert.conversationId}` : '';
    return `Chat escalation — conversation #${alert.conversationId}\nReason: ${reason}${who}${preview}${link}`;
  }

  /** Slack incoming webhook (SLACK_WEBHOOK_URL; empty = disabled). */
  private async notifySlack(alert: AgentAlert): Promise<void> {
    const url = this.config.get<string>('SLACK_WEBHOOK_URL');
    if (!url) return;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `:rotating_light: ${this.summary(alert)}` }),
      });
      if (!res.ok) this.logger.warn(`Slack alert failed: HTTP ${res.status}`);
    } catch (e) {
      this.logger.warn(`Slack alert failed: ${(e as Error).message}`);
    }
  }

  /** Escalation summary to `to` (an agent, the off-hours box) or the ops mailbox. */
  private async notifyEmail(
    alert: AgentAlert,
    overrideTo?: string,
    opts: { context?: string | null; reminder?: boolean } = {},
  ): Promise<void> {
    const to = overrideTo ?? this.config.get<string>('ALERT_EMAIL_TO');
    if (!to) return;
    const prefix = opts.reminder ? '[SharpTalk] Reminder — still waiting' : '[SharpTalk] Escalation';
    await this.mailer.send({
      to,
      subject: `${prefix} — conversation #${alert.conversationId}`,
      text: this.summary(alert, opts.context ?? null),
    });
  }
}
