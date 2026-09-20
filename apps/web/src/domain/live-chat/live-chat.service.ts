import { apiDelete, apiGet, apiPatch, apiPost, apiUpload } from '@/lib/api-client';

/** Mirrors the API's toSessionResponse — no invented fields (they render as '—'). */
export interface AgentSession {
  id: string;
  /** Session behind the row (row ids are conversation ids). */
  sessionId?: string;
  /** Operator-set session name; shown ahead of the derived one. */
  alias?: string | null;
  /** Session auto-reply choice: inherit | on | off. */
  autoReplyMode?: string;
  /** That choice resolved against the channel default — is the AI answering? */
  autoReplyEffective?: boolean;
  customerName?: string | null;
  /** Shown when the shopper left an address but no name (off-hours capture). */
  customerEmail?: string | null;
  status?: string;
  /** Effective AI agent of the session (REQ-260825 R6); NULL pin = default. */
  aiAgentId?: string | null;
  aiAgentName?: string | null;
  /** Origin surface: widget | telegram | viber | zalo | line | kakao | sms | email … */
  channel?: string | null;
  /** Team pin (PLN-260826) — pinned rows arrive first from the server. */
  pinned?: boolean;
  pinnedAt?: string | null;
  escalated?: boolean;
  lastMessagePreview?: string | null;
  lastMessageAt?: string | null;
  createdAt?: string;
}

export type MessageSenderType = 'user' | 'agent' | 'ai' | 'system';

/** What the knowledge base says, with the documents it stood on (PLN-260810 S2). */
export interface AgentKnowledgeAnswer {
  answer: string;
  confidence: number;
  blocked: boolean;
  sources: Array<{
    id: number;
    title: string;
    category: string | null;
    similarity: number | null;
    snippet: string;
    source: string | null;
    stale: boolean;
    conflicted: boolean;
  }>;
}

/** A file on a turn (PLN-260814). `url`/`thumbUrl` are signed and short-lived. */
export interface ChatAttachment {
  id: string;
  kind: 'image' | 'file';
  filename: string;
  mime: string;
  size: number;
  width?: number | null;
  height?: number | null;
  url: string;
  thumbUrl?: string | null;
}

export interface ChatMessage {
  id: string;
  senderType: MessageSenderType;
  senderName?: string | null;
  body: string;
  createdAt?: string;
  attachments?: ChatAttachment[];
}

export interface CustomerContext {
  id?: number;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  /** False only for a panel fetched through the audited reveal route. */
  masked?: boolean;
  tier?: string | null;
  recentOrders?: { id: number; status?: string | null; total?: number | null; createdAt?: string }[];
}

export interface PendingDraft {
  id: string;
  body: string;
  confidence?: number | null;
  createdAt?: string;
}

export interface ConversationDetail {
  conversationId?: number;
  sessionId?: string;
  alias?: string | null;
  autoReplyMode?: string;
  autoReplyEffective?: boolean;
  /** AI answer waiting for the agent to send it (approval mode). */
  pendingDraft?: PendingDraft | null;
  status?: string;
  /** Origin surface — the composer is disabled on receive-only channels. */
  channel?: string | null;
  /** Current human owner's name (REQ-260825 R8-②); null = unassigned. */
  assignedTo?: string | null;
  aiAgentId?: string | null;
  aiAgentName?: string | null;
  messages: ChatMessage[];
  /** Older messages exist before the first one returned (PLN-260807). */
  hasMore?: boolean;
  customer?: CustomerContext | null;
}

export interface CustomerLead {
  name?: string;
  email?: string;
  phone?: string;
}

/**
 * Stored operator-requested briefing (REQ-260824 R3). `briefing` is null when
 * none was generated for this conversation yet — the card offers the button.
 */
export interface StoredBriefing {
  id?: string;
  briefing: string | null;
  /** lang code → translated text, grown lazily per request. */
  translations?: Record<string, string>;
  requestedByName?: string | null;
  createdAt?: string;
}

/** Internal operator note on a thread or its session (REQ-260824 R4). */
export interface ChatComment {
  id: string;
  scope: 'conversation' | 'session';
  body: string;
  authorId?: string | null;
  authorName?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Session group (timeline/project) — kind is a classifier only (REQ-260824). */
export interface ChatGroupSummary {
  id: string;
  kind: 'timeline' | 'project';
  title: string;
  memberCount: number;
  lastMessageAt?: string | null;
  createdAt?: string;
}

export interface ChatGroupMemberView {
  sessionId: string;
  alias?: string | null;
  customerName?: string | null;
  channel: string;
  receiveOnly: boolean;
  targetConversationId?: string | null;
}

export interface ChatGroupDetail extends ChatGroupSummary {
  members: ChatGroupMemberView[];
}

/** Merged-feed row: a message plus which member session it came from. */
export interface GroupMessage extends ChatMessage {
  conversationId?: string;
  sessionId?: string | null;
  channel?: string;
}

/** Escalation alert row (FR-S3) shown in the console alarm modal. */
export interface AgentAlert {
  id: string;
  conversationId: string;
  sessionId?: string | null;
  reason: 'low_confidence' | 'moderation_blocked' | 'user_request' | string;
  preview?: string | null;
  status: 'new' | 'acked' | string;
  createdAt?: string;
}

/** Slim AI-agent row for the filter/picker (staff-readable, REQ-260825 R7). */
export interface AiAgentOption {
  id: number;
  name: string;
  displayName: string | null;
  isDefault: boolean;
}

export const liveChatService = {
  sessions: (q?: string, status?: string, channel?: string, aiAgentId?: string) =>
    apiGet<AgentSession[]>('/agent/sessions', {
      ...(q?.trim() ? { q: q.trim() } : {}),
      ...(status && status !== 'all' ? { status } : {}),
      ...(channel && channel !== 'all' ? { channel } : {}),
      ...(aiAgentId && aiAgentId !== 'all' ? { ai_agent_id: aiAgentId } : {}),
    }),
  aiAgents: () => apiGet<AiAgentOption[]>('/agent/ai-agents'),
  setAiAgent: (id: string, aiAgentId: number) =>
    apiPatch<{ sessionId: string; aiAgentId: number; aiAgentName: string }>(
      `/agent/conversations/${id}/ai-agent`,
      { ai_agent_id: aiAgentId },
    ),
  assignConversation: (id: string, userId: number) =>
    apiPost<{ id: string; status: string; agentId: number }>(
      `/agent/conversations/${id}/assign`,
      { user_id: userId },
    ),
  fileIssue: (id: string, type: string, opts?: { messageId?: string; memo?: string }) =>
    apiPost<{ issueId: number; issueNo: number; appended: boolean }>(
      `/agent/conversations/${id}/issue`,
      {
        type,
        ...(opts?.messageId ? { message_id: Number(opts.messageId) } : {}),
        ...(opts?.memo?.trim() ? { memo: opts.memo.trim() } : {}),
      },
    ),
  /** Pin/unpin in the queue — team-shared, max 3; 4th → E5060 (PLN-260826). */
  setPin: (id: string, pinned: boolean) =>
    apiPatch<{ id: number; pinned: boolean; pinnedAt: string | null }>(
      `/agent/conversations/${id}/pin`,
      { pinned },
    ),
  /** Console-only message translation; server caches per message+lang. */
  translateMessage: (messageId: string, lang: string) =>
    apiPost<{ messageId: number; lang: string; text: string }>(
      `/agent/messages/${messageId}/translate`,
      { lang },
    ),
  setAlias: (id: string, alias: string | null) =>
    apiPatch<{ sessionId: string; alias: string | null }>(`/agent/conversations/${id}/alias`, {
      alias,
    }),
  setAutoReply: (id: string, mode: string) =>
    apiPatch<{ sessionId: string; autoReplyMode: string; autoReplyEffective: boolean }>(
      `/agent/conversations/${id}/auto-reply`,
      { mode },
    ),
  approveDraft: (id: string, body?: string) =>
    apiPost<{ approved: boolean }>(`/agent/conversations/${id}/draft/approve`, body ? { body } : {}),
  discardDraft: (id: string) =>
    apiPost<{ discarded: boolean }>(`/agent/conversations/${id}/draft/discard`),
  conversation: (id: string, beforeId?: string) =>
    apiGet<ConversationDetail>(
      `/agent/conversations/${id}`,
      beforeId ? { before_id: beforeId } : undefined,
    ),
  // Read-only: returns the stored briefing (or briefing:null) — generation is
  // an explicit POST since REQ-260824 R3.
  briefing: (id: string) => apiGet<StoredBriefing>(`/agent/conversations/${id}/briefing`),
  generateBriefing: (id: string) =>
    apiPost<StoredBriefing>(`/agent/conversations/${id}/briefing`),
  translateBriefing: (briefingId: string, lang: string) =>
    apiPost<StoredBriefing>(`/agent/briefings/${briefingId}/translate`, { lang }),
  /** Internal notes: the thread's own plus its session-wide ones (REQ-260824 R4). */
  comments: (id: string) => apiGet<ChatComment[]>(`/agent/conversations/${id}/comments`),
  createComment: (id: string, scope: 'conversation' | 'session', body: string) =>
    apiPost<ChatComment>(`/agent/conversations/${id}/comments`, { scope, body }),
  updateComment: (commentId: string, body: string) =>
    apiPatch<ChatComment>(`/agent/comments/${commentId}`, { body }),
  deleteComment: (commentId: string) => apiDelete<{ id: string }>(`/agent/comments/${commentId}`),
  accept: (id: string) => apiPost<ConversationDetail>(`/agent/conversations/${id}/accept`),
  sendMessage: (id: string, body: string, attachmentIds?: string[]) =>
    apiPost<ChatMessage>(`/agent/conversations/${id}/message`, {
      body,
      attachment_ids: attachmentIds?.length ? attachmentIds : undefined,
    }),
  /** Upload one file to send with a reply (PLN-260814 S4). */
  uploadAttachment: (id: string, file: File, onProgress?: (percent: number) => void) => {
    const form = new FormData();
    form.append('file', file);
    return apiUpload<ChatAttachment>(`/agent/conversations/${id}/attachments`, form, onProgress);
  },
  end: (id: string) => apiPost<ConversationDetail>(`/agent/conversations/${id}/end`),
  // Session groups: timeline/project (REQ-260824-Session-Grouping).
  groups: () => apiGet<ChatGroupSummary[]>('/agent/groups'),
  createGroup: (kind: 'timeline' | 'project', title: string, sessionIds: string[]) =>
    apiPost<ChatGroupSummary>('/agent/groups', {
      kind,
      title,
      session_ids: sessionIds.map(Number),
    }),
  group: (id: string) => apiGet<ChatGroupDetail>(`/agent/groups/${id}`),
  groupMessages: (id: string, beforeId?: string) =>
    apiGet<{ groupId: string; messages: GroupMessage[]; hasMore: boolean }>(
      `/agent/groups/${id}/messages`,
      beforeId ? { before_id: beforeId } : undefined,
    ),
  /** 1:1 only — one member session as the recipient, never a broadcast. */
  sendGroupMessage: (id: string, sessionId: string, body: string) =>
    apiPost<GroupMessage>(`/agent/groups/${id}/messages`, {
      session_id: Number(sessionId),
      body,
    }),
  updateGroup: (id: string, patch: { title?: string; kind?: 'timeline' | 'project' }) =>
    apiPatch<ChatGroupDetail>(`/agent/groups/${id}`, patch),
  addGroupMembers: (id: string, sessionIds: string[]) =>
    apiPost<ChatGroupDetail>(`/agent/groups/${id}/members`, {
      session_ids: sessionIds.map(Number),
    }),
  removeGroupMember: (id: string, sessionId: string) =>
    apiDelete<ChatGroupDetail>(`/agent/groups/${id}/members/${sessionId}`),
  dissolveGroup: (id: string) => apiDelete<{ id: string }>(`/agent/groups/${id}`),
  /** Read-only knowledge lookup for chat handlers (PLN-260810 S2). */
  askKnowledge: (question: string, language: string) =>
    apiPost<AgentKnowledgeAnswer>('/agent/knowledge/ask', { question, language }),
  /** Propose an answer for the knowledge base — awaits an owner's approval (S4). */
  proposeAnswer: (body: { conversation_id?: number; question: string; answer: string }) =>
    apiPost<{ id: string }>('/agent/knowledge/proposals', body),
  /** Return the thread to the AI without ending it (PLN-260810 S1). */
  handBack: (id: string) =>
    apiPost<{ id: string; status: string }>(`/agent/conversations/${id}/handback`, {}),
  alerts: (status = 'new') => apiGet<AgentAlert[]>(`/agent/alerts?status=${status}`),
  ackAlert: (id: string) => apiPost<AgentAlert>(`/agent/alerts/${id}/ack`),
  // POST, so a shopper's address typed into the search box never becomes part
  // of a URL — query strings live on in proxy access logs and browser history
  // long after the conversation is disposed of (PLN-260920 P3).
  searchCustomers: (q: string) => apiPost<CustomerContext[]>(`/agent/customers/search`, { q }),
  /** Unmasked customer panel for one customer. Audited server-side. */
  revealCustomer: (customerId: number) =>
    apiGet<CustomerContext>(`/agent/customers/${customerId}/reveal`),
  linkCustomer: (id: string, customerId: number) =>
    apiPost<CustomerContext>(`/agent/conversations/${id}/link-customer`, { customer_id: customerId }),
  createCustomer: (id: string, lead: CustomerLead) =>
    apiPost<CustomerContext>(`/agent/conversations/${id}/create-customer`, lead),
};
