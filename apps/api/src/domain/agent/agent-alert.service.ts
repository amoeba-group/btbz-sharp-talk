import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, LessThan, Or, Repository } from 'typeorm';
import { AgentAlert } from './entity/agent-alert.entity';
import { AgentProfile } from './entity/agent-profile.entity';
import { Assignment } from './entity/assignment.entity';
import { JobLabel } from '../user/entity/job-label.entity';
import { UserJobLabel } from '../user/entity/user-job-label.entity';
import { User } from '../user/entity/user.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { Session } from '../session/entity/session.entity';
import { CONVERSATION_STATUS, JOB_LABEL } from '@sharptalk/types';
import { EventBusService, EVENTS, MailerService } from '../../infrastructure/infrastructure.module';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { m, safeLabel } from '../../infrastructure/observability/app-metrics';
import { partnerLabelOfClaims } from '../../global/util/partner-label.util';
import { HandoffRouterService } from '../ai-engine/handoff-router.service';
import type { RoutingPolicy } from '../ai-engine/handoff-router.service';
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
  /**
   * `strict` (PLN-261012 SG-67): the alert never leaves the hotel's region on its own —
   * no cross-region assignee, and the fallback broadcast is region-scoped. Absent or
   * `prefer` is today's behaviour.
   */
  regionMode?: 'prefer' | 'strict';
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
  /** Set on an "UNCLAIMED" re-page: how long it has waited and which reminder this is (SG-63). */
  unclaimed?: { waitedMin: number; attempt: number; maxPages: number };
}

/**
 * What an alert row says about its conversation, for the console modal (PLN-261012 SG-66):
 * read live from the conversation and its session, so a re-route or a province fix shows
 * on the alert without rewriting it.
 */
export interface AlertView {
  supportType: string | null;
  supportRegion: string | null;
  /** A signed province the region table did not list. */
  supportRegionHint: string | null;
  escalatedAt: Date | null;
  conversationStatus: string | null;
  /** The signed partner behind the conversation; null for guests and v1 identities. */
  partner: { hotelName: string | null; hotelSn: string; role: string } | null;
}

/** What `raise` created and who it addressed — the re-route answer tells the agent. */
export interface RaisedAlert {
  alert: AgentAlert;
  /** The addressed agent; null = broadcast (possibly region-scoped). */
  targetUserId: number | null;
  targetRegion: string | null;
}

/** `users.status` of someone who can take a conversation (the others are suspended / invited). */
const USER_STATUS_ACTIVE = 'active';

/** Alert statuses: `new` is shown; `acked` was seen/claimed; `superseded` was replaced or settled. */
export const ALERT_STATUS = { NEW: 'new', ACKED: 'acked', SUPERSEDED: 'superseded' } as const;

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
  engine_unavailable: 'AI engine unavailable — the assistant could not answer (outage, not missing knowledge)',
  // PLN-261012 SG-63: nobody took the conversation within the wait limit.
  unclaimed: 'UNCLAIMED — nobody has taken this conversation yet',
  // PLN-261012 SG-64: an agent handed it over to another team.
  rerouted: 'Handed over by an agent to this team',
  // w3c (ops-manual finding 5): the partner-data step's two hand-offs used to read as a knowledge miss.
  partner_unavailable: 'Partner data unavailable — the hotel data system did not answer usably (not missing knowledge)',
  partner_unverified: 'AI answer withheld — a figure could not be verified against the hotel data',
};

/** Subject prefix of alert e-mails when ALERT_EMAIL_SUBJECT_PREFIX is not set (w3c, ops-manual finding 17). */
export const ALERT_SUBJECT_PREFIX_DEFAULT = '[SharpTalk]';

/**
 * The subject prefix: the operator's `ALERT_EMAIL_SUBJECT_PREFIX`, else the neutral product default.
 * It used to be the literal "[IVY Chat]" for every tenant of every deployment. One line, bounded,
 * so a stray newline in an env file can never become a second mail header.
 */
export function alertSubjectPrefix(raw: string | undefined | null): string {
  const clean = String(raw ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 40);
  return clean || ALERT_SUBJECT_PREFIX_DEFAULT;
}

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
    // Routing extras (PLN-261012 SG-63/SG-66/SG-67), appended after it for the same
    // reason: each is `?.`-guarded, so a double without them keeps the old behaviour.
    @InjectRepository(Conversation) private readonly convRepo?: Repository<Conversation>,
    @InjectRepository(Session) private readonly sessionRepo?: Repository<Session>,
    private readonly router?: HandoffRouterService,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe(EVENTS.ESCALATION, async (payload: unknown) => {
      await this.onEscalation((payload ?? {}) as EscalationPayload);
    });
    // A staff member's region or status changed: re-point the alerts pinned to them (SG-65).
    this.bus.subscribe(EVENTS.USER_ROUTING_CHANGED, async (payload: unknown) => {
      await this.onUserRoutingChanged((payload ?? {}) as UserRoutingChange);
    });
  }

  async onEscalation(payload: EscalationPayload): Promise<void> {
    await this.raise(payload);
  }

  /**
   * Create the alert for one escalation and fan it out. `supersede` is the re-route's
   * bypass of the de-dupe below (PLN-261012 SG-64): the conversation's open alerts are
   * settled first, so the fresh alert for the NEW target is not swallowed by the
   * "already paged for this reason" check and the old target's modal stops asking.
   * Returns null when nothing was created (no conversation, or a duplicate).
   */
  async raise(payload: EscalationPayload, opts: { supersede?: boolean } = {}): Promise<RaisedAlert | null> {
    if (!payload.conversationId) return null;
    if (opts.supersede) {
      await this.settle(payload.tenantId, payload.conversationId, ALERT_STATUS.SUPERSEDED);
    }
    // Idempotency (at-least-once bus): skip if an un-acked alert already exists
    // for this conversation with the same reason.
    const existing = opts.supersede
      ? null
      : await this.alertRepo.findOne({
          where: {
            tenantId: payload.tenantId ?? IsNull(),
            conversationId: payload.conversationId,
            reason: payload.reason ?? 'user_request',
            status: 'new',
          },
        });
    if (existing) return null; // channels already notified for this escalation
    const { userId: targetUserId, region: targetRegion } = await this.chooseTarget(payload);
    const alert = await this.alertRepo.save(
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
        // Strict regional routing (PLN-261012 SG-67): a broadcast that must stay in the region.
        targetRegion,
        status: 'new',
      }),
    );
    // One count per NEW escalation, by reason (PLN-261012 SG-83) — a replayed duplicate returned above.
    m.handoffs.inc({ reason: safeLabel(payload.reason ?? 'user_request') });
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
      return { alert, targetUserId, targetRegion };
    }
    const hooks = await this.slackTargets(payload.tenantId, payload.supportRegion, false);
    await Promise.allSettled([this.notifySlack(alert, ctx, hooks), this.notifyEmail(alert, undefined, ctx)]);
    return { alert, targetUserId, targetRegion };
  }

  /**
   * Who an escalation is addressed to.
   *
   * Label routing (P2, PLN-261007): an explicit label — a deny rule's stamp or the team the
   * customer just picked — outranks the tenant's general assignee list, since it says who
   * this conversation is FOR. Least-loaded available agent holding the label; nobody online
   * → the configured assignee; none → NULL, i.e. the pre-P2 broadcast (alarms never drop).
   *
   * A hotel's regional team (PLN-261007 Hotel Region Routing) narrows the same search: same
   * label AND same region, then nationwide staff with the label. With a region but no label
   * (an AI-triggered hand-off) the label is consult, the one that handles conversations.
   *
   * `strict` region mode (PLN-261012 SG-67) never crosses the region on its own: after the
   * label rounds it takes a configured assignee only if that person belongs to the region
   * (or is nationwide), and otherwise the alert is a REGION-SCOPED broadcast (`region`
   * returned) that only that team and nationwide staff see. Crossing to the other team is
   * left to the unclaimed sweeper's timed widening.
   */
  private async chooseTarget(
    payload: EscalationPayload,
    excludeUserId?: number,
  ): Promise<{ userId: number | null; region: string | null }> {
    const strict = payload.regionMode === 'strict' && !!payload.supportRegion;
    const label = payload.issueLabel ?? (payload.supportRegion ? JOB_LABEL.CONSULT : undefined);
    let userId: number | null = null;
    if (label && payload.tenantId) {
      userId = await this.pickLabelAgent(payload.tenantId, label, payload.supportRegion, excludeUserId);
    }
    if (userId == null) {
      userId = strict
        ? await this.pickRegionAssignee(payload.tenantId, payload.targetUserIds ?? [], payload.supportRegion as string, excludeUserId)
        : (payload.targetUserIds ?? []).find((id) => id !== excludeUserId) ?? null;
    }
    return { userId, region: userId == null && strict ? (payload.supportRegion as string) : null };
  }

  /**
   * Strict mode's assignee step: the first configured assignee (list order) who is an ACTIVE
   * user of the hotel's region or nationwide. Presence is not required — like the prefer
   * ladder's assignee step, the operator named them. Without the user repository (a double)
   * nobody can be vouched for, so the step yields nothing.
   */
  private async pickRegionAssignee(
    tenantId: number | undefined,
    assigneeIds: number[],
    region: string,
    excludeUserId?: number,
  ): Promise<number | null> {
    const ids = assigneeIds.filter((id) => Number.isFinite(id) && id !== excludeUserId);
    if (!ids.length || !tenantId || !this.userRepo) return null;
    try {
      const users = await this.userRepo.find({
        where: { tenantId, id: In(ids) },
        select: { id: true, region: true, status: true },
      });
      const fits = new Set(
        users
          .filter((u) => u.status === USER_STATUS_ACTIVE && (u.region == null || u.region === region))
          .map((u) => Number(u.id)),
      );
      return ids.find((id) => fits.has(id)) ?? null;
    } catch (e) {
      this.logger.warn(`regional assignee lookup failed: ${(e as Error).message}`);
      return null;
    }
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
   *
   * `excludeUserId` (PLN-261012 SG-65) keeps one person out of the search: the agent whose
   * region just changed must not be handed back the alert being re-pointed away from them.
   */
  private async pickLabelAgent(
    tenantId: number,
    labelCode: string,
    region?: string,
    excludeUserId?: number,
  ): Promise<number | null> {
    try {
      const labelRows = await this.labelRepo.find({ where: { tenantId, code: labelCode } });
      if (!labelRows.length) return null;
      const links = await this.userLabelRepo.find({
        where: { jobLabelId: In(labelRows.map((l) => Number(l.id))) },
      });
      const userIds = [...new Set(links.map((l) => Number(l.userId)))].filter((id) => id !== excludeUserId);
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
   *
   * A REGION-SCOPED broadcast (`target_region` set, strict mode — PLN-261012 SG-67) is
   * visible only to staff of that region and to nationwide staff (no `users.region`):
   * the caller's own region decides, read here so every caller of the feed is fenced the
   * same way. A caller whose region cannot be read sees plain broadcasts and their own.
   */
  async list(status: string, userId: number, tenantId: number): Promise<AgentAlert[]> {
    if (!tenantId) return []; // platform admins have no tenant alarm feed
    const region = await this.regionOfUser(userId, tenantId);
    // Nationwide staff (no region) see every broadcast, region-scoped or not.
    const broadcast: FindOptionsWhere<AgentAlert>[] = region
      ? [
          { status, tenantId, targetUserId: IsNull(), targetRegion: IsNull() },
          { status, tenantId, targetUserId: IsNull(), targetRegion: region },
        ]
      : [{ status, tenantId, targetUserId: IsNull() }];
    return this.alertRepo.find({
      where: [...broadcast, { status, tenantId, targetUserId: userId }],
      order: { id: 'DESC' },
      take: 50,
    });
  }

  /** The feed plus what each alert's conversation currently says (team, region, partner). */
  async listWithContext(
    status: string,
    userId: number,
    tenantId: number,
  ): Promise<Array<{ alert: AgentAlert; view: AlertView | null }>> {
    const alerts = await this.list(status, userId, tenantId);
    const views = await this.viewsFor(alerts, tenantId);
    return alerts.map((alert) => ({ alert, view: views.get(Number(alert.conversationId)) ?? null }));
  }

  /** One batched read of conversations and session claims for a page of alerts. */
  private async viewsFor(alerts: AgentAlert[], tenantId: number): Promise<Map<number, AlertView>> {
    const out = new Map<number, AlertView>();
    if (!alerts.length || !this.convRepo) return out;
    try {
      const convIds = [...new Set(alerts.map((a) => Number(a.conversationId)))];
      const convs = await this.convRepo.find({ where: { tenantId, id: In(convIds) } });
      const claimsBySession = new Map<number, Session['identityClaims']>();
      if (this.sessionRepo && convs.length) {
        const sessions = await this.sessionRepo.find({
          where: { id: In([...new Set(convs.map((c) => Number(c.sessionId)))]) },
          select: { id: true, identityClaims: true },
        });
        for (const s of sessions) claimsBySession.set(Number(s.id), s.identityClaims ?? null);
      }
      for (const c of convs) {
        const claims = claimsBySession.get(Number(c.sessionId)) ?? null;
        out.set(Number(c.id), {
          supportType: c.supportType ?? null,
          supportRegion: c.supportRegion ?? null,
          supportRegionHint: c.supportRegionHint ?? null,
          escalatedAt: c.escalatedAt ?? null,
          conversationStatus: c.status ?? null,
          partner:
            claims?.signed && claims.hotelSn
              ? { hotelName: claims.hotelName?.trim() || null, hotelSn: claims.hotelSn, role: claims.role }
              : null,
        });
      }
    } catch (e) {
      // The alarm must still show without its decoration.
      this.logger.warn(`alert context lookup failed: ${(e as Error).message}`);
    }
    return out;
  }

  /** The caller's `users.region` (north | south), or null — nationwide, unknown, or no user repository. */
  private async regionOfUser(userId: number, tenantId: number): Promise<string | null> {
    if (!this.userRepo) return null;
    try {
      const user = await this.userRepo.findOne({ where: { id: userId, tenantId }, select: { id: true, region: true } });
      return user?.region ?? null;
    } catch (e) {
      this.logger.warn(`region lookup failed (user ${userId}): ${(e as Error).message}`);
      return null;
    }
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

  /**
   * Close the conversation's open alerts (PLN-261012 SG-63/SG-64, REQ D-20): `acked` when
   * someone took the conversation (they are the one who acknowledged it), `superseded` when
   * the alert was replaced or its conversation settled some other way (ended, handed back,
   * re-routed). Without this an alert addressed to an agent stayed `new` after a colleague
   * accepted — and the de-dupe in `raise` then swallowed the NEXT escalation of the same
   * conversation. Never throws: closing alerts must not fail the action that triggered it.
   */
  async settle(
    tenantId: number | null | undefined,
    conversationId: number,
    status: typeof ALERT_STATUS.ACKED | typeof ALERT_STATUS.SUPERSEDED,
    ackedBy?: number,
  ): Promise<number> {
    try {
      const patch =
        status === ALERT_STATUS.ACKED
          ? { status, ackedBy: ackedBy ?? null, ackedAt: new Date() }
          : { status };
      const res = await this.alertRepo.update(
        { tenantId: tenantId ?? IsNull(), conversationId, status: ALERT_STATUS.NEW },
        patch,
      );
      return res?.affected ?? 0;
    } catch (e) {
      this.logger.warn(`settling alerts failed (conversation ${conversationId}): ${(e as Error).message}`);
      return 0;
    }
  }

  /**
   * One "UNCLAIMED" re-page (PLN-261012 SG-63): the conversation has been waiting with nobody
   * taking it, and a targeted alert is visible to its addressee only. So a NEW broadcast
   * alert is raised — plain, or scoped to the hotel's region in strict mode (`scopeRegion`)
   * — the older open alerts of the conversation are superseded (one alarm, not two), and the
   * Slack/email channels get an "UNCLAIMED" text with the team, region and partner lines.
   * Never throws: the sweeper must go on to the next conversation.
   */
  async pageUnclaimed(
    conv: Conversation,
    page: { attempt: number; maxPages: number; waitedMin: number; scopeRegion: string | null; crossRegion: boolean },
  ): Promise<AgentAlert | null> {
    try {
      const tenantId = conv.tenantId == null ? null : Number(conv.tenantId);
      const conversationId = Number(conv.id);
      const last = await this.alertRepo.findOne({ where: { tenantId: tenantId ?? IsNull(), conversationId }, order: { id: 'DESC' } });
      await this.settle(tenantId, conversationId, ALERT_STATUS.SUPERSEDED);
      const alert = await this.alertRepo.save(
        this.alertRepo.create({
          tenantId,
          conversationId,
          sessionId: Number(conv.sessionId),
          reason: 'unclaimed',
          preview: last?.preview ?? null,
          targetUserId: null,
          targetRegion: page.scopeRegion,
          status: ALERT_STATUS.NEW,
        }),
      );
      const ctx = await this.contextFor(conv);
      ctx.unclaimed = { waitedMin: page.waitedMin, attempt: page.attempt, maxPages: page.maxPages };
      const hooks = await this.slackTargets(tenantId ?? undefined, conv.supportRegion ?? undefined, page.crossRegion);
      await Promise.allSettled([this.notifySlack(alert, ctx, hooks), this.notifyEmail(alert, undefined, ctx)]);
      return alert;
    } catch (e) {
      this.logger.warn(`unclaimed page failed (conversation ${conv.id}): ${(e as Error).message}`);
      return null;
    }
  }

  /** Team, region and partner wording for an alert text, rebuilt from the conversation. */
  async contextFor(conv: Conversation): Promise<AlertContext> {
    const ctx: AlertContext = {};
    try {
      const policy = this.router && conv.tenantId != null ? await this.router.routingPolicy(Number(conv.tenantId)) : null;
      if (conv.supportType) {
        ctx.teamLabel = policy?.teams.find((t) => t.id === conv.supportType)?.label || conv.supportType;
      }
      if (conv.supportRegion) ctx.regionLabel = conv.supportRegion === 'north' ? 'North' : 'South';
      else if (conv.supportRegionHint) ctx.regionUnmapped = conv.supportRegionHint;
      if (this.sessionRepo) {
        const session = await this.sessionRepo.findOne({ where: { id: Number(conv.sessionId) }, select: { id: true, identityClaims: true } });
        const partner = partnerLabelOfClaims(session?.identityClaims);
        if (partner) ctx.partnerLabel = partner;
      }
    } catch (e) {
      this.logger.warn(`alert context failed (conversation ${conv.id}): ${(e as Error).message}`);
    }
    return ctx;
  }

  /**
   * A staff member's region or status changed (PLN-261012 SG-65, REQ D-20): an alert still
   * pinned to them for a conversation of the OTHER region — or because they are no longer
   * active — is re-pointed. It runs the same ladder again without them; nobody eligible →
   * a broadcast (region-scoped in strict mode). Alerts that still fit (same region,
   * nationwide, no region on the conversation) and alerts of conversations that were claimed
   * or ended in the meantime are left or settled, never re-pinned. The channels are not
   * re-posted: the Slack/email already went out, and the new addressee sees the alarm on
   * their next poll.
   */
  async onUserRoutingChanged(change: UserRoutingChange): Promise<void> {
    const { tenantId, userId } = change;
    if (!tenantId || !userId || !this.convRepo) return;
    try {
      const pending = await this.alertRepo.find({ where: { tenantId, targetUserId: userId, status: ALERT_STATUS.NEW } });
      if (!pending.length) return;
      const policy = this.router ? await this.router.routingPolicy(tenantId) : null;
      const active = change.status == null || change.status === USER_STATUS_ACTIVE;
      for (const alert of pending) {
        const conv = await this.convRepo.findOne({ where: { id: Number(alert.conversationId), tenantId } });
        if (!conv || conv.status !== CONVERSATION_STATUS.WAITING || conv.agentId != null) {
          await this.alertRepo.update({ id: alert.id, status: ALERT_STATUS.NEW }, { status: ALERT_STATUS.SUPERSEDED });
          continue;
        }
        const fits =
          active && (!conv.supportRegion || change.region == null || change.region === conv.supportRegion);
        if (fits) continue;
        const payload = this.payloadFor(conv, alert, policy);
        const { userId: next, region } = await this.chooseTarget(payload, userId);
        await this.alertRepo.update(
          { id: alert.id, status: ALERT_STATUS.NEW },
          { targetUserId: next, targetRegion: region },
        );
        this.logger.log(
          `alert ${alert.id} re-pointed after user ${userId} routing change: ${next == null ? 'broadcast' : `user ${next}`}`,
        );
      }
    } catch (e) {
      this.logger.warn(`re-pointing alerts failed (user ${userId}): ${(e as Error).message}`);
    }
  }

  /** The routing inputs of a stored alert, rebuilt from its conversation and the tenant policy. */
  private payloadFor(conv: Conversation, alert: AgentAlert, policy: RoutingPolicy | null): EscalationPayload {
    const team = conv.supportType ? policy?.teams.find((t) => t.id === conv.supportType) : undefined;
    return {
      tenantId: Number(conv.tenantId),
      conversationId: Number(conv.id),
      reason: alert.reason,
      targetUserIds: policy?.assigneeUserIds ?? [],
      issueLabel: team?.jobLabel,
      supportRegion: conv.supportRegion ?? undefined,
      regionMode: policy?.regionMode,
    };
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
   * they always got. Order is fixed: Reason, Team, Region, Partner, preview — and, on an
   * "UNCLAIMED" re-page (PLN-261012 SG-63), a Waiting line right after the Reason.
   */
  summary(alert: AgentAlert, ctx: AlertContext = {}): string {
    const reason = REASON_LABEL[alert.reason] ?? alert.reason;
    const line = (name: string, value?: string) => (value?.trim() ? `\n${name}: ${value.trim()}` : '');
    const preview = alert.preview ? `\n> ${alert.preview}` : '';
    const waiting = ctx.unclaimed
      ? `\nWaiting: ${ctx.unclaimed.waitedMin} min (reminder ${ctx.unclaimed.attempt} of ${ctx.unclaimed.maxPages})`
      : '';
    return (
      `Chat escalation — conversation #${alert.conversationId}\nReason: ${reason}` +
      waiting +
      line('Team', ctx.teamLabel) +
      line('Region', ctx.regionLabel?.trim() ? ctx.regionLabel : unmappedRegion(ctx.regionUnmapped)) +
      line('Partner', ctx.partnerLabel) +
      preview
    );
  }

  /**
   * Where an alert's Slack text goes (PLN-261012 SG-67). A tenant that configured no regional
   * webhook gets the global SLACK_WEBHOOK_URL, exactly as before. With regional webhooks, the
   * hotel's team channel gets it (the global URL stays the fallback for a team without one);
   * a cross-region page (`crossRegion`) also reaches the other team's channel — that is the
   * whole point of widening. Duplicates are dropped.
   */
  private async slackTargets(
    tenantId: number | undefined | null,
    region: string | undefined,
    crossRegion: boolean,
  ): Promise<string[]> {
    const global = this.config.get<string>('SLACK_WEBHOOK_URL');
    let regional: RoutingPolicy['slackByRegion'] = {};
    if (this.router && tenantId) {
      try {
        regional = (await this.router.routingPolicy(tenantId)).slackByRegion;
      } catch (e) {
        this.logger.warn(`regional webhook lookup failed: ${(e as Error).message}`);
      }
    }
    const urls: string[] = [];
    const own = region ? regional[region as 'north' | 'south'] : undefined;
    if (own) urls.push(own);
    else if (global) urls.push(global);
    if (crossRegion) {
      for (const [team, url] of Object.entries(regional)) {
        if (url && team !== region) urls.push(url);
      }
      if (global && own) urls.push(global); // the shared channel hears a widened page too
    }
    return [...new Set(urls)];
  }

  /** Slack incoming webhook(s): the regional ones when set, else SLACK_WEBHOOK_URL (empty = disabled). */
  private async notifySlack(alert: AgentAlert, ctx: AlertContext, urls: string[]): Promise<void> {
    for (const url of urls) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: `:rotating_light: ${this.summary(alert, ctx)}` }),
        });
        m.alertSends.inc({ channel: 'slack', result: res.ok ? 'ok' : 'failed' });
        if (!res.ok) this.logger.warn(`Slack alert failed: HTTP ${res.status}`);
      } catch (e) {
        m.alertSends.inc({ channel: 'slack', result: 'failed' });
        this.logger.warn(`Slack alert failed: ${(e as Error).message}`);
      }
    }
  }

  /** Escalation summary to the ops mailbox (or the off-hours override). */
  private async notifyEmail(alert: AgentAlert, overrideTo: string | undefined, ctx: AlertContext): Promise<void> {
    const to = overrideTo ?? this.config.get<string>('ALERT_EMAIL_TO');
    if (!to) return;
    const prefix = alertSubjectPrefix(this.config.get<string>('ALERT_EMAIL_SUBJECT_PREFIX'));
    const sent = await this.mailer.send({
      to,
      subject:
        alert.reason === 'unclaimed'
          ? `${prefix} UNCLAIMED — conversation #${alert.conversationId}`
          : `${prefix} Escalation — conversation #${alert.conversationId}`,
      text: this.summary(alert, ctx),
    });
    m.alertSends.inc({
      channel: 'email',
      result: sent ? 'ok' : this.mailer.configured?.() === false ? 'unconfigured' : 'failed',
    });
  }
}

/** Payload of EVENTS.USER_ROUTING_CHANGED (published by UserService on a region/status change). */
export interface UserRoutingChange {
  tenantId?: number;
  userId?: number;
  /** The user's region after the change; null = nationwide. */
  region?: string | null;
  /** The user's status after the change (only sent when it changed). */
  status?: string;
}
