import type {
  ChatCitation,
  ChatMessageResponse,
  ConversationResponse,
  ScenarioFollowUpResponse,
  ThreadResponse,
} from '@sharptalk/types';
import { Conversation } from './entity/conversation.entity';
import { Message } from './entity/message.entity';
import { MessageAttachment } from '../attachment/entity/message-attachment.entity';
import { AttachmentMapper } from '../attachment/attachment.mapper';

/** How long after the thread ends a rating is still accepted (PLN-260810 D5). */
export const CSAT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Response shapes live in `@sharptalk/types` — the widget imports the same contract.
 */
export type MessageResponse = ChatMessageResponse;
export type { ConversationResponse };

/** Chips persisted on the message's trace by ScenarioService, if any. */
function followUpsOf(m: Message): ScenarioFollowUpResponse[] | undefined {
  const trace = m.retrievalTrace as { followUps?: unknown } | null;
  const raw = Array.isArray(trace?.followUps) ? trace.followUps : null;
  if (!raw?.length) return undefined;
  const chips = raw.filter(
    (f): f is { id: string; label: string } =>
      !!f &&
      typeof (f as { id?: unknown }).id === 'string' &&
      typeof (f as { label?: unknown }).label === 'string',
  );
  return chips.length ? chips.map((f) => ({ id: f.id, label: f.label })) : undefined;
}

/**
 * Knowledge references persisted on an AI turn's trace. Serving them with the
 * thread is what keeps a product recommendation clickable: the send response
 * carried them, but the next poll replaced that bubble with the stored row, so
 * the link disappeared after ~5s and never came back on reload.
 */
function citationsOf(m: Message): ChatCitation[] | undefined {
  const trace = m.retrievalTrace as { citations?: unknown } | null;
  const raw = Array.isArray(trace?.citations) ? trace.citations : null;
  if (!raw?.length) return undefined;
  const cites = raw.filter((c): c is ChatCitation => !!c && typeof c === 'object');
  return cites.length ? cites : undefined;
}

export class ChatMapper {
  static toMessageResponse(
    m: Message,
    senderName: string | null = null,
    attachments?: MessageAttachment[],
  ): MessageResponse {
    return {
      id: String(m.id),
      senderType: m.senderType,
      senderName,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
      quickReplies: followUpsOf(m),
      citations: citationsOf(m),
      // Links are minted per response and expire; see AttachmentMapper.
      attachments: AttachmentMapper.toResponseList(attachments),
    };
  }

  static toConversationResponse(
    conversation: Conversation,
    messages: Message[],
    senderNames?: Map<string, string>,
    attachments?: Map<string, MessageAttachment[]>,
  ): ConversationResponse {
    const endedAt = conversation.endedAt?.getTime() ?? null;
    return {
      conversationId: String(conversation.id),
      status: conversation.status,
      csatRating: conversation.csatRating ?? null,
      // Offered only while the submission window is open — showing stars that
      // the API would refuse is worse than showing none.
      canRate:
        conversation.csatRating == null &&
        endedAt != null &&
        Date.now() - endedAt < CSAT_WINDOW_MS,
      messages: messages.map((m) =>
        ChatMapper.toMessageResponse(
          m,
          m.senderId != null ? senderNames?.get(String(m.senderId)) ?? null : null,
          attachments?.get(String(m.id)),
        ),
      ),
    };
  }

  /** Earlier conversations of the account (PLN-261022 stage 2), newest first. */
  static toThreadResponse(
    page: {
      conversations: Array<{ conversation: Conversation; messages: Message[]; own: boolean }>;
      hasMore: boolean;
      colleagueCount: number;
    },
    senderNames?: Map<string, string>,
  ): ThreadResponse {
    return {
      conversations: page.conversations.map(({ conversation, messages, own }) => ({
        conversationId: String(conversation.id),
        status: conversation.status,
        createdAt: conversation.createdAt.toISOString(),
        endedAt: conversation.endedAt ? conversation.endedAt.toISOString() : null,
        own,
        messages: messages.map((m) =>
          ChatMapper.toMessageResponse(m, m.senderId != null ? senderNames?.get(String(m.senderId)) ?? null : null),
        ),
      })),
      hasMore: page.hasMore,
      colleagueCount: page.colleagueCount,
    };
  }
}
