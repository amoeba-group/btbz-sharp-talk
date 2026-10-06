import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, LessThan, Repository } from 'typeorm';
import { CONVERSATION_STATUS } from '@sharptalk/types';
import { ChatGroup, GroupKind } from './entity/chat-group.entity';
import { ChatGroupMember } from './entity/chat-group-member.entity';
import { Session } from '../session/entity/session.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { Customer } from '../customer/entity/customer.entity';
import { AgentService } from './agent.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/** Statuses that count as "the conversation the customer is in right now". */
const OPEN_STATUSES = [
  CONVERSATION_STATUS.AI_ACTIVE,
  CONVERSATION_STATUS.WAITING,
  CONVERSATION_STATUS.AGENT,
];

/** Channels that cannot receive an outbound reply (mirrors the console rule). */
const RECEIVE_ONLY_CHANNELS = new Set(['sms']);

/**
 * A group needs at least one session. It was two while a group was only a
 * merged view (one session needs no merging); since a group also carries the
 * customer's journey (PLN-261006 D2), a first-time customer with a single
 * session is a legitimate timeline.
 */
const MIN_MEMBERS = 1;

/** How many sibling sessions the same-person suggestion lists at most. */
const RELATED_LIMIT = 20;

const MESSAGE_PAGE_SIZE = 30;

export interface GroupRef {
  id: number;
  title: string;
  kind: GroupKind;
}

/** Another session of the same customer (PLN-261006 P1). */
export interface RelatedSessionView {
  sessionId: number;
  /** Its newest conversation — what a click opens. */
  conversationId: number;
  channel: string;
  alias: string | null;
  lastAt: Date;
  /** Which confirmed identity matched: the same customer row, or the same email on another row. */
  matchedBy: 'customer' | 'email';
  groups: GroupRef[];
}

export interface GroupMemberView {
  sessionId: number;
  alias: string | null;
  customerName: string | null;
  channel: string;
  receiveOnly: boolean;
  /** Where a 1:1 send to this member would land (open ?? latest conversation). */
  targetConversationId: number | null;
}

/**
 * Session grouping — timeline/project (REQ-260824, AmoebaTalk Bound Chat
 * reference). A group is a VIEW over its member sessions' conversations:
 * `kind` is a classifier with zero behavioral difference, membership is by
 * session (D1 — future conversations flow in automatically), and dissolving
 * deletes only the group rows. Sending is strictly 1:1 to one chosen member,
 * through the ordinary agent send path (moderation/consent/audit inherited).
 */
@Injectable()
export class ChatGroupService {
  private readonly logger = new Logger(ChatGroupService.name);

  constructor(
    @InjectRepository(ChatGroup) private readonly groupRepo: Repository<ChatGroup>,
    @InjectRepository(ChatGroupMember) private readonly memberRepo: Repository<ChatGroupMember>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    private readonly agentService: AgentService,
  ) {}

  private async owned(id: number, tenantId: number): Promise<ChatGroup> {
    const group = await this.groupRepo.findOne({ where: { id, tenantId } });
    if (!group) {
      this.logger.warn(`group refused: id=${id} tenant=${tenantId}`);
      throw new BusinessException(ERROR_CODE.GROUP_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return group;
  }

  /** Sessions must exist AND belong to the tenant — a mismatch is a plain 404. */
  private async requireTenantSessions(sessionIds: number[], tenantId: number): Promise<void> {
    const found = await this.sessionRepo.count({ where: { id: In(sessionIds), tenantId } });
    if (found !== sessionIds.length) {
      this.logger.warn(
        `group member refused: ${sessionIds.length - found} of ${sessionIds.length} sessions not in tenant ${tenantId}`,
      );
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
  }

  async list(
    tenantId: number,
  ): Promise<Array<{ group: ChatGroup; memberCount: number; lastMessageAt: Date | null }>> {
    const groups = await this.groupRepo.find({
      where: { tenantId },
      order: { id: 'DESC' },
      take: 100,
    });
    if (!groups.length) return [];
    const ids = groups.map((g) => Number(g.id));
    const members = await this.memberRepo.find({ where: { tenantId, groupId: In(ids) } });
    const counts = new Map<number, number>();
    for (const m of members) {
      counts.set(Number(m.groupId), (counts.get(Number(m.groupId)) ?? 0) + 1);
    }
    // One aggregate for every group's newest message across its member sessions.
    const rows: Array<{ groupId: string; lastAt: Date | null }> = await this.msgRepo
      .createQueryBuilder('m')
      .innerJoin(Conversation, 'c', 'c.id = m.conversation_id AND c.tenant_id = :tenantId')
      .innerJoin(
        ChatGroupMember,
        'gm',
        'gm.session_id = c.session_id AND gm.tenant_id = :tenantId',
      )
      .where('gm.group_id IN (:...ids)', { ids })
      .setParameter('tenantId', tenantId)
      .select('gm.group_id', 'groupId')
      .addSelect('MAX(m.created_at)', 'lastAt')
      .groupBy('gm.group_id')
      .getRawMany();
    const lastAt = new Map(rows.map((r) => [Number(r.groupId), r.lastAt]));
    return groups.map((group) => ({
      group,
      memberCount: counts.get(Number(group.id)) ?? 0,
      lastMessageAt: lastAt.get(Number(group.id)) ?? null,
    }));
  }

  async create(
    tenantId: number,
    userId: number,
    kind: GroupKind,
    title: string,
    sessionIds: number[],
  ): Promise<ChatGroup> {
    const unique = [...new Set(sessionIds.map(Number))];
    const trimmed = title.trim().slice(0, 100);
    if (unique.length < MIN_MEMBERS || !trimmed) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    await this.requireTenantSessions(unique, tenantId);
    const group = await this.groupRepo.save(
      this.groupRepo.create({ tenantId, kind, title: trimmed, createdBy: userId }),
    );
    await this.memberRepo.save(
      unique.map((sessionId) =>
        this.memberRepo.create({ tenantId, groupId: Number(group.id), sessionId, addedBy: userId }),
      ),
    );
    return group;
  }

  async detail(
    id: number,
    tenantId: number,
  ): Promise<{ group: ChatGroup; members: GroupMemberView[] }> {
    const group = await this.owned(id, tenantId);
    const members = await this.memberRepo.find({
      where: { groupId: Number(group.id), tenantId },
      order: { id: 'ASC' },
    });
    const sessionIds = members.map((m) => Number(m.sessionId));
    if (!sessionIds.length) return { group, members: [] };

    const sessions = await this.sessionRepo.find({ where: { id: In(sessionIds), tenantId } });
    const sessionById = new Map(sessions.map((s) => [Number(s.id), s]));
    const customerIds = [
      ...new Set(sessions.map((s) => s.customerId).filter((v): v is number => v != null)),
    ];
    const customers = customerIds.length
      ? await this.customerRepo.find({ where: { id: In(customerIds.map(Number)), tenantId } })
      : [];
    const customerById = new Map(customers.map((c) => [Number(c.id), c]));

    // Newest-first pass over all member conversations resolves, per session,
    // both "the open one" and "the latest one" without per-member queries.
    const convs = await this.convRepo.find({
      where: { tenantId, sessionId: In(sessionIds) },
      order: { id: 'DESC' },
    });
    const openBySession = new Map<number, Conversation>();
    const latestBySession = new Map<number, Conversation>();
    for (const c of convs) {
      const sid = Number(c.sessionId);
      if (!latestBySession.has(sid)) latestBySession.set(sid, c);
      if (!openBySession.has(sid) && (OPEN_STATUSES as string[]).includes(c.status)) {
        openBySession.set(sid, c);
      }
    }

    return {
      group,
      members: members.map((m) => {
        const sid = Number(m.sessionId);
        const session = sessionById.get(sid);
        const target = openBySession.get(sid) ?? latestBySession.get(sid) ?? null;
        const channel = target?.channel || 'widget';
        const customer =
          session?.customerId != null ? customerById.get(Number(session.customerId)) : undefined;
        return {
          sessionId: sid,
          alias: session?.alias ?? null,
          customerName: customer?.name ?? null,
          channel,
          receiveOnly: RECEIVE_ONLY_CHANNELS.has(channel),
          targetConversationId: target ? Number(target.id) : null,
        };
      }),
    };
  }

  /**
   * Merged feed (D2): one global message-id cursor over every conversation of
   * every member session, newest-anchored — exactly the transcript pager the
   * console already uses, widened from one conversation id to a set.
   */
  async messages(
    id: number,
    tenantId: number,
    opts: { limit?: number; beforeId?: number } = {},
  ): Promise<{
    messages: Message[];
    hasMore: boolean;
    conversationMeta: Map<string, { sessionId: number; channel: string }>;
  }> {
    const group = await this.owned(id, tenantId);
    const members = await this.memberRepo.find({
      where: { groupId: Number(group.id), tenantId },
    });
    const sessionIds = members.map((m) => Number(m.sessionId));
    const conversationMeta = new Map<string, { sessionId: number; channel: string }>();
    if (!sessionIds.length) return { messages: [], hasMore: false, conversationMeta };

    const convs = await this.convRepo.find({ where: { tenantId, sessionId: In(sessionIds) } });
    for (const c of convs) {
      conversationMeta.set(String(c.id), {
        sessionId: Number(c.sessionId),
        channel: c.channel || 'widget',
      });
    }
    if (!convs.length) return { messages: [], hasMore: false, conversationMeta };

    const limit = Math.min(Math.max(opts.limit ?? MESSAGE_PAGE_SIZE, 1), 200);
    const where: FindOptionsWhere<Message> = {
      conversationId: In(convs.map((c) => Number(c.id))),
    };
    if (opts.beforeId != null) where.id = LessThan(opts.beforeId);
    const rows = await this.msgRepo.find({ where, order: { id: 'DESC' }, take: limit + 1 });
    const hasMore = rows.length > limit;
    return { messages: rows.slice(0, limit).reverse(), hasMore, conversationMeta };
  }

  /**
   * 1:1 send (R3): to exactly one member session, into its open (else latest)
   * conversation, through AgentService.sendMessage unchanged — the group layer
   * only resolves the target. No broadcast exists on purpose.
   */
  async sendTo(
    id: number,
    tenantId: number,
    agentId: number,
    sessionId: number,
    body: string,
  ): Promise<{ message: Message; conversationId: number; channel: string }> {
    const group = await this.owned(id, tenantId);
    const member = await this.memberRepo.findOne({
      where: { groupId: Number(group.id), sessionId, tenantId },
    });
    if (!member) {
      this.logger.warn(`group send refused: session=${sessionId} not in group=${id}`);
      throw new BusinessException(ERROR_CODE.GROUP_RECIPIENT_INVALID, HttpStatus.BAD_REQUEST);
    }
    const target =
      (await this.convRepo.findOne({
        where: { tenantId, sessionId, status: In(OPEN_STATUSES as string[]) },
        order: { id: 'DESC' },
      })) ??
      (await this.convRepo.findOne({ where: { tenantId, sessionId }, order: { id: 'DESC' } }));
    if (!target || RECEIVE_ONLY_CHANNELS.has(target.channel || 'widget')) {
      this.logger.warn(
        `group send refused: session=${sessionId} target=${target?.id ?? 'none'} channel=${target?.channel ?? '-'}`,
      );
      throw new BusinessException(ERROR_CODE.GROUP_RECIPIENT_INVALID, HttpStatus.BAD_REQUEST);
    }
    const message = await this.agentService.sendMessage(
      Number(target.id),
      agentId,
      tenantId,
      body,
    );
    return { message, conversationId: Number(target.id), channel: target.channel || 'widget' };
  }

  async update(
    id: number,
    tenantId: number,
    patch: { title?: string; kind?: GroupKind },
  ): Promise<ChatGroup> {
    const group = await this.owned(id, tenantId);
    if (patch.title != null) {
      const trimmed = patch.title.trim().slice(0, 100);
      if (!trimmed) throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
      group.title = trimmed;
    }
    if (patch.kind != null) group.kind = patch.kind;
    return this.groupRepo.save(group);
  }

  /** Add sessions; ones already in the group are skipped, not an error. */
  async addMembers(
    id: number,
    tenantId: number,
    userId: number,
    sessionIds: number[],
  ): Promise<{ added: number }> {
    const group = await this.owned(id, tenantId);
    const unique = [...new Set(sessionIds.map(Number))];
    if (!unique.length) return { added: 0 };
    await this.requireTenantSessions(unique, tenantId);
    const existing = await this.memberRepo.find({
      where: { groupId: Number(group.id), tenantId, sessionId: In(unique) },
    });
    const have = new Set(existing.map((m) => Number(m.sessionId)));
    const fresh = unique.filter((sid) => !have.has(sid));
    if (fresh.length) {
      await this.memberRepo.save(
        fresh.map((sessionId) =>
          this.memberRepo.create({
            tenantId,
            groupId: Number(group.id),
            sessionId,
            addedBy: userId,
          }),
        ),
      );
    }
    return { added: fresh.length };
  }

  async removeMember(id: number, tenantId: number, sessionId: number): Promise<void> {
    const group = await this.owned(id, tenantId);
    const member = await this.memberRepo.findOne({
      where: { groupId: Number(group.id), sessionId, tenantId },
    });
    if (!member) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    const count = await this.memberRepo.count({ where: { groupId: Number(group.id), tenantId } });
    if (count <= MIN_MEMBERS) {
      this.logger.warn(`group member removal refused: group=${id} would drop below ${MIN_MEMBERS}`);
      throw new BusinessException(ERROR_CODE.GROUP_MIN_MEMBERS, HttpStatus.CONFLICT);
    }
    await this.memberRepo.delete({ id: Number(member.id) });
  }

  /** Groups each session belongs to, keyed by session id. */
  private async groupsOfSessions(tenantId: number, sessionIds: number[]): Promise<Map<number, GroupRef[]>> {
    const out = new Map<number, GroupRef[]>();
    if (!sessionIds.length) return out;
    const members = await this.memberRepo.find({ where: { tenantId, sessionId: In(sessionIds) } });
    if (!members.length) return out;
    const groups = await this.groupRepo.find({
      where: { tenantId, id: In([...new Set(members.map((m) => Number(m.groupId)))]) },
    });
    const byId = new Map(groups.map((g) => [Number(g.id), g]));
    for (const m of members) {
      const g = byId.get(Number(m.groupId));
      if (!g) continue;
      const list = out.get(Number(m.sessionId)) ?? [];
      list.push({ id: Number(g.id), title: g.title, kind: g.kind as GroupKind });
      out.set(Number(m.sessionId), list);
    }
    return out;
  }

  /**
   * Same-person suggestion (PLN-261006 P1, D4): other sessions of the customer
   * this conversation is linked to — by the same customer row, or by another
   * customer row with the same email (blind index). Confirmed identities only;
   * a guest session has no suggestion. Sessions that already share a group
   * with this one are left out — they are grouped already. Nothing is merged
   * here: the operator decides, and only session metadata leaves this method
   * (no message bodies of the other sessions before they are grouped).
   */
  async relatedSessions(
    conversationId: number,
    tenantId: number,
  ): Promise<{ sessionId: number; currentGroups: GroupRef[]; sessions: RelatedSessionView[] }> {
    const conv = await this.convRepo.findOne({ where: { id: conversationId, tenantId } });
    if (!conv) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    const sessionId = Number(conv.sessionId);
    const session = await this.sessionRepo.findOne({ where: { id: sessionId, tenantId } });
    const currentGroups = (await this.groupsOfSessions(tenantId, [sessionId])).get(sessionId) ?? [];
    if (session?.customerId == null) return { sessionId, currentGroups, sessions: [] };

    const ownId = Number(session.customerId);
    const own = await this.customerRepo.findOne({ where: { id: ownId, tenantId } });
    const sameEmail = own?.emailHash
      ? await this.customerRepo.find({ where: { tenantId, emailHash: own.emailHash } })
      : [];
    const customerIds = [...new Set([ownId, ...sameEmail.map((c) => Number(c.id))])];

    const siblings = (
      await this.sessionRepo.find({
        where: { tenantId, customerId: In(customerIds) },
        order: { id: 'DESC' },
        take: RELATED_LIMIT * 3,
      })
    ).filter((s) => Number(s.id) !== sessionId);
    if (!siblings.length) return { sessionId, currentGroups, sessions: [] };

    const siblingIds = siblings.map((s) => Number(s.id));
    const groupsBySession = await this.groupsOfSessions(tenantId, siblingIds);
    const shared = new Set(currentGroups.map((g) => g.id));
    const convs = await this.convRepo.find({
      where: { tenantId, sessionId: In(siblingIds) },
      order: { id: 'DESC' },
    });
    const latest = new Map<number, Conversation>();
    for (const c of convs) if (!latest.has(Number(c.sessionId))) latest.set(Number(c.sessionId), c);

    const sessions: RelatedSessionView[] = [];
    for (const s of siblings) {
      const sid = Number(s.id);
      const c = latest.get(sid);
      // A session nobody ever wrote in has nothing to look at.
      if (!c) continue;
      const groups = groupsBySession.get(sid) ?? [];
      if (groups.some((g) => shared.has(g.id))) continue;
      sessions.push({
        sessionId: sid,
        conversationId: Number(c.id),
        channel: c.channel || 'widget',
        alias: s.alias ?? null,
        lastAt: c.createdAt,
        matchedBy: Number(s.customerId) === ownId ? 'customer' : 'email',
        groups,
      });
      if (sessions.length >= RELATED_LIMIT) break;
    }
    return { sessionId, currentGroups, sessions };
  }

  /** Dissolve = delete the group and its memberships. Conversations untouched. */
  async dissolve(id: number, tenantId: number): Promise<void> {
    const group = await this.owned(id, tenantId);
    await this.memberRepo.delete({ groupId: Number(group.id), tenantId });
    await this.groupRepo.delete({ id: Number(group.id), tenantId });
  }
}
