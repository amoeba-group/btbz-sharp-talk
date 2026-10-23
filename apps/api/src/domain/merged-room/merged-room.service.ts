import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { CONVERSATION_STATUS } from '@sharptalk/types';
import { MergedRoom } from './entity/merged-room.entity';
import { MERGED_SESSION_STATE, MergedRoomSession } from './entity/merged-room-session.entity';
import { Session } from '../session/entity/session.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { Customer } from '../customer/entity/customer.entity';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

const OPEN_STATUSES: string[] = [
  CONVERSATION_STATUS.AI_ACTIVE,
  CONVERSATION_STATUS.WAITING,
  CONVERSATION_STATUS.AGENT,
];

/** How many same-customer sessions the merge dialog lists at most. */
const CANDIDATE_LIMIT = 50;

/** How a candidate session matched the conversation's customer (D1). */
export type MergeMatch = 'customer' | 'email' | 'claimed' | 'company';

export interface MergedSessionView {
  sessionId: number;
  /** Newest conversation of the session — what choosing it opens. */
  conversationId: number;
  channel: string;
  alias: string | null;
  lastAt: Date;
  /** The newest conversation is still going (AI, waiting or with an agent). */
  open: boolean;
  /** Joined by auto-join rather than by an operator. */
  auto: boolean;
}

export interface MergedRoomView {
  id: number;
  customerId: number | null;
  companyId: number | null;
  autoJoin: boolean;
  sessions: MergedSessionView[];
}

export interface MergeCandidateView {
  sessionId: number;
  conversationId: number;
  channel: string;
  alias: string | null;
  lastAt: Date;
  open: boolean;
  matchedBy: MergeMatch;
  /** Only the unsigned host claim ties it to the customer (PLN-261023 D4). */
  unverified: boolean;
  /** The conversation the dialog was opened from. */
  current: boolean;
  /** Already in this conversation's room. */
  inRoom: boolean;
  /** Taken out of this room earlier (D6) — merging it again is an explicit choice. */
  excluded: boolean;
  /** Sits in ANOTHER customer's room — cannot be merged here. */
  otherRoom: boolean;
}

interface Identity {
  /** The customer a new room is keyed on: the session's, else its conversations' newest. */
  anchor: number | null;
  /** Rows on the session and its conversations — matched "by account". */
  own: number[];
  /** Customer rows that count as the same person: the anchor's + same-email rows (D1). */
  customerIds: number[];
  /**
   * B2B company of the session or its conversations — for a business the
   * hotel IS the customer, so its other staff's sessions match (F1).
   */
  companyIds: number[];
}

/**
 * Merged room over the same customer's sessions
 * (PLN-261023-LiveChat-Merge-Same-Customer-Sessions).
 *
 * Same person = a confirmed identity (D1): the same customer row on the
 * session or on one of its conversations (a claimed host sign-in is filed on
 * the conversation only — PLN-261023 S4), or another customer row with the
 * same email (blind index). For a business, the same B2B company (hotel) as
 * well — its other staff are the same customer (PLN-261023-LiveChat-Merge-
 * Company-Conversations F1). A guest has no identity and is never merged.
 *
 * The room only changes what the console SHOWS together; every send, status,
 * assignment and stat stays per conversation.
 */
@Injectable()
export class MergedRoomService {
  private readonly logger = new Logger(MergedRoomService.name);

  constructor(
    @InjectRepository(MergedRoom) private readonly roomRepo: Repository<MergedRoom>,
    @InjectRepository(MergedRoomSession) private readonly memberRepo: Repository<MergedRoomSession>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @Optional() private readonly audit?: AuditService,
  ) {}

  // ---- identity ----

  /** The customer rows and companies a session belongs to, or null for a guest. */
  private async identityOf(tenantId: number, sessionId: number): Promise<Identity | null> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, tenantId },
      select: { id: true, customerId: true, companyId: true },
    });
    if (!session) return null;
    const filed = await this.convRepo.find({
      where: [
        { tenantId, sessionId, customerId: Not(IsNull()) },
        { tenantId, sessionId, companyId: Not(IsNull()) },
      ],
      select: { id: true, customerId: true, companyId: true },
      order: { id: 'DESC' },
    });
    // Session first, then its conversations newest first — the anchor is the head.
    const own = [
      ...(session.customerId != null ? [Number(session.customerId)] : []),
      ...filed.filter((c) => c.customerId != null).map((c) => Number(c.customerId)),
    ];
    const companies = [
      ...(session.companyId != null ? [Number(session.companyId)] : []),
      ...filed.filter((c) => c.companyId != null).map((c) => Number(c.companyId)),
    ];
    if (!own.length && !companies.length) return null;
    const unique = [...new Set(own)];
    return {
      anchor: own[0] ?? null,
      own: unique,
      customerIds: unique.length ? await this.withSameEmail(tenantId, unique) : [],
      companyIds: [...new Set(companies)],
    };
  }

  /** Rooms keyed on any of the identity's customers or companies (OR), oldest first. */
  private async roomsFor(tenantId: number, identity: Identity, autoJoinOnly = false): Promise<MergedRoom[]> {
    const extra = autoJoinOnly ? { autoJoin: 1 } : {};
    const where = [
      ...(identity.customerIds.length ? [{ tenantId, customerId: In(identity.customerIds), ...extra }] : []),
      ...(identity.companyIds.length ? [{ tenantId, companyId: In(identity.companyIds), ...extra }] : []),
    ];
    if (!where.length) return [];
    return this.roomRepo.find({ where, order: { id: 'ASC' } });
  }

  /** The given customer rows plus every other row with the same email. */
  private async withSameEmail(tenantId: number, customerIds: number[]): Promise<number[]> {
    const rows = await this.customerRepo.find({
      where: { tenantId, id: In(customerIds) },
      select: { id: true, emailHash: true },
    });
    const hashes = [...new Set(rows.map((r) => r.emailHash).filter((h): h is string => !!h))];
    const same = hashes.length
      ? await this.customerRepo.find({ where: { tenantId, emailHash: In(hashes) }, select: { id: true } })
      : [];
    return [...new Set([...customerIds, ...same.map((c) => Number(c.id))])];
  }

  /**
   * Sessions of those customers, each with how it matched: on the session
   * itself (customer / email), or only through a claimed conversation.
   */
  private async sessionsOf(
    tenantId: number,
    identity: Identity,
    emailOnly: Set<number>,
  ): Promise<Map<number, MergeMatch>> {
    const out = new Map<number, MergeMatch>();
    if (identity.customerIds.length) await this.sessionsOfCustomers(tenantId, identity, emailOnly, out);
    if (identity.companyIds.length) {
      const byCompany = await this.sessionRepo.find({
        where: { tenantId, companyId: In(identity.companyIds) },
        select: { id: true },
        order: { id: 'DESC' },
        take: CANDIDATE_LIMIT,
      });
      for (const s of byCompany) if (!out.has(Number(s.id))) out.set(Number(s.id), 'company');
      const filedUnder = await this.convRepo
        .createQueryBuilder('c')
        .select('DISTINCT c.session_id', 'sessionId')
        .where('c.tenant_id = :tenantId AND c.company_id IN (:...ids)', { tenantId, ids: identity.companyIds })
        .orderBy('c.session_id', 'DESC')
        .limit(CANDIDATE_LIMIT)
        .getRawMany<{ sessionId: string }>();
      for (const r of filedUnder) if (!out.has(Number(r.sessionId))) out.set(Number(r.sessionId), 'company');
    }
    return out;
  }

  private async sessionsOfCustomers(
    tenantId: number,
    identity: Identity,
    emailOnly: Set<number>,
    out: Map<number, MergeMatch>,
  ): Promise<void> {
    const bySession = await this.sessionRepo.find({
      where: { tenantId, customerId: In(identity.customerIds) },
      select: { id: true, customerId: true },
      order: { id: 'DESC' },
      take: CANDIDATE_LIMIT,
    });
    for (const s of bySession) out.set(Number(s.id), emailOnly.has(Number(s.customerId)) ? 'email' : 'customer');
    const byConversation = await this.convRepo
      .createQueryBuilder('c')
      .select('DISTINCT c.session_id', 'sessionId')
      .where('c.tenant_id = :tenantId AND c.customer_id IN (:...ids)', { tenantId, ids: identity.customerIds })
      .orderBy('c.session_id', 'DESC')
      .limit(CANDIDATE_LIMIT)
      .getRawMany<{ sessionId: string }>();
    for (const r of byConversation) {
      const sid = Number(r.sessionId);
      if (!out.has(sid)) out.set(sid, 'claimed');
    }
  }

  // ---- reads ----

  /** The room a session is a member of, or null. */
  async roomOfSession(tenantId: number, sessionId: number): Promise<MergedRoomView | null> {
    const row = await this.memberRepo.findOne({
      where: { tenantId, sessionId, state: MERGED_SESSION_STATE.MEMBER },
    });
    if (!row) return null;
    return this.view(tenantId, Number(row.roomId));
  }

  /**
   * Every conversation of the room the session is in — the merged transcript
   * and its "session N · channel · date" dividers. Null outside a room.
   */
  async roomConversations(
    tenantId: number,
    sessionId: number,
  ): Promise<Array<{ id: number; sessionId: number; channel: string; status: string; createdAt: Date }> | null> {
    const row = await this.memberRepo.findOne({
      where: { tenantId, sessionId, state: MERGED_SESSION_STATE.MEMBER },
    });
    if (!row) return null;
    const members = await this.memberRepo.find({
      where: { tenantId, roomId: Number(row.roomId), state: MERGED_SESSION_STATE.MEMBER },
    });
    const convs = await this.convRepo.find({
      where: { tenantId, sessionId: In(members.map((m) => Number(m.sessionId))) },
      select: { id: true, sessionId: true, channel: true, status: true, createdAt: true },
      order: { id: 'ASC' },
    });
    return convs.map((c) => ({
      id: Number(c.id),
      sessionId: Number(c.sessionId),
      channel: c.channel || 'widget',
      status: c.status,
      createdAt: c.createdAt,
    }));
  }

  /**
   * Queue badges: room id, member count and how many member sessions have a
   * conversation still going, per session — one pass for a page of rows.
   */
  async badgesForSessions(
    tenantId: number,
    sessionIds: number[],
  ): Promise<Map<number, { roomId: number; sessionCount: number; openCount: number }>> {
    const out = new Map<number, { roomId: number; sessionCount: number; openCount: number }>();
    const ids = [...new Set(sessionIds.map(Number))];
    if (!ids.length) return out;
    const rows = await this.memberRepo.find({
      where: { tenantId, sessionId: In(ids), state: MERGED_SESSION_STATE.MEMBER },
    });
    if (!rows.length) return out;
    const roomIds = [...new Set(rows.map((r) => Number(r.roomId)))];
    const members = await this.memberRepo.find({
      where: { tenantId, roomId: In(roomIds), state: MERGED_SESSION_STATE.MEMBER },
    });
    const open = await this.convRepo.find({
      where: { tenantId, sessionId: In(members.map((m) => Number(m.sessionId))), status: In(OPEN_STATUSES) },
      select: { id: true, sessionId: true },
    });
    const openSessions = new Set(open.map((c) => Number(c.sessionId)));
    const perRoom = new Map<number, { sessionCount: number; openCount: number }>();
    for (const m of members) {
      const agg = perRoom.get(Number(m.roomId)) ?? { sessionCount: 0, openCount: 0 };
      agg.sessionCount += 1;
      if (openSessions.has(Number(m.sessionId))) agg.openCount += 1;
      perRoom.set(Number(m.roomId), agg);
    }
    for (const r of rows) {
      const agg = perRoom.get(Number(r.roomId));
      if (agg) out.set(Number(r.sessionId), { roomId: Number(r.roomId), ...agg });
    }
    return out;
  }

  private async view(tenantId: number, roomId: number): Promise<MergedRoomView | null> {
    const room = await this.roomRepo.findOne({ where: { id: roomId, tenantId } });
    if (!room) return null;
    const members = await this.memberRepo.find({
      where: { tenantId, roomId, state: MERGED_SESSION_STATE.MEMBER },
    });
    const latest = await this.latestConversations(
      tenantId,
      members.map((m) => Number(m.sessionId)),
    );
    const sessions = await this.sessionRepo.find({
      where: { tenantId, id: In(members.map((m) => Number(m.sessionId))) },
      select: { id: true, alias: true },
    });
    const alias = new Map(sessions.map((s) => [Number(s.id), s.alias ?? null]));
    const views: MergedSessionView[] = [];
    for (const m of members) {
      const c = latest.get(Number(m.sessionId));
      if (!c) continue;
      views.push({
        sessionId: Number(m.sessionId),
        conversationId: Number(c.id),
        channel: c.channel || 'widget',
        alias: alias.get(Number(m.sessionId)) ?? null,
        lastAt: c.createdAt,
        open: OPEN_STATUSES.includes(c.status),
        auto: m.addedBy == null,
      });
    }
    views.sort((a, b) => b.conversationId - a.conversationId);
    return {
      id: Number(room.id),
      customerId: room.customerId != null ? Number(room.customerId) : null,
      companyId: room.companyId != null ? Number(room.companyId) : null,
      autoJoin: room.autoJoin === 1,
      sessions: views,
    };
  }

  private async latestConversations(tenantId: number, sessionIds: number[]): Promise<Map<number, Conversation>> {
    const out = new Map<number, Conversation>();
    if (!sessionIds.length) return out;
    const convs = await this.convRepo.find({
      where: { tenantId, sessionId: In(sessionIds) },
      order: { id: 'DESC' },
    });
    for (const c of convs) if (!out.has(Number(c.sessionId))) out.set(Number(c.sessionId), c);
    return out;
  }

  /**
   * The merge dialog: every session of this conversation's customer (D1), the
   * current one included, with where each stands. Session metadata only — no
   * message of another session leaves here before the operator merges it.
   */
  async candidates(
    conversationId: number,
    tenantId: number,
  ): Promise<{ sessionId: number; room: MergedRoomView | null; sessions: MergeCandidateView[] }> {
    const conv = await this.convRepo.findOne({ where: { id: conversationId, tenantId } });
    if (!conv) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    const sessionId = Number(conv.sessionId);
    const room = await this.roomOfSession(tenantId, sessionId);
    const identity = await this.identityOf(tenantId, sessionId);
    if (!identity) return { sessionId, room, sessions: [] };

    // "Same email" = another customer ROW; the session's own rows match by account.
    const emailOnly = new Set(identity.customerIds.filter((id) => !identity.own.includes(id)));
    const matched = await this.sessionsOf(tenantId, identity, emailOnly);
    matched.set(sessionId, matched.get(sessionId) ?? 'customer');

    const ids = [...matched.keys()];
    const placed = await this.memberRepo.find({ where: { tenantId, sessionId: In(ids) } });
    const placeOf = new Map(placed.map((p) => [Number(p.sessionId), p]));
    const latest = await this.latestConversations(tenantId, ids);
    const sessions = await this.sessionRepo.find({
      where: { tenantId, id: In(ids) },
      select: { id: true, alias: true, customerId: true, companyId: true },
    });
    const sessionById = new Map(sessions.map((s) => [Number(s.id), s]));

    const out: MergeCandidateView[] = [];
    for (const [sid, how] of matched) {
      const c = latest.get(sid);
      // A session nobody ever wrote in has nothing to merge.
      if (!c) continue;
      const place = placeOf.get(sid);
      const inThisRoom = !!room && !!place && Number(place.roomId) === room.id;
      out.push({
        sessionId: sid,
        conversationId: Number(c.id),
        channel: c.channel || 'widget',
        alias: sessionById.get(sid)?.alias ?? null,
        lastAt: c.createdAt,
        open: OPEN_STATUSES.includes(c.status),
        matchedBy: how,
        // Only an unsigned host claim ties it in: no customer or company on the session itself.
        unverified:
          (how === 'claimed' || how === 'company') &&
          sessionById.get(sid)?.customerId == null &&
          sessionById.get(sid)?.companyId == null,
        current: sid === sessionId,
        inRoom: inThisRoom && place!.state === MERGED_SESSION_STATE.MEMBER,
        excluded: inThisRoom && place!.state === MERGED_SESSION_STATE.EXCLUDED,
        otherRoom: !!place && !inThisRoom,
      });
    }
    out.sort((a, b) => b.conversationId - a.conversationId);
    return { sessionId, room, sessions: out.slice(0, CANDIDATE_LIMIT) };
  }


  // ---- writes ----

  /**
   * Merge `sessionIds` with this conversation's session. Every session is
   * re-checked against the customer here — the dialog's list is not trusted.
   * Joins the customer's existing room when there is one (D5).
   */
  async merge(
    tenantId: number,
    userId: number,
    conversationId: number,
    sessionIds: number[],
    autoJoin: boolean,
  ): Promise<MergedRoomView> {
    const { sessionId, room: current, sessions } = await this.candidates(conversationId, tenantId);
    if (!sessions.length) {
      this.logger.warn(`merge refused: conversation=${conversationId} has no confirmed customer`);
      throw new BusinessException(ERROR_CODE.MERGE_NO_IDENTITY, HttpStatus.BAD_REQUEST);
    }
    const allowed = new Map(sessions.map((s) => [s.sessionId, s]));
    const wanted = [...new Set([sessionId, ...sessionIds.map(Number)])];
    const bad = wanted.filter((sid) => !allowed.has(sid) || allowed.get(sid)!.otherRoom);
    if (bad.length) {
      this.logger.warn(`merge refused: sessions ${bad.join(',')} are not this customer's or sit in another room`);
      throw new BusinessException(ERROR_CODE.MERGE_SESSION_CONFLICT, HttpStatus.CONFLICT);
    }
    const memberCount = wanted.length + (current ? current.sessions.filter((s) => !wanted.includes(s.sessionId)).length : 0);
    if (memberCount < 2) throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);

    const identity = (await this.identityOf(tenantId, sessionId))!;
    let room = current ? await this.roomRepo.findOne({ where: { id: current.id, tenantId } }) : null;
    room ??= (await this.roomsFor(tenantId, identity))[0] ?? null;
    const company = identity.companyIds[0] ?? null;
    const created = !room;
    let changed = created;
    if (!room) {
      room = await this.roomRepo.save(
        this.roomRepo.create({
          tenantId,
          customerId: identity.anchor,
          companyId: company,
          autoJoin: autoJoin ? 1 : 0,
          createdBy: userId,
        }),
      );
    } else {
      // A room merged for a person picks up their company when merged again from
      // a business thread (F3) — unless another room is already that company's.
      if (room.companyId == null && company != null) {
        const taken = await this.roomRepo.findOne({ where: { tenantId, companyId: company }, select: { id: true } });
        if (!taken) {
          room.companyId = company;
          changed = true;
        }
      }
      if (room.customerId == null && identity.anchor != null) {
        const taken = await this.roomRepo.findOne({ where: { tenantId, customerId: identity.anchor }, select: { id: true } });
        if (!taken) {
          room.customerId = identity.anchor;
          changed = true;
        }
      }
      if ((room.autoJoin === 1) !== autoJoin) {
        room.autoJoin = autoJoin ? 1 : 0;
        changed = true;
      }
      if (changed) room = await this.roomRepo.save(room);
    }
    const roomId = Number(room.id);

    const existing = await this.memberRepo.find({ where: { tenantId, sessionId: In(wanted) } });
    const have = new Map(existing.map((e) => [Number(e.sessionId), e]));
    for (const sid of wanted) {
      const row = have.get(sid);
      if (!row) {
        await this.memberRepo.save(
          this.memberRepo.create({ tenantId, roomId, sessionId: sid, state: MERGED_SESSION_STATE.MEMBER, addedBy: userId }),
        );
        changed = true;
      } else if (Number(row.roomId) === roomId && row.state !== MERGED_SESSION_STATE.MEMBER) {
        await this.memberRepo.update({ id: Number(row.id) }, { state: MERGED_SESSION_STATE.MEMBER, addedBy: userId });
        changed = true;
      }
    }
    // A repeated click that changes nothing leaves no audit row.
    if (changed) await this.audit?.write({
      tenantId,
      actorType: 'user',
      actorId: userId,
      action: created ? 'merged_room.created' : 'merged_room.sessions_added',
      target: `merged_room:${roomId}`,
      metadata: { sessionIds: wanted, autoJoin, conversationId },
    });
    return (await this.view(tenantId, roomId))!;
  }

  private async owned(id: number, tenantId: number): Promise<MergedRoom> {
    const room = await this.roomRepo.findOne({ where: { id, tenantId } });
    if (!room) {
      this.logger.warn(`merged room refused: id=${id} tenant=${tenantId}`);
      throw new BusinessException(ERROR_CODE.MERGED_ROOM_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return room;
  }

  async setAutoJoin(id: number, tenantId: number, userId: number, on: boolean): Promise<MergedRoomView> {
    const room = await this.owned(id, tenantId);
    await this.roomRepo.update({ id: Number(room.id) }, { autoJoin: on ? 1 : 0 });
    await this.audit?.write({
      tenantId,
      actorType: 'user',
      actorId: userId,
      action: 'merged_room.auto_join',
      target: `merged_room:${id}`,
      metadata: { autoJoin: on },
    });
    return (await this.view(tenantId, Number(room.id)))!;
  }

  /**
   * Take one session out (D6): remembered as excluded so auto-join never
   * brings it back. A room left with one session is no longer a merge — it
   * is dissolved and `null` returned.
   */
  async removeSession(id: number, tenantId: number, userId: number, sessionId: number): Promise<MergedRoomView | null> {
    const room = await this.owned(id, tenantId);
    const row = await this.memberRepo.findOne({
      where: { tenantId, roomId: Number(room.id), sessionId, state: MERGED_SESSION_STATE.MEMBER },
    });
    if (!row) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    const remaining = await this.memberRepo.count({
      where: { tenantId, roomId: Number(room.id), state: MERGED_SESSION_STATE.MEMBER },
    });
    if (remaining <= 2) {
      await this.dissolve(id, tenantId, userId, 'last_session_removed');
      return null;
    }
    await this.memberRepo.update({ id: Number(row.id) }, { state: MERGED_SESSION_STATE.EXCLUDED });
    await this.audit?.write({
      tenantId,
      actorType: 'user',
      actorId: userId,
      action: 'merged_room.session_removed',
      target: `merged_room:${id}`,
      metadata: { sessionId },
    });
    return this.view(tenantId, Number(room.id));
  }

  /** Dissolve: the room and its memberships go; every conversation stays. */
  async dissolve(id: number, tenantId: number, userId: number, reason = 'operator'): Promise<void> {
    const room = await this.owned(id, tenantId);
    await this.memberRepo.delete({ tenantId, roomId: Number(room.id) });
    await this.roomRepo.delete({ id: Number(room.id), tenantId });
    await this.audit?.write({
      tenantId,
      actorType: 'user',
      actorId: userId,
      action: 'merged_room.dissolved',
      target: `merged_room:${id}`,
      metadata: { customerId: room.customerId, companyId: room.companyId, reason },
    });
  }

  /**
   * Auto-join (D4): put this session into its customer's room when the room
   * has auto-join on and the session was never placed (an excluded session
   * stays out). Called on every widget message, so the common cases — no
   * room in the tenant, session already placed — cost one indexed lookup.
   * Never throws: a failure here must not cost the shopper their message.
   */
  async autoJoin(tenantId: number | null, sessionId: number): Promise<void> {
    if (tenantId == null) return;
    try {
      const anyRoom = await this.roomRepo.findOne({ where: { tenantId, autoJoin: 1 }, select: { id: true } });
      if (!anyRoom) return;
      const placed = await this.memberRepo.findOne({ where: { tenantId, sessionId }, select: { id: true } });
      if (placed) return;
      const identity = await this.identityOf(tenantId, sessionId);
      if (!identity) return;
      const room = (await this.roomsFor(tenantId, identity, true))[0];
      if (!room) return;
      await this.memberRepo.save(
        this.memberRepo.create({
          tenantId,
          roomId: Number(room.id),
          sessionId,
          state: MERGED_SESSION_STATE.MEMBER,
          addedBy: null,
        }),
      );
      await this.audit?.write({
        tenantId,
        actorType: 'system',
        actorId: 0,
        action: 'merged_room.auto_joined',
        target: `merged_room:${room.id}`,
        metadata: { sessionId },
      });
    } catch (err) {
      // A racing message of the same session hits the unique key — already joined.
      if ((err as { code?: string })?.code === 'ER_DUP_ENTRY') return;
      this.logger.warn(`merged room auto-join failed: session=${sessionId} — ${(err as Error).message}`);
    }
  }

  /**
   * DSAR erasure: a room keyed only on the erased person goes with them; a
   * company's room stays (a company is not a data subject) and just forgets
   * the person.
   */
  async eraseCustomer(tenantId: number, customerId: number): Promise<void> {
    const rooms = await this.roomRepo.find({ where: { tenantId, customerId } });
    const personal = rooms.filter((r) => r.companyId == null).map((r) => Number(r.id));
    const company = rooms.filter((r) => r.companyId != null).map((r) => Number(r.id));
    if (company.length) await this.roomRepo.update({ tenantId, id: In(company) }, { customerId: null });
    if (!personal.length) return;
    await this.memberRepo.delete({ tenantId, roomId: In(personal) });
    await this.roomRepo.delete({ tenantId, id: In(personal) });
  }
}

