import { toFiveA } from './journey-stage-map';

/**
 * Why a figure on the report looks the way it does (REQ-261008 D3).
 *
 * The draft proposed three states; the report that prompted it needed a
 * fourth. Its median resolution time was null and the draft called it "not
 * measured — add instrumentation", but the instrumentation exists: nothing was
 * resolved, so there was nothing to take a median of. "Not applicable" and
 * "not measured" lead to opposite next actions, and only the code that counted
 * can tell them apart — so the code decides, not the model.
 */
export const VALUE_STATE = {
  MEASURED: 'measured',
  /** The denominator is zero — e.g. a resolution time with no resolved conversation. */
  NOT_APPLICABLE: 'not_applicable',
  /** It could exist, but what it is computed from was not recorded. */
  NOT_MEASURED: 'not_measured',
  /** Support conversations cannot see it at all. */
  NOT_OBSERVABLE: 'not_observable',
} as const;
export type ValueState = (typeof VALUE_STATE)[keyof typeof VALUE_STATE];

/** The subset of stored metrics the judgement reads; old reports may lack any field. */
interface StoredMetrics {
  conversations?: number;
  resolved?: number;
  medianResolutionMinutes?: number | null;
  csatResponses?: number;
  stages?: Array<{ stage: string; events: number }>;
}

export function metricStates(m: StoredMetrics | null | undefined): Record<string, ValueState> {
  const { MEASURED, NOT_APPLICABLE, NOT_MEASURED, NOT_OBSERVABLE } = VALUE_STATE;
  const conversations = m?.conversations ?? 0;
  const resolved = m?.resolved ?? 0;
  const perConversation = conversations > 0 ? MEASURED : NOT_APPLICABLE;

  const states: Record<string, ValueState> = {
    conversations: MEASURED,
    messages: MEASURED,
    handoffs: MEASURED,
    avgLoops: perConversation,
    resolutionRate: perConversation,
    medianResolutionMinutes:
      m?.medianResolutionMinutes != null
        ? MEASURED
        : resolved === 0
          ? NOT_APPLICABLE
          : // Resolved, but no close wrote an end time to measure to.
            NOT_MEASURED,
    csatAverage: (m?.csatResponses ?? 0) > 0 ? MEASURED : NOT_APPLICABLE,
  };

  for (const { stage, events } of toFiveA(m?.stages)) {
    // Aware and Appeal happen before anyone writes in; with no event recorded
    // they are invisible to us, not absent. The later steps are ones our own
    // events record, so zero there is a count.
    const early = stage === 'aware' || stage === 'appeal';
    states[`stage.${stage}`] = events > 0 || !early ? MEASURED : NOT_OBSERVABLE;
  }
  return states;
}
