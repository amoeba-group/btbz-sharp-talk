import { REFUSAL_REASON } from '@sharptalk/types';
import { summarizeLatency } from '../chat/turn-latency.util';
import type { LatencySummary } from '../chat/turn-latency.util';

/**
 * Pilot analytics — pure definitions (PLN-261012 SG-52, REQ §3.6).
 *
 * Go2Joy runs a two-week pilot and the UAT needs numbers by hotel and by role. Everything
 * in this file is I/O-free so the DEFINITIONS can be pinned by tests; the service only fetches
 * facts and feeds them here.
 *
 * ──────────────────────────────────────────────────────────────────────────────────────────
 * DEFINITIONS (the numbers on the screen mean exactly this, and nothing else)
 *
 *  conversation     a `conversations` row created inside the window, admin-preview (sandbox)
 *                   threads excluded — the same population every other lens counts.
 *
 *  handed off       a person got involved: the conversation was escalated (`escalated = 1`,
 *                   which a hand-back to the AI never clears), OR a human agent wrote in it
 *                   (a `sender_type = 'agent'` message, or an assigned `agent_id`), OR a
 *                   hand-off notice (reason in HANDOFF_REASONS) was stored in it.
 *
 *  AI-only resolved NOT handed off, AND the AI delivered at least one knowledge-grounded answer
 *                   (an AI message whose trace carries a numeric `confidence`: a RAG answer,
 *                   a replayed answer or a partner-data answer; small talk and out-of-scope
 *                   replies carry none). It deliberately does NOT reuse `aiResolutionRate`
 *                   (resolution.util): that one scores an AGENT-CLOSED thread as resolved,
 *                   which is exactly what a pilot that asks "what did the AI do by itself?"
 *                   must not do. It is evaluated at query time, so a conversation that is
 *                   still open counts as AI-only until somebody is brought in.
 *
 *  refused          NOT handed off, NO grounded answer, but at least one refusal notice
 *                   (guest gate, sign-in for orders, partner role denied …) was stored.
 *  no answer        NOT handed off, NO grounded answer, NO refusal (small talk only, or a
 *                   question still waiting for its reply).
 *
 *  The four outcomes partition the conversations: aiOnlyResolved + handedOff + refused +
 *  noAnswer === conversations, for every group and for the total.
 *
 *  handoff reason   the first hand-off-class reason stored in the conversation (closed
 *                   vocabulary, `REFUSAL_REASON` plus `user_request`); legacy escalation words
 *                   are mapped; an escalation with no stored reason falls back to the reason
 *                   on its `agent_alerts` row, else `unknown`.
 *
 *  refusals         counted per TURN (one notice = one count), by stored reason, hand-off-class
 *                   reasons excluded (those are counted once per conversation above).
 *
 *  answer           an AI turn with a numeric `confidence`. avgConfidence and noSourceRate are
 *                   per ANSWER (noSource = the answer cited no document, the same rule the
 *                   question statistics use).
 *
 *  Not recorded     `consent` and `pilot_denied` turns are never persisted (the turn is neither
 *                   stored nor sent to a model), so no count exists; the API says so rather
 *                   than reporting a misleading 0.
 * ──────────────────────────────────────────────────────────────────────────────────────────
 */

export const PILOT_GROUP = { HOTEL: 'hotel', ROLE: 'role', DAY: 'day' } as const;
export type PilotGroup = (typeof PILOT_GROUP)[keyof typeof PILOT_GROUP];
export const PILOT_GROUPS = Object.values(PILOT_GROUP) as PilotGroup[];

/** Group key of a conversation that carries no stamp (legacy rows, guests, v1 identities). */
export const PILOT_UNKNOWN_KEY = 'unknown';

/** Default window: two weeks, the length of the pilot. */
export const PILOT_DEFAULT_WINDOW_DAYS = 14;
/** Longest window a request may ask for; bounds the rows one request can scan. */
export const PILOT_MAX_WINDOW_DAYS = 92;
/** Conversations scanned for one report; past it the report is flagged `truncated`. */
export const PILOT_MAX_CONVERSATIONS = 50_000;
/** Rows of the group table returned (by volume); a hotel group can be thousands for a big tenant. */
export const PILOT_MAX_ROWS = 500;
/** Rows of the CSV export; past it the file says so. */
export const PILOT_EXPORT_MAX_ROWS = 5_000;
/** Silent hotels listed by name (the count is always exact). */
export const PILOT_SILENT_HOTELS_MAX = 200;

const DAY_MS = 86_400_000;

// ---- window --------------------------------------------------------------------------------

export type PilotWindowResult =
  | { ok: true; from: Date; to: Date; days: number }
  | { ok: false; reason: 'invalid' | 'too_long' };

/**
 * `[from, to)` for a request. Both absent = the last 14 days ending now; only `to` = the 14 days
 * before it; only `from` = from → now. An inverted or empty range is `invalid`; a range longer
 * than {@link PILOT_MAX_WINDOW_DAYS} is `too_long` (an explicit error rather than a silent clamp:
 * a UAT must never read a 92-day number believing it is 120 days).
 */
export function resolvePilotWindow(
  from: Date | undefined,
  to: Date | undefined,
  now: Date = new Date(),
): PilotWindowResult {
  const end = to ?? now;
  const start = from ?? new Date(end.getTime() - PILOT_DEFAULT_WINDOW_DAYS * DAY_MS);
  if (!(start.getTime() < end.getTime())) return { ok: false, reason: 'invalid' };
  const days = Math.ceil((end.getTime() - start.getTime()) / DAY_MS);
  if (days > PILOT_MAX_WINDOW_DAYS) return { ok: false, reason: 'too_long' };
  return { ok: true, from: start, to: end, days };
}

// ---- reasons ---------------------------------------------------------------------------------

/** Not a refusal: the customer asked for a person. Stored by `buildHandoffTrace`. */
export const USER_REQUEST_REASON = 'user_request';
/** A stored reason outside the closed vocabulary (a future member this build does not know). */
export const OTHER_REASON = 'other';
/** An escalation that left no reason anywhere. */
export const UNKNOWN_REASON = 'unknown';

/** Stored reasons that ACCOMPANY a hand-off to a person (the notice and the escalation go together). */
export const HANDOFF_REASONS: ReadonlySet<string> = new Set([
  REFUSAL_REASON.MODERATION,
  REFUSAL_REASON.POLICY_DENY,
  REFUSAL_REASON.LOW_CONFIDENCE,
  REFUSAL_REASON.ENGINE_UNAVAILABLE,
  REFUSAL_REASON.PARTNER_UNAVAILABLE,
  REFUSAL_REASON.PARTNER_UNVERIFIED,
  USER_REQUEST_REASON,
]);

/**
 * Stored reasons that turn the customer away WITHOUT a hand-off. Listed explicitly (not derived
 * as "everything else") so the spec can prove every member of REFUSAL_REASON was classified: a
 * new member that is added to the vocabulary without a decision here fails a test instead of
 * silently landing in the wrong column.
 */
export const REFUSAL_ONLY_REASONS: ReadonlySet<string> = new Set([
  REFUSAL_REASON.GUEST_GATE,
  REFUSAL_REASON.AUTH_GATE,
  REFUSAL_REASON.CONSENT,
  REFUSAL_REASON.PILOT_DENIED,
  REFUSAL_REASON.ROLE_MANAGER_ONLY,
  REFUSAL_REASON.EMBEDDER_DEGRADED,
  REFUSAL_REASON.IDENTITY_EXPIRED,
  REFUSAL_REASON.PARTNER_ROLE_DENIED,
  REFUSAL_REASON.PARTNER_CLAIMS_STALE,
  REFUSAL_REASON.PARTNER_PARAM_REJECTED,
]);

/** Reasons that are defined but never persisted — the report says "not recorded", never 0. */
export const UNRECORDED_REASONS = [REFUSAL_REASON.CONSENT, REFUSAL_REASON.PILOT_DENIED] as const;

/** Escalation words the alerts and older traces use, mapped onto the stored vocabulary. */
const LEGACY_REASON: Record<string, string> = {
  moderation_blocked: REFUSAL_REASON.MODERATION,
  policy: REFUSAL_REASON.POLICY_DENY,
};

const KNOWN_REASONS: ReadonlySet<string> = new Set([...HANDOFF_REASONS, ...REFUSAL_ONLY_REASONS]);

export function isHandoffReason(reason: string): boolean {
  return HANDOFF_REASONS.has(reason);
}

/**
 * A stored `trace.reason` as a closed-vocabulary word. Null when it is not a usable string (the
 * column is free JSON: never trust its shape). A string this build does not know becomes `other`
 * — the chart still counts it, and no free text can split a chart or reach the console.
 */
export function normalizeStoredReason(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const word = raw.trim().toLowerCase().slice(0, 64);
  if (!word) return null;
  const mapped = LEGACY_REASON[word] ?? word;
  return KNOWN_REASONS.has(mapped) ? mapped : OTHER_REASON;
}

// ---- facts -----------------------------------------------------------------------------------

/** One `conversations` row (+ its session), as the service reads it. */
export interface ConversationRow {
  id: number;
  createdAt: Date;
  hotelSn: string | null;
  actorRole: string | null;
  aiAgentId: number | null;
  escalated: boolean;
  /** `agent_id` is set: a person owns, or last owned, the thread. */
  agentAssigned: boolean;
  status: string;
  csatRating: number | null;
  sessionId: number | null;
  customerId: number | null;
  language: string | null;
}

export interface MessageStats {
  total: number;
  users: number;
  ai: number;
  /** Messages a human agent wrote. */
  agents: number;
  /** AI turns with a numeric `confidence` — the knowledge-grounded answers. */
  answers: number;
  confidenceSum: number;
  /** Answers that cited no document. */
  noSource: number;
}

export interface ReasonStat {
  reason: string;
  /** System messages that carried it. */
  turns: number;
  /** Id of the first such message — orders reasons inside a conversation. */
  firstId: number;
}

export interface ModerationStat {
  blocked: number;
  edited: number;
}

export interface PartnerStat {
  lookups: number;
  ok: number;
  denied: number;
  rejected: number;
  /** Upstream down, throttled, unconfigured or unusable (`status = 'error'`). */
  unavailable: number;
  unverified: number;
  topics: Record<string, number>;
}

/** One AI turn's persisted latency (`retrieval_trace.latencyMs`), milliseconds; null = stage not run. */
export interface LatencySample {
  total: number | null;
  classify: number | null;
  retrieve: number | null;
  generate: number | null;
  moderate: number | null;
}

export const LATENCY_STAGES = ['total', 'classify', 'retrieve', 'generate', 'moderate'] as const;
export type LatencyStageKey = (typeof LATENCY_STAGES)[number];

export const emptyMessageStats = (): MessageStats => ({
  total: 0, users: 0, ai: 0, agents: 0, answers: 0, confidenceSum: 0, noSource: 0,
});
export const emptyModeration = (): ModerationStat => ({ blocked: 0, edited: 0 });
export const emptyPartner = (): PartnerStat => ({
  lookups: 0, ok: 0, denied: 0, rejected: 0, unavailable: 0, unverified: 0, topics: {},
});

export interface ConversationFacts {
  row: ConversationRow;
  messages: MessageStats;
  reasons: ReasonStat[];
  moderation: ModerationStat;
  partner: PartnerStat;
  latencies: LatencySample[];
  /** Reason on the conversation's first `agent_alerts` row (escalation vocabulary), or null. */
  alertReason: string | null;
}

// ---- verdict ---------------------------------------------------------------------------------

export const PILOT_OUTCOME = {
  AI_ONLY: 'ai_only',
  HANDOFF: 'handoff',
  REFUSED: 'refused',
  NO_ANSWER: 'no_answer',
} as const;
export type PilotOutcome = (typeof PILOT_OUTCOME)[keyof typeof PILOT_OUTCOME];

export interface ConversationVerdict {
  handedOff: boolean;
  /** Set exactly when `handedOff`. */
  handoffReason: string | null;
  /** Non-hand-off reasons → turns. */
  refusals: Record<string, number>;
  outcome: PilotOutcome;
}

/**
 * The definitions above, applied to one conversation. Pure: same facts, same verdict.
 */
export function classifyConversation(f: ConversationFacts): ConversationVerdict {
  const handoffReasons = f.reasons
    .filter((r) => isHandoffReason(r.reason))
    .sort((a, b) => a.firstId - b.firstId);
  const refusals: Record<string, number> = {};
  for (const r of f.reasons) {
    if (isHandoffReason(r.reason)) continue;
    refusals[r.reason] = (refusals[r.reason] ?? 0) + r.turns;
  }

  const handedOff =
    f.row.escalated || f.row.agentAssigned || f.messages.agents > 0 || handoffReasons.length > 0;

  let handoffReason: string | null = null;
  if (handedOff) {
    // The stored notice is the most precise (it speaks the closed vocabulary and names partner
    // causes); the alert row is the fallback for threads whose notice predates the trace.
    const fromAlert = normalizeStoredReason(f.alertReason);
    handoffReason =
      handoffReasons[0]?.reason ?? (fromAlert && isHandoffReason(fromAlert) ? fromAlert : null) ?? UNKNOWN_REASON;
  }

  let outcome: PilotOutcome;
  if (handedOff) outcome = PILOT_OUTCOME.HANDOFF;
  else if (f.messages.answers > 0) outcome = PILOT_OUTCOME.AI_ONLY;
  else if (Object.keys(refusals).length > 0) outcome = PILOT_OUTCOME.REFUSED;
  else outcome = PILOT_OUTCOME.NO_ANSWER;

  return { handedOff, handoffReason, refusals, outcome };
}

// ---- grouping ------------------------------------------------------------------------------

/**
 * One formatter per zone, built once: constructing an `Intl.DateTimeFormat` costs far more than
 * formatting with one, and the day grouping formats every conversation of the window (measured: the
 * day view was ~2x slower than the hotel view on 8k conversations before the cache).
 */
const dayFormatters = new Map<string, Intl.DateTimeFormat | null>();

function dayFormatterFor(tz: string): Intl.DateTimeFormat | null {
  if (dayFormatters.has(tz)) return dayFormatters.get(tz) ?? null;
  let fmt: Intl.DateTimeFormat | null = null;
  try {
    // en-CA formats as YYYY-MM-DD.
    fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    fmt = null; // an unknown zone: remembered, so it is not retried (and not thrown) per conversation
  }
  // Zones come from tenant settings, a handful per process; the cap only guards a pathological caller.
  if (dayFormatters.size < 200) dayFormatters.set(tz, fmt);
  return fmt;
}

/** `YYYY-MM-DD` of an instant in an IANA zone; an unknown zone falls back to UTC (never throws). */
export function dayKeyIn(at: Date, timeZone: string | null | undefined): string {
  const fmt = dayFormatterFor((timeZone ?? '').trim() || 'UTC');
  return fmt ? fmt.format(at) : at.toISOString().slice(0, 10);
}

/** Whether a zone name is usable by `Intl` (the tenant column is free text). */
export function usableTimeZone(timeZone: string | null | undefined): string {
  const tz = (timeZone ?? '').trim();
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** The group a conversation belongs to; a missing stamp is the `unknown` group, never an error. */
export function groupKeyOf(group: PilotGroup, row: ConversationRow, timeZone: string): string {
  switch (group) {
    case PILOT_GROUP.HOTEL:
      return row.hotelSn?.trim() || PILOT_UNKNOWN_KEY;
    case PILOT_GROUP.ROLE:
      return row.actorRole?.trim() || PILOT_UNKNOWN_KEY;
    case PILOT_GROUP.DAY:
      return dayKeyIn(row.createdAt, timeZone);
  }
}

// ---- accumulator → row -----------------------------------------------------------------------

export interface PilotRow {
  key: string;
  /** The group of conversations with no stamp (legacy / guest). Never mixed into a real key. */
  unknown: boolean;
  conversations: number;
  aiOnlyResolved: number;
  handedOff: number;
  refused: number;
  noAnswer: number;
  /** Fractions of `conversations`; null when there are none. */
  aiOnlyResolvedRate: number | null;
  handoffRate: number | null;
  /** Hand-offs by reason, one count per conversation. */
  handoffReasons: Record<string, number>;
  /** Refusal notices by reason, one count per turn. */
  refusals: Record<string, number>;
  guestGatePrompts: number;
  roleManagerOnly: number;
  answers: number;
  avgConfidence: number | null;
  noSourceAnswers: number;
  noSourceRate: number | null;
  moderation: ModerationStat;
  csat: { rated: number; avg: number | null };
  /** Distinct signed-in customers (counted, never listed). */
  distinctUsers: number;
  /** Sessions with no customer behind them (guests). */
  anonymousSessions: number;
  partner: PartnerStat;
  latency: Record<LatencyStageKey, LatencySummary>;
}

export interface PilotAccumulator {
  key: string;
  conversations: number;
  aiOnlyResolved: number;
  handedOff: number;
  refused: number;
  noAnswer: number;
  handoffReasons: Record<string, number>;
  refusals: Record<string, number>;
  answers: number;
  confidenceSum: number;
  noSourceAnswers: number;
  moderation: ModerationStat;
  csatRated: number;
  csatSum: number;
  customers: Set<number>;
  anonymousSessions: Set<number>;
  partner: PartnerStat;
  latency: Record<LatencyStageKey, number[]>;
}

export function newAccumulator(key: string): PilotAccumulator {
  return {
    key,
    conversations: 0,
    aiOnlyResolved: 0,
    handedOff: 0,
    refused: 0,
    noAnswer: 0,
    handoffReasons: {},
    refusals: {},
    answers: 0,
    confidenceSum: 0,
    noSourceAnswers: 0,
    moderation: emptyModeration(),
    csatRated: 0,
    csatSum: 0,
    customers: new Set(),
    anonymousSessions: new Set(),
    partner: emptyPartner(),
    latency: { total: [], classify: [], retrieve: [], generate: [], moderate: [] },
  };
}

const bump = (map: Record<string, number>, key: string, by = 1): void => {
  map[key] = (map[key] ?? 0) + by;
};

/** Fold one conversation (and its verdict) into an accumulator. */
export function addConversation(
  acc: PilotAccumulator,
  f: ConversationFacts,
  v: ConversationVerdict,
): void {
  acc.conversations += 1;
  if (v.outcome === PILOT_OUTCOME.AI_ONLY) acc.aiOnlyResolved += 1;
  else if (v.outcome === PILOT_OUTCOME.HANDOFF) acc.handedOff += 1;
  else if (v.outcome === PILOT_OUTCOME.REFUSED) acc.refused += 1;
  else acc.noAnswer += 1;

  if (v.handoffReason) bump(acc.handoffReasons, v.handoffReason);
  for (const [reason, turns] of Object.entries(v.refusals)) bump(acc.refusals, reason, turns);

  acc.answers += f.messages.answers;
  acc.confidenceSum += f.messages.confidenceSum;
  acc.noSourceAnswers += f.messages.noSource;

  acc.moderation.blocked += f.moderation.blocked;
  acc.moderation.edited += f.moderation.edited;

  if (f.row.csatRating != null) {
    acc.csatRated += 1;
    acc.csatSum += Number(f.row.csatRating);
  }
  if (f.row.customerId != null) acc.customers.add(Number(f.row.customerId));
  else if (f.row.sessionId != null) acc.anonymousSessions.add(Number(f.row.sessionId));

  acc.partner.lookups += f.partner.lookups;
  acc.partner.ok += f.partner.ok;
  acc.partner.denied += f.partner.denied;
  acc.partner.rejected += f.partner.rejected;
  acc.partner.unavailable += f.partner.unavailable;
  acc.partner.unverified += f.partner.unverified;
  for (const [topic, n] of Object.entries(f.partner.topics)) bump(acc.partner.topics, topic, n);

  for (const sample of f.latencies) {
    for (const stage of LATENCY_STAGES) {
      const ms = sample[stage];
      if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) acc.latency[stage].push(ms);
    }
  }
}

const round = (n: number, places: number): number => {
  const k = 10 ** places;
  return Math.round(n * k) / k;
};
const rate = (num: number, den: number): number | null => (den > 0 ? round(num / den, 4) : null);

export function finalizeRow(acc: PilotAccumulator): PilotRow {
  const latency = {} as Record<LatencyStageKey, LatencySummary>;
  for (const stage of LATENCY_STAGES) latency[stage] = summarizeLatency(acc.latency[stage]);
  return {
    key: acc.key,
    unknown: acc.key === PILOT_UNKNOWN_KEY,
    conversations: acc.conversations,
    aiOnlyResolved: acc.aiOnlyResolved,
    handedOff: acc.handedOff,
    refused: acc.refused,
    noAnswer: acc.noAnswer,
    aiOnlyResolvedRate: rate(acc.aiOnlyResolved, acc.conversations),
    handoffRate: rate(acc.handedOff, acc.conversations),
    handoffReasons: { ...acc.handoffReasons },
    refusals: { ...acc.refusals },
    guestGatePrompts: acc.refusals[REFUSAL_REASON.GUEST_GATE] ?? 0,
    roleManagerOnly: acc.refusals[REFUSAL_REASON.ROLE_MANAGER_ONLY] ?? 0,
    answers: acc.answers,
    avgConfidence: acc.answers > 0 ? round(acc.confidenceSum / acc.answers, 3) : null,
    noSourceAnswers: acc.noSourceAnswers,
    noSourceRate: rate(acc.noSourceAnswers, acc.answers),
    moderation: { ...acc.moderation },
    csat: { rated: acc.csatRated, avg: acc.csatRated > 0 ? round(acc.csatSum / acc.csatRated, 2) : null },
    distinctUsers: acc.customers.size,
    anonymousSessions: acc.anonymousSessions.size,
    partner: { ...acc.partner, topics: { ...acc.partner.topics } },
    latency,
  };
}

/** Rows in display order: hotel/role by volume (unknown last on ties), day chronologically. */
export function sortRows(group: PilotGroup, rows: PilotRow[]): PilotRow[] {
  const out = [...rows];
  if (group === PILOT_GROUP.DAY) return out.sort((a, b) => a.key.localeCompare(b.key));
  return out.sort(
    (a, b) =>
      b.conversations - a.conversations ||
      Number(a.unknown) - Number(b.unknown) ||
      a.key.localeCompare(b.key),
  );
}

// ---- adoption ----------------------------------------------------------------------------------

export interface PilotAdoption {
  /** The tenant's pilot switch (`tenants.pilot_access.enabled`). */
  pilotEnabled: boolean;
  /** Hotels on the ACTIVE pilot list (paused rows are not served, so they are not counted). */
  listed: number;
  /** Listed hotels that had at least one conversation in the window. */
  listedActive: number;
  listedSilent: number;
  /** Listed hotels with no conversation — by name, capped; `listedSilent` is the exact count. */
  silentHotels: string[];
  /** Distinct hotels with a conversation in the window, on the list or not. */
  hotelsActive: number;
  /** Hotels that chatted without being on the active list (pilot off, or paused / removed since). */
  offListActive: number;
}

/**
 * Adoption: who chatted against who was allowed to. Hotel serials are compared EXACTLY (no
 * case folding, no zero stripping) because the signed claim is compared the same way by the
 * allowlist gate; two serials that differ only by case are two hotels.
 */
export function computeAdoption(
  pilotEnabled: boolean,
  listedHotels: readonly string[],
  activeHotels: Iterable<string>,
): PilotAdoption {
  const listed = [...new Set(listedHotels)];
  const active = new Set(activeHotels);
  const listedSet = new Set(listed);
  const silent = listed.filter((h) => !active.has(h)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  let offList = 0;
  for (const h of active) if (!listedSet.has(h)) offList += 1;
  return {
    pilotEnabled,
    listed: listed.length,
    listedActive: listed.length - silent.length,
    listedSilent: silent.length,
    silentHotels: silent.slice(0, PILOT_SILENT_HOTELS_MAX),
    hotelsActive: active.size,
    offListActive: offList,
  };
}

// ---- row parsing helpers (raw SQL → facts) ------------------------------------------------------

/** A number from whatever the driver hands back for a JSON/DECIMAL/BIGINT cell; null when it is not one. */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** A Date from a driver value; null when it is not a valid instant. */
export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** A persisted turn latency cell → a sample; null when the turn has no usable latency at all. */
export function parseLatencySample(raw: Record<string, unknown>): LatencySample | null {
  const sample: LatencySample = {
    total: toNumber(raw.total),
    classify: toNumber(raw.classify),
    retrieve: toNumber(raw.retrieve),
    generate: toNumber(raw.generate),
    moderate: toNumber(raw.moderate),
  };
  return LATENCY_STAGES.some((s) => sample[s] != null) ? sample : null;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
