import { CJM_STAGE } from '@sharptalk/types';

/** Kotler's 5A, in order — the same keys the journey card stages seed with (PLN-261006 D3). */
export const FIVE_A = ['aware', 'appeal', 'ask', 'act', 'advocate'] as const;
export type FiveA = (typeof FIVE_A)[number];

/**
 * Touchpoint events are recorded on a six-step funnel; the report and the
 * journey card speak 5A. Without a fixed table the model mapped them on the fly,
 * and a report could call the same event "Awareness" in one line and "Ask" in
 * the next (REQ-261008 F3).
 *
 * Post (a review) maps to advocate as a *signal*: advocacy is judged on what
 * the customer says, so the screen labels it a candidate, not a verdict.
 */
export const CJM_TO_FIVE_A: Record<string, FiveA> = {
  [CJM_STAGE.AWARENESS]: 'aware',
  [CJM_STAGE.BROWSE]: 'appeal',
  [CJM_STAGE.INQUIRY]: 'ask',
  [CJM_STAGE.PURCHASE]: 'act',
  [CJM_STAGE.DELIVERY]: 'act',
  [CJM_STAGE.POST]: 'advocate',
};

/** Event counts per 5A step, every step present (0 when nothing landed there). */
export function toFiveA(
  stages: Array<{ stage: string; events: number }> | undefined,
): Array<{ stage: FiveA; events: number }> {
  const counts = new Map<FiveA, number>(FIVE_A.map((k) => [k, 0]));
  for (const s of stages ?? []) {
    const key = CJM_TO_FIVE_A[s.stage];
    // An unknown stage is dropped, not guessed into a column.
    if (key) counts.set(key, (counts.get(key) ?? 0) + s.events);
  }
  return FIVE_A.map((stage) => ({ stage, events: counts.get(stage) ?? 0 }));
}
