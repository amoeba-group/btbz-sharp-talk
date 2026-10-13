/**
 * The line an escalation alert quotes under its reason (w3c, ops-manual finding 16).
 *
 * The preview used to be "the customer's last message". After the team question that message is the
 * chip the customer pressed ("Business Support"), so the alarm modal, the Slack/e-mail text and a
 * re-route all quoted a team name where the person paged expected the question. The chip is stored
 * as a customer message on purpose (`kind: 'team_choice'`, the transcript shows what was asked for),
 * so it stays in the thread; only the preview looks past it.
 */

/** `retrieval_trace.kind` of the customer message that records a team choice (see `ChatService.escalate`). */
export const TEAM_CHOICE_KIND = 'team_choice';

/** Longest preview an alert keeps (the alert column and the alarm modal). */
export const ESCALATION_PREVIEW_MAX = 300;

/** The part of a stored customer message the preview needs. */
export interface PreviewMessage {
  id?: number | string | null;
  body?: string | null;
  retrievalTrace?: unknown;
}

/** True when the message only records which team the customer picked. */
export function isTeamChoiceMessage(m: PreviewMessage | null | undefined): boolean {
  const trace = m?.retrievalTrace;
  return !!trace && typeof trace === 'object' && (trace as { kind?: unknown }).kind === TEAM_CHOICE_KIND;
}

/**
 * The customer's latest message that is not a team choice, trimmed to the preview length; '' when
 * there is none (a customer who only pressed "talk to an agent" and a team chip said nothing else,
 * and the alert shows the team on its own line). `fetchBefore(beforeId)` returns the latest customer
 * message, or the latest one older than `beforeId`; at most `maxHops` chips are skipped, so a
 * thread with a pile of them cannot turn this into a long scan.
 */
export async function escalationPreview(
  fetchBefore: (beforeId?: number) => Promise<PreviewMessage | null | undefined>,
  maxHops = 6,
): Promise<string> {
  let beforeId: number | undefined;
  for (let hop = 0; hop <= maxHops; hop++) {
    const m = await fetchBefore(beforeId);
    if (!m) return '';
    if (!isTeamChoiceMessage(m)) return String(m.body ?? '').slice(0, ESCALATION_PREVIEW_MAX);
    const id = Number(m.id);
    if (!Number.isFinite(id)) return ''; // cannot step past it; better no quote than the chip text
    beforeId = id;
  }
  return '';
}
