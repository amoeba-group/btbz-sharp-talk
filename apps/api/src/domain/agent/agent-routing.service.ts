import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { CONVERSATION_STATUS, SENDER_TYPE, USER_REGION } from '@sharptalk/types';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { User } from '../user/entity/user.entity';
import { Assignment } from './entity/assignment.entity';
import { ChatComment, COMMENT_SCOPE } from './entity/chat-comment.entity';
import { AgentAlertService } from './agent-alert.service';
import { HandoffRouterService } from '../ai-engine/handoff-router.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { partnerLabelOfClaims } from '../../global/util/partner-label.util';
import { displayNameOf } from '../../global/util/user-display.util';
import { escalationPreview } from '../chat/escalation-preview.util';

const TEAMS: readonly string[] = Object.values(USER_REGION);
/** English wording for a region team in alert channels and the thread note. */
const REGION_NAME: Record<string, string> = { north: 'North', south: 'South' };

/** The choices the "Hand over to…" control offers (PLN-261012 SG-64). */
export interface RoutingOptions {
  /** Team routing is switched on for the tenant: without it there is nothing to hand over to. */
  enabled: boolean;
  teams: Array<{ id: string; label: string }>;
  /** Region routing is on: the control also offers the hotel's regional team. */
  regionEnabled: boolean;
  regions: string[];
}

/** What a re-route did — the console toast says who was asked. */
export interface RerouteResult {
  id: number;
  status: string;
  supportType: string;
  supportRegion: string | null;
  /** Who the fresh alert went to; `userId` null = a broadcast (to the region's team in strict mode). */
  notified: { userId: number | null; name: string | null; region: string | null };
}

/** Counters for the queue chips (PLN-261012 SG-66). */
export interface QueueCounts {
  total: number;
  /** Per team the customer picked; `id` null = no team (guests, tenants that do not ask). */
  teams: Array<{ id: string | null; count: number }>;
  regions: {
    north: number;
    south: number;
    /** No regional team: region routing off, no signed province, or province not listed. */
    none: number;
    /** The part of `none` whose signed province the region table does not list. */
    unmapped: number;
  };
  /** WAITING with nobody holding them. */
  unclaimed: number;
  /** Oldest `escalated_at` among the unclaimed ones; null when there are none. */
  oldestUnclaimedAt: Date | null;
  /** The caller's own `users.region`, so the console can default the filter to "my region". */
  myRegion: string | null;
}

/**
 * Routing actions of the agent console that sit beside, not inside, AgentService
 * (PLN-261012 SG-64 re-route, SG-66 queue counters): hand a conversation to another team or
 * region, list what the hand-over control may offer, and count the queue per team/region.
 */
@Injectable()
export class AgentRoutingService {
  private readonly logger = new Logger(AgentRoutingService.name);

  constructor(
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Assignment) private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(ChatComment) private readonly commentRepo: Repository<ChatComment>,
    private readonly alerts: AgentAlertService,
    private readonly router: HandoffRouterService,
    private readonly audit: AuditService,
  ) {}

  /** The control's choices, with team wording in the console language. */
  async options(tenantId: number, language: string): Promise<RoutingOptions> {
    const question = await this.router.teamQuestion(tenantId, language);
    const policy = await this.router.routingPolicy(tenantId);
    return {
      enabled: !!question,
      teams: (question?.options ?? []).map((o) => ({ id: o.id, label: o.label })),
      regionEnabled: policy.regionEnabled,
      regions: policy.regionEnabled ? [...TEAMS] : [],
    };
  }

  /**
   * Hand a conversation over to another team and/or region (PLN-261012 SG-64, REQ D-20).
   *
   * Before this, "assign" only set an agent id and left the team and region badges stale,
   * and a customer who picked the wrong team had no way out — a second `escalate` was
   * swallowed by the alert de-dupe. Here the target is validated against the TENANT's own
   * team options, the conversation goes back to the waiting queue for that team (the
   * previous holder's assignment is released), the label/region ladder runs again, and a
   * FRESH alert is raised for the new target with the de-dupe bypassed (the old alerts are
   * superseded first). Audited, and noted in the thread as an INTERNAL note — a system
   * message would reach the customer's widget, and the customer need not hear which agent
   * moved the chat.
   *
   * `region`: omitted keeps the conversation's region; a team (north | south) sets it; null
   * clears it. Any non-ended conversation may be handed over, including one still with the AI
   * (the agent is then escalating it to that team). Off-hours handling is not applied: the
   * agent asked for this team now, so the team is paged, not emailed.
   */
  async reroute(
    conversationId: number,
    tenantId: number,
    actorUserId: number,
    input: { supportType: string; region?: string | null },
  ): Promise<RerouteResult> {
    const conversation = await this.convRepo.findOne({ where: { id: conversationId, tenantId } });
    if (!conversation) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    if (conversation.status === CONVERSATION_STATUS.ENDED) {
      // 4xx is not server-logged by default; say why the control did nothing.
      this.logger.warn(`reroute refused: conversation=${conversationId} is ended (user ${actorUserId})`);
      throw new BusinessException(ERROR_CODE.CONVERSATION_NOT_REROUTABLE, HttpStatus.CONFLICT);
    }

    const question = await this.router.teamQuestion(tenantId, 'EN');
    if (!question) {
      this.logger.warn(`reroute refused: team routing is off (tenant ${tenantId})`);
      throw new BusinessException(ERROR_CODE.ROUTING_NOT_ENABLED, HttpStatus.CONFLICT);
    }
    const team = question.options.find((o) => o.id === input.supportType);
    if (!team) {
      this.logger.warn(`reroute refused: unknown team "${String(input.supportType).slice(0, 32)}" (tenant ${tenantId})`);
      throw new BusinessException(ERROR_CODE.ROUTING_TARGET_INVALID, HttpStatus.BAD_REQUEST, {
        support_type: [`must be one of ${question.options.map((o) => o.id).join(', ')}`],
      });
    }
    if (input.region !== undefined && input.region !== null && !TEAMS.includes(input.region)) {
      this.logger.warn(`reroute refused: unknown region "${String(input.region).slice(0, 16)}" (tenant ${tenantId})`);
      throw new BusinessException(ERROR_CODE.ROUTING_TARGET_INVALID, HttpStatus.BAD_REQUEST, {
        region: [`must be one of ${TEAMS.join(', ')}`],
      });
    }

    const previous = {
      supportType: conversation.supportType ?? null,
      supportRegion: conversation.supportRegion ?? null,
      agentId: conversation.agentId != null ? Number(conversation.agentId) : null,
      status: conversation.status,
    };
    const region = input.region === undefined ? previous.supportRegion : input.region;
    const now = new Date();

    // The previous holder lets go: the conversation is the new team's to take. The assignment
    // is marked transferred, never deleted - it is the audit trail (as in assignConversation).
    await this.assignmentRepo.update({ tenantId, conversationId, status: 'active' }, { status: 'transferred', releasedAt: now });
    await this.convRepo.update(
      { id: conversationId },
      {
        supportType: team.id,
        // An explicit region choice replaces the automatic one, and so ends the "?" hint.
        ...(input.region === undefined ? {} : { supportRegion: input.region, supportRegionHint: null }),
        status: CONVERSATION_STATUS.WAITING,
        agentId: null,
        escalated: 1,
        // A new waiting spell for the new team: the age and the unclaimed re-alert start over.
        escalatedAt: now,
        unclaimedPages: 0,
        unclaimedPagedAt: null,
      },
    );

    // Run the ladder again and page the new target. `supersede` is the de-dupe bypass.
    const policy = await this.router.routingPolicy(tenantId);
    // The question, not the team chip the customer pressed (w3c, ops-manual finding 16).
    const preview = await escalationPreview((beforeId) =>
      this.msgRepo.findOne({
        where: { conversationId, senderType: SENDER_TYPE.USER, ...(beforeId != null ? { id: LessThan(beforeId) } : {}) },
        order: { id: 'DESC' },
      }),
    );
    const session = await this.sessionRepo.findOne({
      where: { id: Number(conversation.sessionId) },
      select: { id: true, identityClaims: true },
    });
    const raised = await this.alerts.raise(
      {
        tenantId,
        conversationId,
        sessionId: Number(conversation.sessionId),
        reason: 'rerouted',
        preview,
        targetUserIds: policy.assigneeUserIds,
        issueLabel: team.jobLabel,
        supportLabel: team.label,
        partnerLabel: partnerLabelOfClaims(session?.identityClaims),
        ...(region ? { supportRegion: region, regionLabel: REGION_NAME[region] ?? region } : {}),
        ...(!region && conversation.supportRegionHint && input.region === undefined
          ? { regionUnmapped: conversation.supportRegionHint }
          : {}),
        regionMode: policy.regionMode,
      },
      { supersede: true },
    );

    const targetUserId = raised?.targetUserId ?? null;
    const targetName = targetUserId != null ? await this.nameOf(tenantId, targetUserId) : null;
    const actorName = await this.nameOf(tenantId, actorUserId);
    await this.note(
      tenantId,
      conversationId,
      actorUserId,
      `Routed to ${team.label}${region ? ` (${REGION_NAME[region] ?? region})` : ''} by ${actorName ?? `user #${actorUserId}`}`,
    );
    await this.audit
      .write({
        tenantId,
        actorType: 'user',
        actorId: actorUserId,
        action: 'agent.conversation_rerouted',
        target: `conversation:${conversationId}`,
        metadata: {
          from: { supportType: previous.supportType, supportRegion: previous.supportRegion, status: previous.status, agentId: previous.agentId },
          to: { supportType: team.id, supportRegion: region ?? null },
          paged: targetUserId,
        },
      })
      .catch((e: Error) => this.logger.warn(`reroute audit failed: ${e.message}`));

    return {
      id: conversationId,
      status: CONVERSATION_STATUS.WAITING,
      supportType: team.id,
      supportRegion: region ?? null,
      notified: { userId: targetUserId, name: targetName, region: raised?.targetRegion ?? null },
    };
  }

  /**
   * Queue counters per team and region (PLN-261012 SG-66), over the conversations the list
   * shows for `scope` (and `channel`): the chips read "All teams 14 · CS 9 · Business 5".
   * The unclaimed figure and the oldest wait are for WAITING conversations nobody holds.
   * Only the tenant's own rows are counted.
   */
  async queueCounts(
    tenantId: number,
    userId: number,
    scope: 'all' | 'queue' | 'ended' = 'all',
    channel?: string,
  ): Promise<QueueCounts> {
    const statuses =
      scope === 'queue'
        ? [CONVERSATION_STATUS.WAITING, CONVERSATION_STATUS.AGENT]
        : scope === 'ended'
          ? [CONVERSATION_STATUS.ENDED]
          : [CONVERSATION_STATUS.AI_ACTIVE, CONVERSATION_STATUS.WAITING, CONVERSATION_STATUS.AGENT];
    const base = () => {
      const qb = this.convRepo
        .createQueryBuilder('c')
        .where('c.tenant_id = :tenantId', { tenantId })
        .andWhere('c.status IN (:...statuses)', { statuses });
      // Same widget/NULL rule as the list, so a chip count matches what clicking it shows.
      const ch = channel?.trim();
      if (ch && ch !== 'all') {
        if (ch === 'widget') qb.andWhere("(c.channel = 'widget' OR c.channel IS NULL)");
        else qb.andWhere('c.channel = :channel', { channel: ch });
      }
      return qb;
    };

    const grouped = await base()
      .select('c.support_type', 'supportType')
      .addSelect('c.support_region', 'supportRegion')
      .addSelect('CASE WHEN c.support_region IS NULL AND c.support_region_hint IS NOT NULL THEN 1 ELSE 0 END', 'unmapped')
      .addSelect('COUNT(*)', 'n')
      .groupBy('c.support_type')
      .addGroupBy('c.support_region')
      .addGroupBy('unmapped')
      .getRawMany<{ supportType: string | null; supportRegion: string | null; unmapped: string | number; n: string | number }>();

    const out: QueueCounts = {
      total: 0,
      teams: [],
      regions: { north: 0, south: 0, none: 0, unmapped: 0 },
      unclaimed: 0,
      oldestUnclaimedAt: null,
      myRegion: await this.userRegion(tenantId, userId),
    };
    const byTeam = new Map<string | null, number>();
    for (const row of grouped) {
      const n = Number(row.n) || 0;
      out.total += n;
      byTeam.set(row.supportType ?? null, (byTeam.get(row.supportType ?? null) ?? 0) + n);
      if (row.supportRegion === 'north') out.regions.north += n;
      else if (row.supportRegion === 'south') out.regions.south += n;
      else {
        out.regions.none += n;
        if (Number(row.unmapped) === 1) out.regions.unmapped += n;
      }
    }
    out.teams = [...byTeam.entries()]
      .map(([id, count]) => ({ id, count }))
      .sort((a, b) => b.count - a.count || String(a.id).localeCompare(String(b.id)));

    const waiting = await this.convRepo
      .createQueryBuilder('c')
      .select('COUNT(*)', 'n')
      .addSelect('MIN(c.escalated_at)', 'oldest')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.status = :waiting', { waiting: CONVERSATION_STATUS.WAITING })
      .andWhere('c.agent_id IS NULL')
      .getRawOne<{ n: string | number; oldest: Date | string | null }>();
    out.unclaimed = Number(waiting?.n ?? 0);
    out.oldestUnclaimedAt = waiting?.oldest ? new Date(waiting.oldest) : null;
    return out;
  }

  /** A user's `users.region` (north | south), or null for nationwide / unknown. */
  async userRegion(tenantId: number, userId: number): Promise<string | null> {
    try {
      const user = await this.userRepo.findOne({ where: { id: userId, tenantId }, select: { id: true, region: true } });
      return user?.region ?? null;
    } catch (e) {
      this.logger.warn(`region lookup failed (user ${userId}): ${(e as Error).message}`);
      return null;
    }
  }

  private async nameOf(tenantId: number, userId: number): Promise<string | null> {
    try {
      // Name, else the e-mail's words (w3c): the toast and the note then name the person.
      const user = await this.userRepo.findOne({ where: { id: userId, tenantId }, select: { id: true, name: true, email: true } });
      return displayNameOf(user);
    } catch {
      return null;
    }
  }

  /** The thread note. Best effort: a note is never worth failing the hand-over for. */
  private async note(tenantId: number, conversationId: number, authorId: number, body: string): Promise<void> {
    try {
      await this.commentRepo.save(
        this.commentRepo.create({ tenantId, scope: COMMENT_SCOPE.CONVERSATION, conversationId, sessionId: null, authorId, body }),
      );
    } catch (e) {
      this.logger.warn(`reroute note failed (conversation ${conversationId}): ${(e as Error).message}`);
    }
  }
}
