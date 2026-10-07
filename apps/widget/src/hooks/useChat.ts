import { useCallback, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { isAuthError } from '../lib/errors';
import {
  endChat as endChatApi,
  escalate as escalateApi,
  getConversation,
  sendMessage,
  sendScenario,
  rateChat,
} from '../services/chatService';
import type { ChatAttachment, ChatMessage, ChatReply, ScenarioPostAction } from '../lib/types';

export interface SendResult {
  escalate: boolean;
  needsAuth: boolean;
  /** Off-hours handoff with no address on file — ask the shopper for one. */
  needsContactEmail?: boolean;
}

const POLL_MS = 5000;

/**
 * Chat thread state. Optimistic local appends while sending, plus a 5s
 * conversation poll so agent replies after a handoff reach the customer
 * (FR-S4). Server messages win on reconcile; local optimistic messages are
 * kept only while a send is in flight.
 */
export function useChat(sessionToken: string | null) {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  // Server-side conversation mode ('ai_active' | 'waiting' | 'agent' | 'ended' |
  // 'none') — lets the UI say "an agent is typing…" instead of the AI wording
  // once the thread is handed off.
  const [status, setStatus] = useState<string>('none');
  const [canRate, setCanRate] = useState(false);
  // Ref (not state) so the polling queryFn always sees the current value.
  const inFlight = useRef(false);
  // Highest server message id seen — the ?after_id= delta cursor (PERF-1).
  // Reset to null (full fetch) after a send, since the send's own persisted
  // rows are newer than the cursor and must replace the optimistic bubbles.
  const lastServerId = useRef<string | null>(null);

  useQuery({
    queryKey: ['conversation', sessionToken],
    queryFn: async () => {
      const after = lastServerId.current;
      const conv = await getConversation(sessionToken!, after);
      if (!inFlight.current) {
        if (conv.status) setStatus(conv.status);
        // The server decides whether rating is still open (24h window); the
        // widget must not offer stars the API would refuse.
        setCanRate(conv.canRate === true);
        if (conv.conversationId != null) setConversationId(String(conv.conversationId));
        const serverMsgs = conv.messages ?? [];
        trackCursor(lastServerId, serverMsgs);
        setMessages((prev) =>
          after ? mergeDelta(prev, serverMsgs) : reconcile(prev, serverMsgs),
        );
      }
      return conv;
    },
    enabled: !!sessionToken,
    refetchInterval: POLL_MS,
    retry: false,
  });

  const append = useCallback((m: ChatMessage) => {
    setMessages((prev) => [...prev, m]);
  }, []);

  const send = useCallback(
    async (text: string, attachments?: ChatAttachment[]): Promise<SendResult> => {
      // A turn is now valid with files and no words (PLN-260814) — but still
      // never with neither.
      if (!sessionToken || (!text.trim() && !attachments?.length)) {
        return { escalate: false, needsAuth: false };
      }
      append({
        id: `local-${Date.now()}`,
        senderType: 'user',
        body: text,
        createdAt: new Date().toISOString(),
        // Shown from the upload response, so the shopper sees their own photo
        // in the thread before the next poll returns the stored row.
        attachments,
      });
      setSending(true);
      inFlight.current = true;
      try {
        const res: ChatReply = await sendMessage(
          sessionToken,
          text,
          attachments?.map((a) => a.id),
        );
        setConversationId(res.conversationId);
        // A message after an ended thread opened a fresh conversation — clear
        // the ended banner now rather than waiting for the next poll.
        setStatus((s) => (s === 'ended' ? 'ai_active' : s));
        // reply === null → agent mode: the human reply arrives via polling.
        if (res.reply) {
          append({
            id: `reply-${Date.now()}`,
            senderType: res.reply.senderType,
            body: res.reply.body,
            createdAt: new Date().toISOString(),
            citations: res.reply.citations,
            // The team question's chips (PLN-261007) — shown now rather than
            // after the next poll brings the stored row.
            quickReplies: res.followUps,
          });
        }
        return {
          escalate: res.escalate,
          needsAuth: res.needsAuth,
          needsContactEmail: res.needsContactEmail,
        };
      } catch (e) {
        // Not signed in is a state, not a failure: report it as needsAuth so the
        // caller shows the sign-in card instead of a dead-end error bubble.
        if (isAuthError(e)) return { escalate: false, needsAuth: true };
        append({
          id: `err-${Date.now()}`,
          senderType: 'system',
          body: t('chat.sendFailed'),
          createdAt: new Date().toISOString(),
        });
        return { escalate: false, needsAuth: false };
      } finally {
        setSending(false);
        inFlight.current = false;
        // The send persisted new rows past the cursor — next poll does a full
        // reconcile so the optimistic bubbles are replaced by server truth.
        lastServerId.current = null;
      }
    },
    [sessionToken, append, t],
  );

  /**
   * Scenario button / quick-reply chip (FR-S1): deterministic scripted turn.
   * Resolves with the tenant-configured post-action (PLN-AiSetting W2) so the
   * caller can navigate after the reply lands; undefined = stay in the thread.
   */
  const scenario = useCallback(
    async (
      action: string,
      label: string,
      /** What to ask when the action has no script; defaults to the label. */
      text?: string,
    ): Promise<ScenarioPostAction | undefined> => {
      if (!sessionToken) return undefined;
      append({
        id: `local-${Date.now()}`,
        senderType: 'user',
        body: label,
        createdAt: new Date().toISOString(),
      });
      setSending(true);
      inFlight.current = true;
      try {
        const res = await sendScenario(sessionToken, action, text);
        setConversationId(res.conversationId);
        // An empty body means the turn produced no visible reply — agent mode,
        // where the human answers through polling (PLN-261001 §1-2). Appending
        // it would draw an empty bubble under the shopper's own message.
        if (res.reply.body) {
          append({
            id: `scen-${Date.now()}`,
            senderType: res.reply.senderType,
            body: res.reply.body,
            createdAt: new Date().toISOString(),
            quickReplies: res.followUps,
          });
        }
        return res.postAction;
      } catch (e) {
        if (!isAuthError(e)) {
          append({
            id: `err-${Date.now()}`,
            senderType: 'system',
            body: t('chat.sendFailed'),
            createdAt: new Date().toISOString(),
          });
        }
      } finally {
        setSending(false);
        inFlight.current = false;
        lastServerId.current = null; // scripted turn persisted rows — full reconcile next poll
      }
      return undefined;
    },
    [sessionToken, append, t],
  );

  /**
   * Ask for a human. With team routing on (PLN-261007) the first call brings
   * back the team question instead of a handoff; a chip tap calls again with
   * its option id and `label`, which is echoed as the shopper's own words.
   */
  const escalate = useCallback(
    async (supportType?: string, label?: string): Promise<{ choose: boolean }> => {
      if (!conversationId) return { choose: false };
      if (label) {
        append({
          id: `local-${Date.now()}`,
          senderType: 'user',
          body: label,
          createdAt: new Date().toISOString(),
        });
      }
      try {
        const res = await escalateApi(sessionToken!, conversationId, supportType);
        if (res?.choose) {
          append({
            id: `ask-${Date.now()}`,
            senderType: 'system',
            body: res.body ?? '',
            createdAt: new Date().toISOString(),
            quickReplies: res.followUps,
          });
          return { choose: true };
        }
        // The server stores its own notice (connecting / off-hours) and says
        // what it wrote, so the bubble shown now matches the row the next poll
        // brings. An older API that returns nothing gets the local line.
        append({
          id: `sys-${Date.now()}`,
          senderType: 'system',
          body: res?.body || t('chat.connectingAgent'),
          createdAt: new Date().toISOString(),
        });
        return { choose: false };
      } finally {
        // Rows were persisted past the cursor — full reconcile on the next poll.
        lastServerId.current = null;
      }
    },
    [conversationId, sessionToken, append, t],
  );

  /**
   * Customer-side end chat (PLN-260808 Track B). The session (and sign-in)
   * survives — the next message simply starts a fresh conversation.
   */
  const endChat = useCallback(async () => {
    if (!sessionToken) return;
    try {
      await endChatApi(sessionToken);
      setStatus('ended');
    } catch {
      append({
        id: `err-${Date.now()}`,
        senderType: 'system',
        body: t('chat.sendFailed'),
        createdAt: new Date().toISOString(),
      });
    }
  }, [sessionToken, append, t]);

  const rate = async (rating: number) => {
    if (!sessionToken || !conversationId) return;
    await rateChat(sessionToken, conversationId, rating);
    setCanRate(false);
  };

  return {
    messages,
    send,
    scenario,
    sending,
    status,
    escalate,
    endChat,
    append,
    conversationId,
    canRate,
    rate,
  };
}

/**
 * Merge the server thread with local state. Server is the source of truth, and it
 * now returns a scripted turn's chips too, so a reload or tab switch keeps them.
 * The local re-attach stays as a fallback for a message whose chips the server
 * doesn't carry (e.g. an older row persisted before chips were stored).
 */
function reconcile(local: ChatMessage[], server: ChatMessage[]): ChatMessage[] {
  if (server.length === 0) return local;
  if (server.length < countServerKnown(local)) return local; // stale poll
  const lastWithChips = [...local].reverse().find((m) => m.quickReplies?.length);
  const lastWithCites = [...local].reverse().find((m) => m.citations?.length);
  const sameBubble = (a: ChatMessage, b: ChatMessage) =>
    a.body === b.body && a.senderType === b.senderType;
  return server.map((m) => {
    const merged = { ...m };
    if (!merged.quickReplies?.length && lastWithChips && sameBubble(merged, lastWithChips)) {
      merged.quickReplies = lastWithChips.quickReplies;
    }
    // Citations now ride on the server row too; this only covers a turn stored
    // before they were served (otherwise the product link would vanish here).
    if (!merged.citations?.length && lastWithCites && sameBubble(merged, lastWithCites)) {
      merged.citations = lastWithCites.citations;
    }
    return merged;
  });
}

function countServerKnown(local: ChatMessage[]): number {
  return local.filter((m) => !m.id.startsWith('local-') && !m.id.startsWith('err-')).length;
}

/** Advance the ?after_id= cursor to the highest numeric server message id seen. */
function trackCursor(
  cursor: { current: string | null },
  serverMsgs: ChatMessage[],
): void {
  for (const m of serverMsgs) {
    const n = Number(m.id);
    if (Number.isFinite(n) && (cursor.current == null || n > Number(cursor.current))) {
      cursor.current = String(m.id);
    }
  }
}

/**
 * Append a delta poll's new server messages (PERF-1). Deltas only ever arrive
 * on idle polls (the cursor resets to a full reconcile after every send), so
 * a plain id-deduped append is safe — no optimistic bubbles to replace.
 */
function mergeDelta(prev: ChatMessage[], delta: ChatMessage[]): ChatMessage[] {
  if (delta.length === 0) return prev;
  const seen = new Set(prev.map((m) => m.id));
  const fresh = delta.filter((m) => !seen.has(m.id));
  return fresh.length ? [...prev, ...fresh] : prev;
}
