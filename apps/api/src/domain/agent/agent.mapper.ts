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
import { GroupMemberView } from './chat-group.service';
import { maskEmail, maskName } from '../../global/util/pii-display.util';

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
) {
  return {
    id: c.id,
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
    // Masked: the queue only has to let an agent tell two shoppers apart, and
    // it is on screen all day in a shared room (PLN-260920). The full value is
    // one audited reveal away in the customer panel.
    customerName: maskName(contact.name),
    // Fallback identity for a shopper who only ever left an address.
    customerEmail: maskEmail(contact.email),
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
) {
  return {
    id: m.id,
    senderType: m.senderType,
    senderId: m.senderId,
    senderName,
    body: m.body,
    createdAt: m.createdAt,
    // Signed links, minted per response (PLN-260814).
    attachments: AttachmentMapper.toResponseList(attachments),
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

export function toGroupDetailResponse(g: ChatGroup, members: GroupMemberView[]) {
  return {
    ...toGroupResponse(g, members.length),
    members: members.map((m) => ({
      sessionId: String(m.sessionId),
      alias: m.alias,
      customerName: maskName(m.customerName),
      channel: m.channel,
      receiveOnly: m.receiveOnly,
      targetConversationId: m.targetConversationId != null ? String(m.targetConversationId) : null,
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
