import type { ChatMessage } from '../../lib/types';

/**
 * What the widget offers after a message did not go through (PLN-261012 SG-84).
 *
 * The bubble used to say "Sorry, that didn't go through. Please try again." and nothing else: the
 * shopper had to retype the question, and when the cause was an outage they could keep retyping it
 * forever. Now the bubble carries two chips — **Retry** (resend exactly what was typed) and
 * **Talk to an agent** (the hand-off, which does not depend on the AI engine). Pure helpers, no
 * React or i18n imports, so the rules are unit-tested (`test/send-failure.test.mjs`).
 */

/** Chip id of the retry action; `handleQuickReply` in ChatTab routes it. */
export const RETRY_CHIP_ID = 'retry_send';
/** Chip id of the hand-off — the same id the post-answer "Talk to an agent" chip uses. */
export const AGENT_CHIP_ID = 'agent_connect';

/** Id prefix of a local failure bubble; `reconcile`/`countServerKnown` already treat it as local. */
export const FAILURE_ID_PREFIX = 'err-';

/**
 * How long `/chat/message` may take before the widget gives up. The server bounds every model call
 * (25 s by default) but a turn is up to three of them, so this is deliberately generous: a client
 * that aborts while the server is still working shows "didn't go through" for a turn that is about
 * to land. Without ANY deadline a hung server left the composer disabled forever.
 */
export const SEND_TIMEOUT_MS = 120_000;

export type SendFailureKind =
  /** No HTTP answer at all (offline, DNS, the deadline above). Retrying is the right first move. */
  | 'network'
  /** The server answered 5xx. Usually transient — retry, or ask for a person. */
  | 'server'
  /** The server refused the request (4xx other than auth). The same request will be refused again. */
  | 'rejected';

/** `api-client` attaches the HTTP `status` to the Error it throws; no status = no answer. */
export function classifySendFailure(err: unknown): SendFailureKind {
  const status = (err as { status?: number } | null)?.status;
  if (typeof status !== 'number') return 'network';
  if (status >= 500) return 'server';
  return 'rejected';
}

export interface SendFailureLabels {
  retry: string;
  agent: string;
}

export interface FailureChip {
  id: string;
  label: string;
}

/**
 * The chips under a failure bubble. Retry is offered only when it can help: there has to be
 * something to resend (`canRetry`) and the failure must not be a refusal the server would repeat.
 * The agent chip is always there — a person is the one way out that works during an AI outage.
 */
export function sendFailureChips(
  labels: SendFailureLabels,
  kind: SendFailureKind,
  canRetry = true,
): FailureChip[] {
  const chips: FailureChip[] = [];
  if (canRetry && kind !== 'rejected') chips.push({ id: RETRY_CHIP_ID, label: labels.retry });
  chips.push({ id: AGENT_CHIP_ID, label: labels.agent });
  return chips;
}

/** Highest server-assigned (all-digit) message id in a thread, 0 when there is none. */
export function maxServerId(messages: ChatMessage[]): number {
  let max = 0;
  for (const m of messages) {
    if (/^\d+$/.test(m.id)) max = Math.max(max, Number(m.id));
  }
  return max;
}

/**
 * The local bubble that says a send did not go through. It remembers the highest server id seen at
 * that moment (`failedAfterId`), which is what lets `keepFailureTail` tell "nothing has happened
 * since" from "the turn landed late".
 */
export function failureBubble(
  thread: ChatMessage[],
  body: string,
  chips: FailureChip[],
  now: Date = new Date(),
): ChatMessage {
  return {
    id: `${FAILURE_ID_PREFIX}${now.getTime()}`,
    senderType: 'system',
    body,
    createdAt: now.toISOString(),
    quickReplies: chips,
    failedAfterId: String(maxServerId(thread)),
  } as ChatMessage;
}

/**
 * The failure bubble that must survive a reconcile with the server thread.
 *
 * `reconcile` replaces the local thread with the server's, which silently wiped the failure bubble
 * (and its chips) on the very next 5-second poll. Keep it while the failure is still the latest
 * thing in the thread. The test is NOT "is the server's last message the shopper's own" — a send
 * that never reached the server leaves the PREVIOUS answer as its last message. It is: has any
 * reply (ai / agent / system) arrived with an id newer than the one seen when the send failed? If
 * so the turn landed late, or an agent answered, and the bubble is stale.
 */
export function keepFailureTail(local: ChatMessage[], server: ChatMessage[]): ChatMessage[] {
  const last = local[local.length - 1];
  if (!last || !last.id.startsWith(FAILURE_ID_PREFIX)) return [];
  const after = Number(last.failedAfterId ?? 0);
  const replied = server.some((m) => m.senderType !== 'user' && /^\d+$/.test(m.id) && Number(m.id) > after);
  return replied ? [] : [last];
}

/** Drop failure bubbles (the retry replaces them with the new attempt). */
export function withoutFailures(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => !m.id.startsWith(FAILURE_ID_PREFIX));
}
