import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { AgentAlert } from './entity/agent-alert.entity';
import { AgentProfile } from './entity/agent-profile.entity';
import { Assignment } from './entity/assignment.entity';
import { JobLabel } from '../user/entity/job-label.entity';
import { UserJobLabel } from '../user/entity/user-job-label.entity';
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
  /** Team the customer picked (PLN-261007 Team Routing) — wording for the channels. */
  supportLabel?: string;
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
    let targetUserId: number | null = null;
    if (payload.issueLabel && payload.tenantId) {
      targetUserId = await this.pickLabelAgent(payload.tenantId, payload.issueLabel);
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

    // Off hours: the shopper has already been told to expect an email, so the
    // summary goes to the configured mailbox instead of paging the on-call
    // channels (PLN-AiSetting W3).
    if (payload.offHoursEmail) {
      await this.notifyEmail(alert, payload.offHoursEmail, payload.supportLabel);
      return;
    }
    await Promise.allSettled([
      this.notifySlack(alert, payload.supportLabel),
      this.notifyEmail(alert, undefined, payload.supportLabel),
    ]);
  }

  /**
   * Least-loaded available agent holding the label (P2, 결정 4): online profile,
   * active assignments under maxConcurrent. Null → broadcast fallback.
   */
  private async pickLabelAgent(tenantId: number, labelCode: string): Promise<number | null> {
    try {
      const labelRows = await this.labelRepo.find({ where: { tenantId, code: labelCode } });
      if (!labelRows.length) return null;
      const links = await this.userLabelRepo.find({
        where: { jobLabelId: In(labelRows.map((l) => Number(l.id))) },
      });
      const userIds = [...new Set(links.map((l) => Number(l.userId)))];
      if (!userIds.length) return null;
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
      this.logger.warn(`label routing failed (${labelCode}): ${(e as Error).message}`);
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
    }
    return alert;
  }

  // ---- channels ----

  private summary(alert: AgentAlert, teamLabel?: string): string {
    const reason = REASON_LABEL[alert.reason] ?? alert.reason;
    // The team the customer picked (PLN-261007) — so CS knows at a glance
    // whether a Business Support request landed in the broadcast fallback.
    const team = teamLabel?.trim() ? `\nTeam: ${teamLabel.trim()}` : '';
    const preview = alert.preview ? `\n> ${alert.preview}` : '';
    return `Chat escalation — conversation #${alert.conversationId}\nReason: ${reason}${team}${preview}`;
  }

  /** Slack incoming webhook (SLACK_WEBHOOK_URL; empty = disabled). */
  private async notifySlack(alert: AgentAlert, teamLabel?: string): Promise<void> {
    const url = this.config.get<string>('SLACK_WEBHOOK_URL');
    if (!url) return;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `:rotating_light: ${this.summary(alert, teamLabel)}` }),
      });
      if (!res.ok) this.logger.warn(`Slack alert failed: HTTP ${res.status}`);
    } catch (e) {
      this.logger.warn(`Slack alert failed: ${(e as Error).message}`);
    }
  }

  /** Escalation summary to the ops mailbox (or the off-hours override). */
  private async notifyEmail(alert: AgentAlert, overrideTo?: string, teamLabel?: string): Promise<void> {
    const to = overrideTo ?? this.config.get<string>('ALERT_EMAIL_TO');
    if (!to) return;
    await this.mailer.send({
      to,
      subject: `[IVY Chat] Escalation — conversation #${alert.conversationId}`,
      text: this.summary(alert, teamLabel),
    });
  }
}
