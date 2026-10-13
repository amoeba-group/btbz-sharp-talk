/**
 * Why the assistant did NOT answer a turn (PLN-261012 SG-50, REQ D-13).
 *
 * Every system or refusal message the chat path stores carries one of these in
 * `messages.retrieval_trace.reason`, next to the `agentId` that was speaking, so
 * "why was this partner turned away" is a query instead of a log search. The set
 * is CLOSED on purpose: analytics group by it, and a free-text reason would split
 * every chart. Add a member here (and in the migration notes) before using a new one.
 *
 *  guest_gate        a signed-out visitor asked something outside the guest-visible knowledge
 *  auth_gate         an order question that needs a signed-in customer
 *  consent           privacy notice not accepted — the turn is not processed (nothing is stored)
 *  pilot_denied      the hotel is outside the pilot list (reserved for the pilot flag)
 *  role_manager_only the content is for the Manager role: a receptionist asked a topic only
 *                    manager-only KB categories cover (SG-10); the notice points to the manager account
 *  moderation        the answer was blocked by the outbound moderation gate
 *  low_confidence    the knowledge base could not ground an answer
 *  embedder_degraded the vector leg was down, so grounding could not be measured (reserved)
 *  policy_deny       a deny-list topic goes to a person whatever the AI could say
 *  identity_expired  the signed identity lapsed (SG-03), so a gate that needed it refused
 *  engine_unavailable the AI engine (or its safety check) was down — an outage, not missing
 *                    knowledge; the customer is told a person will follow up (SG-84)
 *  partner_*         the partner-data step (SG-31) refused or degraded the turn — folded in here
 *                    from the free-form `partner_*` strings it stored first, so SG-52 groups them:
 *    partner_role_denied    the signed role may not read that topic (notice only)
 *    partner_claims_stale   the signed claims lapsed or were unusable (notice only)
 *    partner_param_rejected the message named another hotel / parameters outside the schema (notice only)
 *    partner_unavailable    the partner API did not answer usably — "we will confirm" + a hand-off
 *    partner_unverified     a figure in the drafted answer was not in the data — withheld + a hand-off
 */
export const REFUSAL_REASON = {
  GUEST_GATE: 'guest_gate',
  AUTH_GATE: 'auth_gate',
  CONSENT: 'consent',
  PILOT_DENIED: 'pilot_denied',
  ROLE_MANAGER_ONLY: 'role_manager_only',
  MODERATION: 'moderation',
  LOW_CONFIDENCE: 'low_confidence',
  EMBEDDER_DEGRADED: 'embedder_degraded',
  POLICY_DENY: 'policy_deny',
  IDENTITY_EXPIRED: 'identity_expired',
  ENGINE_UNAVAILABLE: 'engine_unavailable',
  PARTNER_ROLE_DENIED: 'partner_role_denied',
  PARTNER_CLAIMS_STALE: 'partner_claims_stale',
  PARTNER_PARAM_REJECTED: 'partner_param_rejected',
  PARTNER_UNAVAILABLE: 'partner_unavailable',
  PARTNER_UNVERIFIED: 'partner_unverified',
} as const;
export type RefusalReason = (typeof REFUSAL_REASON)[keyof typeof REFUSAL_REASON];

const REFUSAL_REASONS: ReadonlySet<string> = new Set(Object.values(REFUSAL_REASON));

export function isRefusalReason(value: unknown): value is RefusalReason {
  return typeof value === 'string' && REFUSAL_REASONS.has(value);
}

/**
 * The only extras a trace may carry. Deliberately a whitelist with primitive
 * values: a trace must never hold the visitor's words (PII in a column that is
 * kept for a year and read by analytics), and a typed hole is easier to audit
 * than a code review of every caller.
 */
export interface RefusalTraceExtra {
  actorRole?: string | null;
  requiredRole?: string | null;
  expired?: boolean;
  grounded?: number;
  threshold?: number;
  topSimilarity?: number;
}

/** `retrieval_trace` of a refusal / system turn. */
export interface RefusalTrace extends RefusalTraceExtra {
  reason: RefusalReason | 'user_request';
  /** The AI agent that was speaking (effective agent, not the raw pin); null = none configured. */
  agentId: number | null;
}

const STRING_KEYS = ['actorRole', 'requiredRole'] as const;
const NUMBER_KEYS = ['grounded', 'threshold', 'topSimilarity'] as const;

/** Build the trace of a refusal. Unknown extras are dropped, strings are capped. */
export function buildRefusalTrace(
  reason: RefusalReason | 'user_request',
  agentId: number | null | undefined,
  extra: RefusalTraceExtra = {},
): RefusalTrace {
  const out: RefusalTrace = { reason, agentId: agentId != null ? Number(agentId) : null };
  for (const key of STRING_KEYS) {
    const v = extra[key];
    if (typeof v === 'string' && v) out[key] = v.slice(0, 32);
  }
  for (const key of NUMBER_KEYS) {
    const v = extra[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  if (extra.expired === true) out.expired = true;
  return out;
}

/**
 * The trace of a handoff notice. Handoffs are published under their own reason
 * words (`moderation_blocked`, `policy`, …), which agent alerts keep; the stored
 * trace speaks the closed vocabulary instead. `user_request` is not a refusal —
 * the customer asked for a person — so it keeps its own word.
 */
export function buildHandoffTrace(
  escalationReason: string,
  agentId: number | null | undefined,
  extra: RefusalTraceExtra = {},
): RefusalTrace {
  const reason: RefusalReason | 'user_request' =
    escalationReason === 'moderation_blocked'
      ? REFUSAL_REASON.MODERATION
      : escalationReason === 'policy'
        ? REFUSAL_REASON.POLICY_DENY
        : escalationReason === 'user_request'
          ? 'user_request'
          : escalationReason === 'engine_unavailable'
            ? REFUSAL_REASON.ENGINE_UNAVAILABLE
            : REFUSAL_REASON.LOW_CONFIDENCE;
  return buildRefusalTrace(reason, agentId, extra);
}
