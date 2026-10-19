import { SENDER_TYPE } from '@sharptalk/types';

/**
 * Why a conversation counts as resolved (PLN-260825, moved here 2026-08-26).
 *
 * One definition, shared. It used to live in the journey report while the
 * dashboard counted "ended and not escalated" — which scores a customer who
 * gave up as a success, and gave the two screens different resolution rates for
 * the same conversations. A number that means two things is worse than either
 * meaning alone, because nothing tells the reader which one they are looking at.
 */
export const RESOLUTION_REASON = {
  /** The customer rated it — they were there at the end, by definition. */
  CSAT_ANSWERED: 'csat_answered',
  /** An agent closed it deliberately. */
  AGENT_CLOSED: 'agent_closed',
  /** Asked "anything else?" and the last word was ours. */
  PROMPTED_CLOSED: 'prompted_closed',
} as const;

export const UNRESOLVED_REASON = {
  /** Still open. */
  OPEN: 'open',
  /** Ended with no close and no prompt — nobody finished it. */
  ABANDONED: 'abandoned',
  /** Asked "anything else?" and the customer spoke last: they were still asking. */
  CUSTOMER_LAST: 'customer_last',
  /** The survey asked "was it resolved?" and the customer said no (PLN-261019). */
  CUSTOMER_UNRESOLVED: 'customer_unresolved',
} as const;

export interface Outcome {
  resolved: boolean;
  reason: string;
}

/**
 * Resolved or not, and why.
 *
 * The prompted-then-closed case covers two different things: a customer who got
 * their answer and went quiet, and one who did not and left. Both receive the
 * same message and end in the same state. What separates them is who spoke last
 * before the silence — count them together and abandoned threads land in the
 * resolved column, where their share grows as service gets worse.
 *
 * Takes the last non-system sender rather than the message list: that single
 * value is all the judgement uses, and passing the list left "only the last
 * human turn matters" as an assumption held by each caller. The dashboard
 * aggregates thousands of conversations and cannot load their messages; with
 * this signature it does not have to, and neither caller can drift.
 */
export function classifyOutcome(
  conv: { status: string; csatRating: number | null; endedAt: Date | null; csatResolved?: number | null },
  lastNonSystemSender: string | null,
  wasPrompted: boolean,
): Outcome {
  if (conv.csatRating != null) {
    // The survey's own answer outranks "they answered, so they were there":
    // a customer who said "not resolved" must not land in the resolved column
    // (PLN-261019 D1). Rating-mode rows (no question asked) keep the old rule.
    if (Number(conv.csatResolved) === 0 && conv.csatResolved != null) {
      return { resolved: false, reason: UNRESOLVED_REASON.CUSTOMER_UNRESOLVED };
    }
    return { resolved: true, reason: RESOLUTION_REASON.CSAT_ANSWERED };
  }
  if (conv.status !== 'ended') {
    return { resolved: false, reason: UNRESOLVED_REASON.OPEN };
  }
  if (!wasPrompted) {
    // Ended without ever being asked: either an agent closed it deliberately,
    // or it was too old to talk to. The sweeper's silent close leaves no
    // prompt, so an agent close is the only other way to reach this state.
    return conv.endedAt
      ? { resolved: true, reason: RESOLUTION_REASON.AGENT_CLOSED }
      : { resolved: false, reason: UNRESOLVED_REASON.ABANDONED };
  }
  if (lastNonSystemSender === SENDER_TYPE.USER) {
    return { resolved: false, reason: UNRESOLVED_REASON.CUSTOMER_LAST };
  }
  return { resolved: true, reason: RESOLUTION_REASON.PROMPTED_CLOSED };
}

/** The last turn that was not a system notice — what `classifyOutcome` reads. */
export function lastNonSystemSender(
  messages: Array<{ senderType: string }>,
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].senderType !== SENDER_TYPE.SYSTEM) return messages[i].senderType;
  }
  return null;
}
