import {
  AUDIENCE,
  GATE_DECISION,
  GUEST_POLICY,
  SESSION_IDENTITY,
  audienceOf,
  sanitizeTraceExtras,
} from '@sharptalk/types';
import type { Audience, GateDecisionValue, RefusalTraceExtra } from '@sharptalk/types';
import { envNumber } from '../../global/util/env-number.util';
import { groundingTraceExtras } from './grounding-report.util';
import type { GroundingReport, GroundingSummary } from './grounding-report.util';
import type { RetrievalOpts } from './rag.service';

/**
 * The gate decision — ONE function the chat path and the console simulator both call, so a
 * "Test as…" answer cannot differ from what a visitor of that kind would really get
 * (PLN-261012 SG-51, REQ D-13 / D-16).
 *
 * Three questions are asked of a turn, in this order, and each is a function below:
 *
 *  1. `decideGuestGate`  — is the visitor a signed-out guest of a `login_guidance` agent whose
 *                          GUEST-VISIBLE knowledge does not ground the question? (guest_gate)
 *  2. the answerability  — does the audience-scoped knowledge ground the question at all? In chat
 *                          this is `answer.confidence` (it is the model call's own retrieval, and
 *                          it carries the order / partner-data floors); the simulator measures it
 *                          with `groundingReport`. Below the handoff bar → question 3.
 *  3. `decideLowConfidence` — the turn would be handed to a person: is it because a RECEPTIONIST
 *                          asked a manager-only topic (role_manager_only), because the vector leg
 *                          was down and nothing could be measured (embedder_degraded), or because
 *                          nothing grounds it (low_confidence)?
 *
 * `decideGate` composes the three for the simulator and the calibration CLI. Chat calls 1 and 3
 * at the points where its own flow already asks them (1 before the model call, 3 after a low
 * answer confidence), which keeps every customer-visible outcome exactly what it was.
 *
 * "Pure-ish": the only I/O is through the `GateRag` port (retrieval and two config reads); no
 * persistence, no logging, no module state besides the two env-read bars.
 */

/** The bar a delivered answer must clear; below it the turn is handed to a person (FR-S3). */
export const ESCALATION_CONFIDENCE = 0.45;

/**
 * Guest gate bar (PLN-261001): how confidently the GUEST-VISIBLE categories must ground a question
 * before a signed-out visitor is answered from them. Defaults to the handoff bar; an operator can
 * raise it per environment when domain-near public documents (same product, same vocabulary) clear
 * 0.45 for questions that should have asked for a sign-in. Only meaningful with real embeddings —
 * the stub's count estimate never falls below it. NOTE (SG-51, D-16): with real embeddings the
 * confidence is bimodal — 0.2 when no document reaches RAG_MIN_SIMILARITY, else the best similarity
 * clamped to [0.5, 0.95] — so any value in (0.2, 0.5] closes the gate identically. `npm run
 * gate:calibrate` measures the labelled set and says which values are equivalent.
 */
export const GUEST_GATE_CONFIDENCE = envNumber('GUEST_GATE_CONFIDENCE', ESCALATION_CONFIDENCE);

/** The part of `RagService` the decision reads. A positional double in a spec is enough. */
export interface GateRag {
  agentGuestPolicy(tenantId: number, aiAgentId?: number | null): Promise<string>;
  groundingConfidence(
    tenantId: number,
    query: string,
    aiAgentId?: number | null,
    opts?: RetrievalOpts,
  ): Promise<number>;
  /**
   * Optional on purpose: a positional `RagService` double that predates SG-51 only has
   * `groundingConfidence`; the decision then works on the bare number (no similarity, no categories).
   */
  groundingReport?(
    tenantId: number,
    query: string,
    aiAgentId?: number | null,
    opts?: RetrievalOpts,
    queries?: Array<string | undefined>,
  ): Promise<GroundingReport>;
  /** Optional like above; absent reads as "no tiers" for the manager-only check (as chat always did). */
  hasAudienceTiers?(tenantId: number): Promise<boolean>;
}

/** What `effectiveIdentity()` / `simulatedIdentity()` return — all the decision reads. */
export interface GateIdentity {
  level?: string | null;
  claims?: { signed?: boolean | null; role?: string | null } | null;
  /** The signed claims lapsed (SG-03): the refusal is filed as identity_expired, not as a plain guest gate. */
  expired?: boolean;
}

export interface GateRequest {
  tenantId: number;
  /** The EFFECTIVE agent (`rag.effectiveAgentId`), never the raw pin. */
  agentId: number | null;
  identity: GateIdentity;
  /** The retrieval text: chat passes `retrievalQuery(history, text)`, the simulator the bare question. */
  query: string;
}

export interface GateOptions {
  /**
   * Treat the agent's guest policy as this instead of reading it. Calibration only: the gate is
   * measured BEFORE an operator switches an agent to `login_guidance` ("what if it were on").
   */
  assumeGuestPolicy?: string;
  /** The guest bar; defaults to `GUEST_GATE_CONFIDENCE`. Calibration sweeps it arithmetically instead. */
  guestThreshold?: number;
}

/** One category the retrieval matched, best similarity first; the tier is added by the simulator. */
export interface GateMatchedCategory {
  category: string | null;
  group: string | null;
  /** Best similarity among this category's retrieved documents. */
  similarity: number | null;
  docCount: number;
}

export interface GateDecision {
  decision: GateDecisionValue;
  /**
   * Which question decided: `guest` = the guest gate (question 1), `answer` = the answerability / low
   * confidence (questions 2-3). An `embedder_degraded` refusal reads differently to the customer
   * (sign-in prompt vs hand-off notice) depending on it.
   */
  stage: 'guest' | 'answer';
  /** The agent's policy gates THIS identity (a guest of a login_guidance agent). */
  guestGated: boolean;
  /** The tier the answer is FOR (audienceOf the identity). */
  audience: Audience;
  /** The bar the deciding measurement was compared with. */
  threshold: number;
  /** The deciding measurement on the confidence scale; null when nothing was measured (no gate applies). */
  grounded: number | null;
  topSimilarity: number | null;
  matchedCategories: GateMatchedCategory[];
  /** 'voyage' | 'stub' | null (Qdrant off or failed). */
  vectorProvider: string | null;
  /** The vector leg should have run and did not. */
  degraded: boolean;
  degradedReason: string | null;
  /** The signed claims lapsed — only meaningful for a guest_gate refusal. */
  identityExpired: boolean;
  /** The agent's guest policy as read (or assumed); null when it was not needed. */
  guestPolicy: string | null;
  /** The measurement's raw summary, kept for the trace. */
  summary: GroundingSummary;
}

const EMPTY_SUMMARY: GroundingSummary = {
  topSimilarity: null,
  categories: [],
  docIds: [],
  vectorProvider: null,
  degraded: false,
};

/** A retrieval measurement; the bare-number double yields a report without similarities. */
async function measure(
  rag: GateRag,
  req: GateRequest,
  opts: RetrievalOpts | undefined,
  queries?: Array<string | undefined>,
): Promise<GroundingReport> {
  if (rag.groundingReport) {
    return rag.groundingReport(req.tenantId, req.query, req.agentId, opts, queries);
  }
  const confidence = await rag.groundingConfidence(req.tenantId, req.query, req.agentId, opts);
  return { ...EMPTY_SUMMARY, confidence, chunks: [], degradedReason: null };
}

/** Group a report's documents by (group, category), in rank order, with the best similarity each. */
export function matchedCategoriesOf(chunks: GroundingReport['chunks']): GateMatchedCategory[] {
  const out: GateMatchedCategory[] = [];
  for (const c of chunks) {
    if (c.category == null) continue;
    const hit = out.find((o) => o.category === c.category && o.group === c.group);
    if (hit) {
      hit.docCount += 1;
      if (c.similarity != null && (hit.similarity == null || c.similarity > hit.similarity)) hit.similarity = c.similarity;
    } else {
      out.push({ category: c.category, group: c.group, similarity: c.similarity, docCount: 1 });
    }
  }
  return out;
}

function decision(
  base: Pick<GateDecision, 'decision' | 'stage' | 'guestGated' | 'audience' | 'threshold' | 'identityExpired' | 'guestPolicy'>,
  report: GroundingReport | null,
): GateDecision {
  const summary = report ?? EMPTY_SUMMARY;
  return {
    ...base,
    grounded: report ? report.confidence : null,
    topSimilarity: summary.topSimilarity,
    matchedCategories: report ? matchedCategoriesOf(report.chunks) : [],
    vectorProvider: summary.vectorProvider,
    degraded: summary.degraded,
    degradedReason: report?.degradedReason ?? null,
    summary: report
      ? {
          topSimilarity: report.topSimilarity,
          categories: report.categories,
          docIds: report.docIds,
          vectorProvider: report.vectorProvider,
          degraded: report.degraded,
        }
      : EMPTY_SUMMARY,
  };
}

/**
 * Question 1 — the guest gate (PLN-261001 v1.1 B5). Placed by chat after the human-request and
 * small-talk branches on purpose: a guest can still reach a person and still be greeted. An
 * unverified visitor of a `login_guidance` agent is answered only from guest-visible categories;
 * "grounded" below the bar → a sign-in prompt, and no model call.
 *
 * The measurement is the STRICT confidence: while the vector leg is down it stays at the 0.2
 * sentinel (`VECTOR_DOWN_GROUNDING_CONFIDENCE`), so an outage never loosens the gate. That refusal
 * is reported as `embedder_degraded` (not `guest_gate`): same customer-visible reply, but an
 * operator reading the data can tell "the question is not public" from "we could not look".
 */
export async function decideGuestGate(
  rag: GateRag,
  req: GateRequest,
  opts: GateOptions = {},
): Promise<GateDecision> {
  const threshold = opts.guestThreshold ?? GUEST_GATE_CONFIDENCE;
  const audience = audienceOf(req.identity);
  const identityExpired = req.identity.expired === true;
  // Same order as chat always had it: the verified check first, so a signed-in session never reads
  // the policy at all.
  const unverified = req.identity.level !== SESSION_IDENTITY.VERIFIED;
  const guestPolicy = unverified
    ? (opts.assumeGuestPolicy ?? (await rag.agentGuestPolicy(req.tenantId, req.agentId)))
    : null;
  const guestGated = unverified && guestPolicy === GUEST_POLICY.LOGIN_GUIDANCE;
  const base = { stage: 'guest' as const, guestGated, audience, threshold, identityExpired, guestPolicy };
  if (!guestGated) return decision({ ...base, decision: GATE_DECISION.ALLOW }, null);

  // `audience` too (SG-10): the gate asks "is it public?", this asks "may this audience read it?" —
  // a category left guest-visible by a hand edit must still not leak a manager topic.
  const report = await measure(rag, req, { guestOnly: true, audience });
  if (report.confidence < threshold) {
    return decision(
      { ...base, decision: report.degraded ? GATE_DECISION.EMBEDDER_DEGRADED : GATE_DECISION.GUEST_GATE },
      report,
    );
  }
  return decision({ ...base, decision: GATE_DECISION.ALLOW }, report);
}

/** What the audience-scoped answer retrieval found — chat's `answer`, or the simulator's report. */
export interface AnswerMeasure {
  confidence: number;
  grounding?: GroundingSummary;
}

/**
 * Question 3 — the answer's confidence is under the handoff bar (`answer.confidence <
 * ESCALATION_CONFIDENCE`, decided by the caller). Why? (PLN-261012 SG-10.)
 *
 * A signed-in partner below manager gets ONE extra grounding check with the manager audience (one
 * more embed, only on this branch and only when the tenant has a manager-only category): if THAT
 * grounds, the topic exists but is not theirs to read — `role_manager_only`, and the reply points to
 * the manager account instead of paging a person. A guest is told to sign in (question 1) or handed
 * off; `skipRoleTier` is for an engine outage / a deny rule, where the page is required anyway.
 *
 * Otherwise the turn is `embedder_degraded` when the vector leg was down (the 0.2 sentinel is not a
 * judgement on the question) and `low_confidence` when it ran and found nothing.
 */
export async function decideLowConfidence(
  rag: GateRag,
  req: GateRequest,
  measured: AnswerMeasure,
  extra: { guestGated?: boolean; skipRoleTier?: boolean; guestPolicy?: string | null } = {},
): Promise<GateDecision> {
  const audience = audienceOf(req.identity);
  const base = {
    stage: 'answer' as const,
    guestGated: extra.guestGated === true,
    audience,
    threshold: ESCALATION_CONFIDENCE,
    identityExpired: req.identity.expired === true,
    guestPolicy: extra.guestPolicy ?? null,
  };
  if (!extra.skipRoleTier && audience === AUDIENCE.PARTNER && (await rag.hasAudienceTiers?.(req.tenantId))) {
    const managerReport = await measure(rag, req, { audience: AUDIENCE.MANAGER });
    if (managerReport.confidence >= ESCALATION_CONFIDENCE) {
      return decision({ ...base, decision: GATE_DECISION.ROLE_MANAGER_ONLY }, managerReport);
    }
  }
  const summary = measured.grounding ?? EMPTY_SUMMARY;
  return {
    ...base,
    decision: summary.degraded ? GATE_DECISION.EMBEDDER_DEGRADED : GATE_DECISION.LOW_CONFIDENCE,
    grounded: measured.confidence,
    topSimilarity: summary.topSimilarity,
    // The caller's measurement has no per-document breakdown beyond the summary: categories by name only.
    matchedCategories: summary.categories.map((category) => ({ category, group: null, similarity: null, docCount: 0 })),
    vectorProvider: summary.vectorProvider,
    degraded: summary.degraded,
    degradedReason: null,
    summary,
  };
}

/**
 * The whole decision, for a viewer the caller describes: the simulator ("Test as…"), the golden
 * runner and the calibration CLI. Composes questions 1–3.
 */
export async function decideGate(
  rag: GateRag,
  req: GateRequest,
  opts: GateOptions = {},
): Promise<GateDecision> {
  const guest = await decideGuestGate(rag, req, opts);
  if (guest.decision !== GATE_DECISION.ALLOW) return guest;

  // Passed (or no gate applies). Is the question answerable for this audience at all?
  let report: GroundingReport | null = null;
  let measured: AnswerMeasure;
  if (guest.guestGated) {
    // The guest-scoped retrieval chat's answer() is about to run IS the measurement just taken.
    measured = { confidence: guest.grounded ?? 0, grounding: guest.summary };
  } else {
    // What `answer()` would be judged on: the audience scope, and the capped keyword confidence a
    // degraded vector leg may earn (queries supplied), exactly as the model path computes it.
    report = await measure(rag, req, { audience: guest.audience }, [req.query]);
    measured = { confidence: report.confidence, grounding: report };
  }
  if (measured.confidence >= ESCALATION_CONFIDENCE) {
    if (guest.guestGated) return guest;
    return decision({ ...baseOf(guest), decision: GATE_DECISION.ALLOW, threshold: ESCALATION_CONFIDENCE }, report);
  }
  const low = await decideLowConfidence(rag, req, measured, {
    guestGated: guest.guestGated,
    guestPolicy: guest.guestPolicy,
  });
  // The matched categories of a plain low-confidence turn come from the measurement itself.
  return low.decision === GATE_DECISION.ROLE_MANAGER_ONLY || !report
    ? low
    : { ...low, matchedCategories: matchedCategoriesOf(report.chunks) };
}

function baseOf(d: GateDecision) {
  return {
    stage: 'answer' as const,
    guestGated: d.guestGated,
    audience: d.audience,
    threshold: d.threshold,
    identityExpired: d.identityExpired,
    guestPolicy: d.guestPolicy,
  };
}

/**
 * The stored trace extras of a decision (PLN-261012 SG-51): what was measured and decided, primitives
 * only, NEVER the question. Spread into the system message of a refusal (via `buildRefusalTrace`) and,
 * for a pass, into the AI turn's own trace. `gate` is the decision word; `reason` (the closed
 * vocabulary analytics group by) is the caller's.
 */
export function gateTraceExtras(d: GateDecision): RefusalTraceExtra {
  return sanitizeTraceExtras({
    gate: d.decision,
    audience: d.audience,
    // A decision that measured nothing (no gate applied) has no figures and no provider to report.
    ...(d.grounded != null
      ? { grounded: d.grounded, threshold: d.threshold, ...groundingTraceExtras(d.summary) }
      : {}),
  });
}
