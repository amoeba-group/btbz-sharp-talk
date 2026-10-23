import type { MergeCandidateView, MergedRoomView } from '../merged-room/merged-room.service';
import type { AnswerRating } from './entity/answer-rating.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { AgentProfile } from './entity/agent-profile.entity';
import { AgentDailyStat } from './entity/agent-daily-stat.entity';
import { AgentAlert } from './entity/agent-alert.entity';
import { MessageAttachment } from '../attachment/entity/message-attachment.entity';
import { AttachmentMapper } from '../attachment/attachment.mapper';
import { ChatComment } from './entity/chat-comment.entity';
import { ConversationBriefing } from './entity/conversation-briefing.entity';
import { ChatGroup } from './entity/chat-group.entity';
import { GroupMemberView, GroupRef, RelatedSessionView } from './chat-group.service';
import { SESSION_IDENTITY } from '@sharptalk/types';

/** Escalation alert row for the console alarm modal (FR-S3). */
export function toAlertResponse(a: AgentAlert) {
  return {
    id: a.id,
    conversationId: a.conversationId,
    sessionId: a.sessionId,
    reason: a.reason,
    preview: a.preview,
    status: a.status,
    createdAt: a.createdAt,
  };
}

/** Conversation row for the agent session queue (preview + flags). */
export function toSessionResponse(
  c: Conversation,
  lastMessage: Message | null,
  contact: { name: string | null; email: string | null } = { name: null, email: null },
  alias: string | null = null,
  autoReply: { mode: string; effective: boolean } = { mode: 'inherit', effective: true },
  aiAgent: { id: number | null; name: string | null } = { id: null, name: null },
  identityAttributes: Record<string, string> | null = null,
  identityLevel: string | null = null,
  companyName: string | null = null,
  match: { snippet: string; count: number; messageId: string } | null = null,
  mergedRoom: { roomId: number; sessionCount: number; openCount: number } | null = null,
) {
  return {
    id: c.id,
    /** Same-customer merged room this row stands for (PLN-261023 D2); null = a single session. */
    mergedRoom: mergedRoom
      ? { id: String(mergedRoom.roomId), sessionCount: mergedRoom.sessionCount, openCount: mergedRoom.openCount }
      : null,
    /** Transcript search hit (PLN-261023 S1): latest matching excerpt; null outside a search. */
    match,
    /**
     * What the host app signed about this user — hotel, region, role
     * (PLN-261015 D5). Not PII: a hotel id and a region name, shown as badges so
     * an agent sees which hotel is asking. camelCase keys, like every response.
     */
    identity: toIdentityResponse(identityAttributes, identityLevel),
    /** B2B company of the thread (PLN-261022 stage 2); null for consumers/guests. */
    companyId: c.companyId != null ? String(c.companyId) : null,
    /** That company's name — the title reads "customer / company" (PLN-261023). Not PII. */
    companyName,
    status: c.status,
    /** Effective AI agent of the session (REQ-260825 R6) — NULL pin = default. */
    aiAgentId: aiAgent.id != null ? String(aiAgent.id) : null,
    aiAgentName: aiAgent.name,
    // The session this row belongs to. The row id is a CONVERSATION id (the
    // console calls it a session), so the real session id has to travel too —
    // the alias hangs off the session, not the conversation (PLN-260812).
    sessionId: String(c.sessionId),
    /** Operator-set name; wins over customerName in the console. */
    alias,
    /** Session choice: inherit | on | off (PLN-260812). */
    autoReplyMode: autoReply.mode,
    /** What that resolves to once the channel default is applied. */
    autoReplyEffective: autoReply.effective,
    // Which surface the shopper is on (widget/telegram/zalo/kakao/sms/email…).
    // The console badges it so an agent knows what they are replying into —
    // an SMS thread cannot be answered at all (PLN-260810 PR-M4).
    channel: c.channel || 'widget',
    /** Team pin (PLN-260826) — pinned rows sort first in the queue. */
    pinned: c.pinnedAt != null,
    pinnedAt: c.pinnedAt ?? null,
    escalated: c.escalated === 1,
    // In the clear (2026-10-23 decision, reversing PLN-260920 for lists): the
    // queue is how an agent finds a customer. Masking stays inside the
    // conversation (detail header, customer panel) and on AI-bound text.
    customerName: contact.name,
    // Fallback identity for a shopper who only ever left an address.
    customerEmail: contact.email,
    lastMessagePreview: lastMessage ? lastMessage.body.slice(0, 140) : null,
    lastMessageAt: lastMessage?.createdAt ?? null,
    createdAt: c.createdAt,
  };
}

/** Message row in an agent conversation view. */
export function toMessageResponse(
  m: Message,
  senderName: string | null = null,
  attachments?: MessageAttachment[],
  rating?: AnswerRating,
) {
  return {
    id: m.id,
    /** Which conversation it belongs to — a merged room's transcript spans several (PLN-261023). */
    conversationId: String(m.conversationId),
    senderType: m.senderType,
    senderId: m.senderId,
    senderName,
    body: m.body,
    createdAt: m.createdAt,
    // Signed links, minted per response (PLN-260814).
    attachments: AttachmentMapper.toResponseList(attachments),
    /** Latest accuracy verdict on this answer (PLN-261015 D7); null = unrated. */
    rating: rating ? toRatingResponse(rating) : null,
  };
}

export function toRatingResponse(r: AnswerRating) {
  return {
    messageId: String(r.messageId),
    rating: r.rating,
    reason: r.reason,
    note: r.note,
    ratedBy: String(r.ratedBy),
    updatedAt: r.updatedAt,
  };
}

/** Group row for the console's group tab (PLN-260824-Session-Grouping). */
export function toGroupResponse(
  g: ChatGroup,
  memberCount: number,
  lastMessageAt: Date | null = null,
) {
  return {
    id: g.id,
    kind: g.kind,
    title: g.title,
    memberCount,
    lastMessageAt,
    createdBy: g.createdBy,
    createdAt: g.createdAt,
  };
}

export function toGroupDetailResponse(
  g: ChatGroup,
  members: GroupMemberView[],
  companyNames: Map<string, string | null> = new Map(),
) {
  return {
    ...toGroupResponse(g, members.length),
    members: members.map((m) => ({
      sessionId: String(m.sessionId),
      alias: m.alias,
      customerName: m.customerName,
      // Same name parts as the queue row (PLN-261023 S3): company, then what
      // the host said when nothing is on record.
      companyName: m.companyId != null ? (companyNames.get(String(m.companyId)) ?? null) : null,
      identityName: m.identityName,
      identityHotelName: m.identityHotelName,
      channel: m.channel,
      receiveOnly: m.receiveOnly,
      targetConversationId: m.targetConversationId != null ? String(m.targetConversationId) : null,
    })),
  };
}

/** Same-person suggestion (PLN-261006 P1) — metadata only, ids as strings. */
export function toRelatedSessionsResponse(r: {
  sessionId: number;
  currentGroups: GroupRef[];
  sessions: RelatedSessionView[];
}) {
  const group = (g: GroupRef) => ({ id: String(g.id), title: g.title, kind: g.kind });
  return {
    sessionId: String(r.sessionId),
    currentGroups: r.currentGroups.map(group),
    sessions: r.sessions.map((s) => ({
      sessionId: String(s.sessionId),
      conversationId: String(s.conversationId),
      channel: s.channel,
      alias: s.alias,
      lastAt: s.lastAt,
      matchedBy: s.matchedBy,
      groups: s.groups.map(group),
    })),
  };
}

/** Merged-feed row: a normal message plus which member session it came from. */
export function toGroupMessageResponse(
  m: Message,
  meta: { sessionId: number; channel: string } | undefined,
  senderName: string | null = null,
  attachments?: MessageAttachment[],
) {
  return {
    ...toMessageResponse(m, senderName, attachments),
    conversationId: String(m.conversationId),
    sessionId: meta ? String(meta.sessionId) : null,
    channel: meta?.channel ?? 'widget',
  };
}

/** Internal operator note (REQ-260824 R4) — console-only, never the shopper. */
export function toCommentResponse(c: ChatComment, authorName: string | null = null) {
  return {
    id: c.id,
    scope: c.scope,
    body: c.body,
    authorId: c.authorId,
    authorName,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** Stored on-demand briefing with its translations (REQ-260824 R3). */
export function toBriefingResponse(b: ConversationBriefing, requestedByName: string | null = null) {
  return {
    id: b.id,
    briefing: b.body,
    translations: b.translations ?? {},
    requestedBy: b.requestedBy,
    requestedByName,
    createdAt: b.createdAt,
  };
}

export function toProfileResponse(p: AgentProfile) {
  return {
    id: p.id,
    tenantId: p.tenantId,
    userId: p.userId,
    languages: p.languages,
    skills: p.skills,
    maxConcurrent: p.maxConcurrent,
    status: p.status,
  };
}

export function toStatResponse(s: AgentDailyStat) {
  return {
    id: s.id,
    tenantId: s.tenantId,
    agentId: s.agentId,
    statDate: s.statDate,
    handled: s.handled,
    avgFirstResponseSec: s.avgFirstResponseSec,
    avgHandleSec: s.avgHandleSec,
    resolved: s.resolved,
    escalated: s.escalated,
    csatAvg: s.csatAvg,
    onlineSec: s.onlineSec,
    blockedMsgs: s.blockedMsgs,
  };
}

/**
 * Host identity → console shape (PLN-261015 D5); null when the session has none.
 * `verified` is false for a 'claimed' session (unsigned host, PLN-261022): the
 * same facts plus who the host says it is (`userId`, `name`), none of it proven.
 */
export function toIdentityResponse(a: Record<string, string> | null | undefined, level: string | null = null) {
  if (!a) return null;
  return {
    hotelId: a.hotel_id ?? null,
    hotelName: a.hotel_name ?? null,
    region: a.region ?? null,
    province: a.province ?? null,
    role: a.role ?? null,
    userId: a.user_id ?? null,
    // Names are in the clear on every console screen (2026-10-23 decision);
    // masking is for AI-bound text, logs and contact details.
    name: a.name ?? null,
    verified: level !== SESSION_IDENTITY.CLAIMED,
  };
}

/** Merged room for the conversation header and its menu (PLN-261023). */
export function toMergedRoomResponse(room: MergedRoomView | null) {
  if (!room) return null;
  return {
    id: String(room.id),
    autoJoin: room.autoJoin,
    sessions: room.sessions.map((s) => ({
      sessionId: String(s.sessionId),
      conversationId: String(s.conversationId),
      channel: s.channel,
      alias: s.alias,
      lastAt: s.lastAt,
      open: s.open,
      auto: s.auto,
    })),
  };
}

export function toMergeCandidatesResponse(r: { sessionId: number; room: MergedRoomView | null; sessions: MergeCandidateView[] }) {
  return {
    sessionId: String(r.sessionId),
    room: toMergedRoomResponse(r.room),
    sessions: r.sessions.map((s) => ({
      sessionId: String(s.sessionId),
      conversationId: String(s.conversationId),
      channel: s.channel,
      alias: s.alias,
      lastAt: s.lastAt,
      open: s.open,
      matchedBy: s.matchedBy,
      unverified: s.unverified,
      current: s.current,
      inRoom: s.inRoom,
      excluded: s.excluded,
      otherRoom: s.otherRoom,
    })),
  };
}
