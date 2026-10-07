import { apiClient } from '../lib/api-client';
import type { ChatAttachment, ChatReply, Conversation, EscalateReply, ScenarioReply } from '../lib/types';

export function getConversation(
  sessionToken: string,
  afterId?: string | null,
): Promise<Conversation> {
  // Token travels in X-Session-Token (via the api-client interceptor), not the URL.
  return apiClient.get<Conversation>('/chat/conversation', {
    session_token: sessionToken,
    after_id: afterId ?? undefined,
  });
}

export function sendMessage(
  sessionToken: string,
  message: string,
  attachmentIds?: string[],
): Promise<ChatReply> {
  return apiClient.post<ChatReply>('/chat/message', {
    session_token: sessionToken,
    message,
    attachment_ids: attachmentIds?.length ? attachmentIds : undefined,
  });
}

/**
 * Upload one file and get back the record the send call will reference
 * (PLN-260814 §2). Uploading before sending is what keeps progress and retry
 * out of the message path.
 */
export function uploadAttachment(
  sessionToken: string,
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ChatAttachment> {
  return apiClient.upload<ChatAttachment>('/files/upload', file, sessionToken, onProgress);
}

/** Store the address for an off-hours email reply (PLN-260806). */
export function saveContactEmail(sessionToken: string, email: string): Promise<unknown> {
  return apiClient.post('/chat/contact-email', { session_token: sessionToken, email });
}

/** Customer ends the current conversation (PLN-260808 Track B). */
export function endChat(
  sessionToken: string,
): Promise<{ ended: boolean; conversationId: string | null }> {
  return apiClient.post('/chat/end', { session_token: sessionToken });
}

/** Star rating for a finished conversation (PLN-260810 P3). */
export function rateChat(
  sessionToken: string,
  conversationId: string,
  rating: number,
): Promise<{ rating: number }> {
  return apiClient.post('/chat/csat', {
    session_token: sessionToken,
    conversation_id: conversationId,
    rating,
  });
}

/**
 * Ask for a human (FR-015). Without `supportType` the tenant's team question
 * may come back instead of a handoff (PLN-261007 Team Routing); the chip the
 * shopper taps calls this again with its option id.
 */
export function escalate(
  sessionToken: string,
  conversationId: string,
  supportType?: string,
): Promise<EscalateReply> {
  return apiClient.post<EscalateReply>('/chat/escalate', {
    session_token: sessionToken,
    conversation_id: conversationId,
    support_type: supportType || undefined,
  });
}

/** Scenario button / quick-reply → deterministic scripted reply (FR-S1). */
export function sendScenario(
  sessionToken: string,
  action: string,
  /**
   * What to ask when the action has no script (a "send a message" button). The
   * server answers it as a chat turn rather than 404ing (PLN-261001 §1-1).
   */
  text?: string,
): Promise<ScenarioReply> {
  return apiClient.post<ScenarioReply>('/chat/scenario', {
    session_token: sessionToken,
    action,
    text: text || undefined,
  });
}
