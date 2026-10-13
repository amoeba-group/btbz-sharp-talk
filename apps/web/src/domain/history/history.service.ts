import { apiGet, apiGetList } from '@/lib/api-client';

export interface ConversationRow {
  id: string;
  customerName?: string | null;
  status?: string;
  escalated?: boolean;
  channel?: string;
  agentId?: string | null;
  agentName?: string | null;
  messageCount?: number;
  startedAt?: string;
  endedAt?: string;
}

/** One document the AI cited when it produced a turn. */
export interface TraceCitation {
  id?: string | number;
  title?: string;
  source?: string;
  score?: number;
}

export interface MessageTrace {
  citations?: TraceCitation[];
  confidence?: number;
  /**
   * Why a system turn was sent, from the closed refusal vocabulary (PLN-261012 SG-50):
   * guest_gate / auth_gate / moderation / low_confidence / policy_deny / identity_expired …,
   * or user_request for a handoff the customer asked for. Older rows carry the escalation
   * words (moderation_blocked, policy).
   */
  reason?: string;
  /** The AI agent that was speaking on a refusal / system turn. */
  agentId?: number;
  scenario?: string;
}

export interface ConversationMessage {
  id: string;
  senderType: string;
  senderId?: string | null;
  senderName?: string | null;
  body: string;
  lang?: string | null;
  trace?: MessageTrace | null;
  createdAt: string;
}

export interface ConversationDetail extends ConversationRow {
  language?: string | null;
  messages: ConversationMessage[];
}

export interface HistoryListParams {
  page: number;
  pageSize: number;
  status?: string;
  escalated?: boolean;
  from?: string;
  to?: string;
  agentId?: string;
  q?: string;
  includePreview?: boolean;
}

export const historyService = {
  list: (params: HistoryListParams) =>
    apiGetList<ConversationRow>('/analytics/conversations', {
      page: params.page,
      size: params.pageSize,
      status: params.status,
      escalated: params.escalated,
      from: params.from,
      to: params.to,
      agent_id: params.agentId,
      q: params.q,
      include_preview: params.includePreview ? 'true' : undefined,
    }),
  detail: (id: string) => apiGet<ConversationDetail>(`/analytics/conversations/${id}`),
};
