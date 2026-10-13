import { IDENTITY_ROLE, SESSION_IDENTITY } from './enum.types';
import type { IdentityClaims, SessionIdentity } from './enum.types';

/**
 * The gate's decision vocabulary and the "Test as…" viewers (PLN-261012 SG-51, REQ D-13 / D-16).
 *
 * One decision is made for every turn the guest gate or the role tier looks at, by ONE function in
 * the API (`decideGate`, chat/gate-decision.ts) that the chat path and the console simulator both
 * call. The words below are what that decision, the stored trace (`retrieval_trace.gate`), the
 * golden grading and the calibration CLI all speak, so they cannot drift apart.
 *
 * Dependency-light on purpose, like audience.ts: the console deep-imports this source (a value
 * import from the package entry fails the browser build — see language.ts).
 */

/**
 *  allow              the turn is answered (guest gate open, or no gate applies, or grounded enough)
 *  guest_gate         a signed-out visitor of a login_guidance agent asked outside the public knowledge
 *  role_manager_only  a signed-in partner below manager asked a topic only manager-only categories cover
 *  low_confidence     nothing grounds an answer for this audience: the turn would be handed to a person
 *  embedder_degraded  the vector leg was down, so grounding could not be measured and the turn was
 *                     treated as ungrounded (fail-closed) — NOT a verdict on the question itself
 *
 * `reason` in a stored trace stays the closed REFUSAL_REASON vocabulary the analytics group by;
 * the gate decision rides next to it as `gate`, because `embedder_degraded` on a hand-off turn must
 * not be re-filed by analytics as a refusal without a hand-off.
 */
export const GATE_DECISION = {
  ALLOW: 'allow',
  GUEST_GATE: 'guest_gate',
  ROLE_MANAGER_ONLY: 'role_manager_only',
  LOW_CONFIDENCE: 'low_confidence',
  EMBEDDER_DEGRADED: 'embedder_degraded',
} as const;
export type GateDecisionValue = (typeof GATE_DECISION)[keyof typeof GATE_DECISION];

const GATE_DECISIONS: ReadonlySet<string> = new Set(Object.values(GATE_DECISION));

export function isGateDecision(value: unknown): value is GateDecisionValue {
  return typeof value === 'string' && GATE_DECISIONS.has(value);
}

/** True for every decision that does NOT answer the turn. */
export function gateRefuses(decision: GateDecisionValue): boolean {
  return decision !== GATE_DECISION.ALLOW;
}

/**
 * Who the console simulator ("Test as…") and a golden question ask as.
 *
 *  guest        a signed-out visitor (reads as the `public` tier; gated only when the agent is login_guidance)
 *  partner      a signed-in user with no signed role (v1 identify, platform login): the `partner` tier
 *  receptionist a signed hotel receptionist: the `partner` tier, named in the trace
 *  manager      a signed hotel manager: the `manager` tier
 */
export const GATE_AS = {
  GUEST: 'guest',
  PARTNER: 'partner',
  RECEPTIONIST: 'receptionist',
  MANAGER: 'manager',
} as const;
export type GateAs = (typeof GATE_AS)[keyof typeof GATE_AS];

/** The select's options, least privileged first. */
export const GATE_AS_OPTIONS: readonly GateAs[] = [
  GATE_AS.GUEST,
  GATE_AS.PARTNER,
  GATE_AS.RECEPTIONIST,
  GATE_AS.MANAGER,
];

const GATE_AS_SET: ReadonlySet<string> = new Set(GATE_AS_OPTIONS);

export function isGateAs(value: unknown): value is GateAs {
  return typeof value === 'string' && GATE_AS_SET.has(value);
}

/** The shape `effectiveIdentity()` returns — all the gate and `audienceOf` read. */
export interface SimulatedIdentity {
  level: SessionIdentity;
  claims: IdentityClaims | null;
  customerId: null;
  expired: false;
  expiresAt: null;
}

/**
 * The identity a simulated viewer would have RIGHT NOW. Claims are signed-and-fresh (the simulator
 * asks "what does this role get", not "what if the claims lapsed"); the hotel is a placeholder, the
 * gate never reads it.
 */
export function simulatedIdentity(as: GateAs, now: Date = new Date()): SimulatedIdentity {
  const base = { customerId: null, expired: false, expiresAt: null } as const;
  if (as === GATE_AS.GUEST) return { level: SESSION_IDENTITY.GUEST, claims: null, ...base };
  if (as === GATE_AS.PARTNER) return { level: SESSION_IDENTITY.VERIFIED, claims: null, ...base };
  return {
    level: SESSION_IDENTITY.VERIFIED,
    claims: {
      hotelSn: 'simulated',
      role: as === GATE_AS.MANAGER ? IDENTITY_ROLE.MANAGER : IDENTITY_ROLE.RECEPTIONIST,
      signed: true,
      verifiedAt: now.toISOString(),
    },
    ...base,
  };
}

/**
 * What a labelled question expects of the gate (golden `expect_gate`, calibration `expect`).
 * `refuse` = ANY decision other than `allow`: a visitor sent to sign in, a receptionist pointed to
 * the manager account and a hand-off all keep the content from the asker.
 */
export const EXPECT_GATE = { ALLOW: 'allow', REFUSE: 'refuse' } as const;
export type ExpectGate = (typeof EXPECT_GATE)[keyof typeof EXPECT_GATE];

const EXPECT_GATES: ReadonlySet<string> = new Set(Object.values(EXPECT_GATE));

export function isExpectGate(value: unknown): value is ExpectGate {
  return typeof value === 'string' && EXPECT_GATES.has(value);
}

/** Did the gate do what the label says? */
export function gateMatchesExpectation(expect: ExpectGate, decision: GateDecisionValue): boolean {
  return expect === EXPECT_GATE.ALLOW ? decision === GATE_DECISION.ALLOW : decision !== GATE_DECISION.ALLOW;
}

/** The badge colour of a decision in the console (Badge `tone`): answered = success, a gate that did its job = warning, an outage = error. */
export function gateDecisionTone(decision: GateDecisionValue): 'success' | 'warning' | 'error' {
  if (decision === GATE_DECISION.ALLOW) return 'success';
  return decision === GATE_DECISION.EMBEDDER_DEGRADED ? 'error' : 'warning';
}

/**
 * Notes the simulator card adds so an operator does not misread a result (i18n keys under
 * `qa.gate.note_*`):
 *  policyOpen  a signed-out visitor of an agent whose guest policy is `open`: the guest gate is not
 *              applied at all, so "allowed" says nothing about what is public
 *  degraded    the vector leg was down: the figures are the 0.2 sentinel, not a measurement
 *  stub        stub / keyword-only embeddings (local dev): the confidence is a hit count and the gate
 *              cannot close on topic — do not judge thresholds here (REQ D-16)
 */
export type GateNoteKey = 'policyOpen' | 'degraded' | 'stub';

export function gateNoteKeys(g: {
  as: GateAs;
  guestPolicy: string | null;
  vectorProvider: string | null;
  degraded: boolean;
}): GateNoteKey[] {
  const out: GateNoteKey[] = [];
  if (g.as === GATE_AS.GUEST && g.guestPolicy !== 'login_guidance') out.push('policyOpen');
  if (g.degraded) out.push('degraded');
  else if (g.vectorProvider !== 'voyage') out.push('stub');
  return out;
}
