import { apiGet, apiPost } from '@/lib/api-client';

/** /ai-setting chat preview (PLN-AiSetting-Preview W1). The preview drives the
 *  REAL public chat pipeline with an isolated `channel='preview'` session. */

export interface PreviewCitation {
  id: number | string;
  title: string;
  similarity?: number | null;
  /** "Watch video" API path when the document explains a video (PLN-261006). */
  videoUrl?: string | null;
}

export interface PreviewReply {
  senderType: string;
  body: string;
  citations?: PreviewCitation[];
  confidence?: number;
  /** Persisted turn id — lets the coaching tab anchor to this exact answer. */
  messageId?: string;
}

export interface PreviewChatTurn {
  conversationId: string | null;
  reply: PreviewReply | null;
  escalate: boolean;
  needsAuth: boolean;
}

export interface PreviewScenarioTurn {
  conversationId: string | null;
  reply: { senderType: string; body: string };
  followUps: { id: string; label: string }[];
}

export const previewService = {
  createSession: (language: string, aiAgentId?: number) =>
    apiPost<{ sessionToken: string; language: string }>('/ai-config/preview-session', {
      language,
      ai_agent_id: aiAgentId,
    }),
  send: (sessionToken: string, message: string) =>
    apiPost<PreviewChatTurn>('/chat/message', { session_token: sessionToken, message }),
  scenario: (sessionToken: string, action: string) =>
    apiPost<PreviewScenarioTurn>('/chat/scenario', { session_token: sessionToken, action }),
  scenarioButtons: (sessionToken: string) =>
    apiGet<{ scenarioButtons: { id: string; label: string; action: string; enabled: boolean }[] }>(
      '/ai-config/scenario',
      { session_token: sessionToken },
    ),
};
