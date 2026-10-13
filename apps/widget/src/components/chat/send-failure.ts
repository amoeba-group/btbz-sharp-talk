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

/**
 * The failure bubble that must survive a reconcile with the server thread.
 *
 * `reconcile` replaces the local thread with the server's, which silently wiped the failure bubble
 * on the very next 5-second poll — taking its chips with it. Keep it while the failure is still the
 * latest thing in the thread: the server's last message is the shopper's own turn (the send failed
 * before any reply) or the thread is empty. Once ANY reply exists after it — the turn landed late,
 * an agent answered, a system notice arrived — the bubble is stale and dropped.
 */
export function keepFailureTail(local: ChatMessage[], server: ChatMessage[]): ChatMessage[] {
  const last = local[local.length - 1];
  if (!last || !last.id.startsWith(FAILURE_ID_PREFIX)) return [];
  const lastServer = server[server.length - 1];
  if (lastServer && lastServer.senderType !== 'user') return [];
  return [last];
}

/** Drop failure bubbles (the retry replaces them with the new attempt). */
export function withoutFailures(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => !m.id.startsWith(FAILURE_ID_PREFIX));
}
