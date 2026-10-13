import { EXPECT_GATE, GATE_AS_OPTIONS, GATE_DECISION } from '@sharptalk/types';
import type { ExpectGate, GateAs, GateDecisionValue } from '@sharptalk/types';
import { sanitizeAudience, sanitizeExpectGate } from '../ai-coach/golden-gate-grade.util';
import { parseCsvRecords } from '../knowledge/csv.util';

/**
 * Calibrating the guest gate (PLN-261012 SG-51, REQ D-16) — the pure part of `npm run gate:calibrate`.
 *
 * What is calibrated: `GUEST_GATE_CONFIDENCE`, the bar the GUEST-visible knowledge must clear before a
 * signed-out visitor of a login_guidance agent is answered. The labelled set is questions with the
 * viewer asking and what the gate should do (`allow` | `refuse`). Each question is measured ONCE
 * (retrieval is the expensive part); every candidate bar is then evaluated arithmetically on the
 * measured confidences, so the sweep costs nothing extra.
 *
 * The shape of the confidence matters, and the report says so. With real embeddings it is BIMODAL:
 * 0.2 when no document reaches RAG_MIN_SIMILARITY, else the best similarity clamped to [0.5, 0.95]
 * (RagService.confidence). So every bar in (0.2, 0.5] behaves identically, a bar at or under 0.2
 * never closes, and one over 0.95 always does — the useful choices live in (0.5, 0.95], where the
 * confidence IS the similarity.
 *
 * Signed-in viewers never meet the guest bar (verified sessions skip the gate); their decision does
 * not move with it, so it is carried as measured and reported per audience at every bar.
 *
 * Safety bias: a LEAK (the gate allowed what must be refused) is worse than an over-refusal (a
 * public question sent to sign in), so the recommendation minimises leaks first, then F1, and among
 * equal bars takes the strictest.
 */

/** The confidence scale's fixed points — mirrors `RagService.confidence()`; a spec pins the mirror. */
export const CONFIDENCE_SCALE = { sentinel: 0.2, floor: 0.5, cap: 0.95 } as const;

/** One labelled question, measured. */
export interface CalibrationSample {
  id: number;
  question: string;
  audience: GateAs;
  expect: ExpectGate;
  /** What the live gate decides at the default bars. */
  decision: GateDecisionValue;
  /** The guest gate decides this sample (a guest): only these move with the bar. */
  thresholdSensitive: boolean;
  /** The deciding measurement; for a threshold-sensitive sample, the guest-scope grounding. */
  grounded: number | null;
  topSimilarity: number | null;
  /** 'voyage' | 'stub' | null (no vector leg). */
  vectorProvider: string | null;
  /** The vector leg should have run and did not (Voyage/Qdrant failed). */
  degraded: boolean;
}

export type Verdict = 'allow' | 'refuse';

/** The verdict a sample gets at a given guest bar. Missing measurement fails CLOSED. */
export function decisionAt(sample: CalibrationSample, threshold: number): Verdict {
  if (sample.thresholdSensitive) return (sample.grounded ?? 0) < threshold ? 'refuse' : 'allow';
  return sample.decision === GATE_DECISION.ALLOW ? 'allow' : 'refuse';
}

/**
 * Positive class = refuse (the gate's job). tp: expected refuse, refused. fn: expected refuse, ALLOWED
 * — a LEAK. fp: expected allow, refused — an over-refusal. tn: expected allow, allowed.
 */
export interface Confusion {
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  /** tp / (tp + fp); null when the gate refused nothing. */
  precision: number | null;
  /** tp / (tp + fn); null when nothing had to be refused. */
  recall: number | null;
  f1: number | null;
}

const ratio = (n: number, d: number): number | null => (d === 0 ? null : n / d);
const round4 = (n: number | null): number | null => (n == null ? null : Math.round(n * 10_000) / 10_000);

export function confusionOf(samples: CalibrationSample[], threshold: number): Confusion {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const s of samples) {
    const got = decisionAt(s, threshold);
    if (s.expect === EXPECT_GATE.REFUSE) got === 'refuse' ? tp++ : fn++;
    else got === 'refuse' ? fp++ : tn++;
  }
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  // No positive class (nothing had to be refused): F1 is undefined. The gate refused nothing while
  // something had to be refused: every positive was missed, F1 = 0.
  const f1 = recall == null ? null : precision == null || precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, tn, precision: round4(precision), recall: round4(recall), f1: round4(f1) };
}

/** Where a candidate bar sits on the bimodal confidence scale. */
export type BarClass = 'open' | 'floor' | 'live' | 'closed';

export function barClass(threshold: number): BarClass {
  if (threshold <= CONFIDENCE_SCALE.sentinel) return 'open'; // a 0.2 sentinel is not < 0.2: the gate never closes
  if (threshold <= CONFIDENCE_SCALE.floor) return 'floor'; // (0.2, 0.5]: every real score is 0.2 or >= 0.5 — all alike
  if (threshold <= CONFIDENCE_SCALE.cap) return 'live'; // (0.5, 0.95]: the confidence is the similarity itself
  return 'closed'; // above the cap: every question is refused
}

export interface ThresholdRow {
  threshold: number;
  class: BarClass;
  total: Confusion;
  byAudience: Partial<Record<GateAs, Confusion>>;
  /** Total false-allows (expected refuse, allowed) — the number that must be 0. */
  leaks: number;
  /** Total false-refuses (expected allow, refused). */
  falseRefuses: number;
}

/** The candidate bars, `from`..`to` inclusive by `step`, rounded so 0.45 + 0.05 never prints 0.5000000001. */
export function thresholdGrid(from = 0.45, to = 0.95, step = 0.05): number[] {
  if (!(step > 0) || to < from) return [];
  const out: number[] = [];
  const n = Math.round((to - from) / step);
  for (let i = 0; i <= n; i++) out.push(Math.round((from + i * step) * 10_000) / 10_000);
  return out;
}

function rowAt(samples: CalibrationSample[], threshold: number): ThresholdRow {
  const byAudience: Partial<Record<GateAs, Confusion>> = {};
  for (const a of GATE_AS_OPTIONS) {
    const mine = samples.filter((s) => s.audience === a);
    if (mine.length) byAudience[a] = confusionOf(mine, threshold);
  }
  const total = confusionOf(samples, threshold);
  return { threshold, class: barClass(threshold), total, byAudience, leaks: total.fn, falseRefuses: total.fp };
}

/** A run of consecutive bars that give EXACTLY the same verdict to every sample. */
export interface EquivalenceGroup {
  from: number;
  to: number;
  thresholds: number[];
}

export interface Recommendation {
  threshold: number;
  /** Every candidate bar that behaves identically to it on this set (the strictest was taken). */
  equivalent: number[];
  leaks: number;
  falseRefuses: number;
  f1: number | null;
  /** No false-allow at this bar. */
  leakFree: boolean;
}

export interface Separation {
  /** The highest guest-gate grounding among questions that MUST be refused. */
  maxRefused: number | null;
  /** The lowest guest-gate grounding among questions that must be ALLOWED. */
  minAllowed: number | null;
  /** minAllowed - maxRefused: > 0 means some bar separates the two classes cleanly. */
  gap: number | null;
  separable: boolean;
}

export interface CalibrationReport {
  samples: number;
  /** Samples per viewer. */
  byAudience: Partial<Record<GateAs, number>>;
  /** How many samples the guest bar decides (the rest never meet it). */
  thresholdSensitive: number;
  rows: ThresholdRow[];
  /** Consecutive candidate bars that behave identically on this set (groups of one omitted). */
  identical: EquivalenceGroup[];
  separation: Separation;
  /** The recommended bar, or null with `reason` when the set cannot support one. */
  recommendation: Recommendation | null;
  reason: string | null;
  /** The current bar, evaluated, so "what would change" is one line. */
  current: { threshold: number; leaks: number; falseRefuses: number } | null;
}

const signature = (samples: CalibrationSample[], t: number) => samples.map((s) => (decisionAt(s, t) === 'refuse' ? 'r' : 'a')).join('');

export function buildCalibration(
  samples: CalibrationSample[],
  options: { thresholds?: number[]; currentThreshold?: number } = {},
): CalibrationReport {
  const thresholds = [...(options.thresholds ?? thresholdGrid())].sort((a, b) => a - b);
  const rows = thresholds.map((t) => rowAt(samples, t));

  // Behavioural equivalence on THIS set: same verdict vector.
  const identical: EquivalenceGroup[] = [];
  let run: number[] = [];
  let runSig: string | null = null;
  const flush = () => {
    if (run.length > 1) identical.push({ from: run[0], to: run[run.length - 1], thresholds: run });
    run = [];
  };
  for (const t of thresholds) {
    const sig = signature(samples, t);
    if (sig !== runSig) {
      flush();
      runSig = sig;
    }
    run.push(t);
  }
  flush();

  const sensitive = samples.filter((s) => s.thresholdSensitive && s.grounded != null);
  const refusedMax = sensitive.filter((s) => s.expect === EXPECT_GATE.REFUSE).map((s) => s.grounded as number);
  const allowedMin = sensitive.filter((s) => s.expect === EXPECT_GATE.ALLOW).map((s) => s.grounded as number);
  const maxRefused = refusedMax.length ? Math.max(...refusedMax) : null;
  const minAllowed = allowedMin.length ? Math.min(...allowedMin) : null;
  const gap = maxRefused != null && minAllowed != null ? round4(minAllowed - maxRefused) : null;
  const separation: Separation = { maxRefused, minAllowed, gap, separable: gap != null && gap > 0 };

  const { recommendation, reason } = recommend(samples, rows, refusedMax.length > 0 && allowedMin.length > 0);

  const cur = options.currentThreshold;
  const byAudience: Partial<Record<GateAs, number>> = {};
  for (const a of GATE_AS_OPTIONS) {
    const n = samples.filter((s) => s.audience === a).length;
    if (n) byAudience[a] = n;
  }
  return {
    samples: samples.length,
    byAudience,
    thresholdSensitive: samples.filter((s) => s.thresholdSensitive).length,
    rows,
    identical,
    separation,
    recommendation,
    reason,
    current:
      cur == null
        ? null
        : (() => {
            const c = confusionOf(samples, cur);
            return { threshold: cur, leaks: c.fn, falseRefuses: c.fp };
          })(),
  };
}

function recommend(
  samples: CalibrationSample[],
  rows: ThresholdRow[],
  bothClasses: boolean,
): { recommendation: Recommendation | null; reason: string | null } {
  if (!bothClasses) {
    return {
      recommendation: null,
      reason:
        'the labelled set needs at least one guest question that must be REFUSED and one that must be ALLOWED to choose a bar (a one-sided set would just pick an extreme)',
    };
  }
  // A bar at or under the sentinel never closes the gate: never recommend one.
  const candidates = rows.filter((r) => r.class !== 'open');
  if (!candidates.length) return { recommendation: null, reason: 'no candidate bar above 0.2 (a bar at or under 0.2 never closes the gate)' };
  // Fewest leaks, then best F1, then fewest over-refusals, then the STRICTEST bar.
  const best = [...candidates].sort(
    (a, b) =>
      a.leaks - b.leaks ||
      (b.total.f1 ?? -1) - (a.total.f1 ?? -1) ||
      a.falseRefuses - b.falseRefuses ||
      b.threshold - a.threshold,
  )[0];
  const sig = signature(samples, best.threshold);
  const equivalent = rows.filter((r) => signature(samples, r.threshold) === sig).map((r) => r.threshold);
  return {
    recommendation: {
      threshold: best.threshold,
      equivalent,
      leaks: best.leaks,
      falseRefuses: best.falseRefuses,
      f1: best.total.f1,
      leakFree: best.leaks === 0,
    },
    reason: best.leaks === 0 ? null : 'NO leak-free bar exists on this set: a question that must be refused grounds as well as one that must be allowed',
  };
}

// ---- is the measurement real? --------------------------------------------------------------------------------

export interface Meaningfulness {
  meaningful: boolean;
  /** Samples per vector provider ('voyage', 'stub', 'none'). */
  providers: Record<string, number>;
  /** Samples measured while the vector leg was degraded (Voyage / Qdrant failed). */
  degradedSamples: number;
  reasons: string[];
}

/**
 * Real calibration needs real embeddings: with the stub embedder (or a keyword-only fallback) the
 * confidence is a hit count that never falls below 0.62 once ANY document matches, so the gate
 * essentially never closes and every number below would be fiction (REQ D-16). Anything but
 * 'voyage' on any sample, or any degraded measurement, makes the run not meaningful.
 */
export function assessMeaningfulness(samples: CalibrationSample[]): Meaningfulness {
  const providers: Record<string, number> = {};
  for (const s of samples) {
    const key = s.vectorProvider ?? 'none';
    providers[key] = (providers[key] ?? 0) + 1;
  }
  const degradedSamples = samples.filter((s) => s.degraded).length;
  const notVoyage = samples.filter((s) => s.vectorProvider !== 'voyage').length;
  const reasons: string[] = [];
  if (!samples.length) reasons.push('no questions were measured');
  if (notVoyage > 0) {
    const stub = providers.stub ?? 0;
    reasons.push(
      stub === samples.length
        ? 'STUB EMBEDDINGS: the confidence is a hit count (>= 0.62 as soon as one document matches), so the gate never closes on topic'
        : `${notVoyage} of ${samples.length} questions were measured WITHOUT real embeddings (${Object.entries(providers).map(([k, v]) => `${k}: ${v}`).join(', ')})`,
    );
  }
  if (degradedSamples > 0) {
    reasons.push(`the vector leg was degraded for ${degradedSamples} question(s): Voyage or Qdrant failed, and the 0.2 sentinel is not a measurement`);
  }
  return { meaningful: reasons.length === 0, providers, degradedSamples, reasons };
}

export const NOT_MEANINGFUL_EXIT_CODE = 3;
/** The run was real but no bar is leak-free on the set. */
export const NO_SAFE_BAR_EXIT_CODE = 2;

export function notMeaningfulBanner(m: Meaningfulness): string {
  const width = 78;
  const bar = '#'.repeat(width);
  // One boxed row per line; a long sentence wraps instead of being cut off.
  const rows = (text: string, bullet = ''): string[] => {
    const room = width - 5 - bullet.length;
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      if (line && `${line} ${word}`.length > room) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
    return lines.map((l, i) => `#  ${i === 0 ? bullet : ' '.repeat(bullet.length)}${l}`.padEnd(width - 1) + '#');
  };
  return [
    bar,
    // No question reached real embeddings: the stub (or keyword-only) case the guard exists for. A mix, or a
    // degraded vector leg, says what it is instead.
    ...rows(
      Object.keys(m.providers).length > 0 && !('voyage' in m.providers)
        ? 'NOT MEANINGFUL: stub embeddings — gate never closes'
        : 'NOT MEANINGFUL: the vector leg was not real for every question',
    ),
    ...rows('Do NOT use any number below: it was measured without real Voyage + Qdrant.'),
    ...m.reasons.flatMap((r) => rows(r, '- ')),
    ...rows('Run this against an environment with VOYAGE_API_KEY, Qdrant and an indexed knowledge base.'),
    bar,
  ].join('\n');
}

// ---- labelled input ------------------------------------------------------------------------------------------

export interface LabelledItem {
  question: string;
  audience: GateAs;
  expect: ExpectGate;
  language?: string;
}

/**
 * The labelled set from a CSV `question,audience,expect` (header required; `expect_gate` is accepted
 * for `expect`; an optional `language` column is read). Lines starting with `#` are comments — the
 * starter file carries its "DRAFT, to be reviewed by Go2Joy ops" notice that way. Bad rows are reported
 * by line, never silently dropped.
 */
export function parseLabelledCsv(text: string): { items: LabelledItem[]; errors: string[] } {
  const body = text
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n');
  const { headers, records } = parseCsvRecords(body);
  const errors: string[] = [];
  const lower = headers.map((h) => h.toLowerCase());
  if (!lower.includes('question') || !lower.includes('audience') || !(lower.includes('expect') || lower.includes('expect_gate'))) {
    return { items: [], errors: ['the header must contain: question, audience, expect'] };
  }
  const items: LabelledItem[] = [];
  records.forEach((rec, i) => {
    const get = (name: string) => rec[headers[lower.indexOf(name)]] ?? '';
    const question = get('question').trim();
    const audience = sanitizeAudience(get('audience'));
    const expect = sanitizeExpectGate(lower.includes('expect') ? get('expect') : get('expect_gate'));
    const row = i + 2; // 1-based, after the header
    if (!question) errors.push(`row ${row}: empty question`);
    else if (!audience) errors.push(`row ${row}: audience must be one of ${GATE_AS_OPTIONS.join(', ')}`);
    else if (!expect) errors.push(`row ${row}: expect must be allow or refuse`);
    else items.push({ question, audience, expect, ...(lower.includes('language') && get('language') ? { language: get('language').toUpperCase() } : {}) });
  });
  return { items, errors };
}

// ---- text report -------------------------------------------------------------------------------------------------

const pct = (n: number | null) => (n == null ? '  -  ' : n.toFixed(2).padStart(5));

export function formatCalibration(report: CalibrationReport): string {
  const lines: string[] = [];
  const aud = Object.entries(report.byAudience).map(([a, n]) => `${a}: ${n}`).join(', ');
  lines.push(`Labelled questions: ${report.samples} (${aud}); ${report.thresholdSensitive} are decided by the guest bar.`);
  lines.push('');
  lines.push('Guest bar sweep (positive class = refuse; LEAK = must refuse but was allowed, OVER = must allow but was refused)');
  lines.push('  bar   class   leaks  over  precision recall   F1');
  for (const r of report.rows) {
    lines.push(
      `  ${r.threshold.toFixed(2)}  ${r.class.padEnd(6)}  ${String(r.leaks).padStart(5)}  ${String(r.falseRefuses).padStart(4)}   ${pct(r.total.precision)}    ${pct(r.total.recall)}  ${pct(r.total.f1)}`,
    );
  }
  lines.push('');
  if (report.identical.length) {
    lines.push('Bars that behave IDENTICALLY on this set (the bimodal confidence leaves nothing in between):');
    for (const g of report.identical) lines.push(`  ${g.from.toFixed(2)} .. ${g.to.toFixed(2)}   (${g.thresholds.map((t) => t.toFixed(2)).join(', ')})`);
  } else {
    lines.push('No two candidate bars behave identically on this set.');
  }
  lines.push(`Structure: <= 0.20 never closes · (0.20, 0.50] ALL identical (scores are 0.2 or >= 0.5) · (0.50, 0.95] live · > 0.95 refuses everything.`);
  const s = report.separation;
  lines.push(
    s.gap == null
      ? 'Separation: not computable (needs guest questions of both kinds).'
      : `Separation: highest must-refuse grounding ${s.maxRefused?.toFixed(3)}, lowest must-allow ${s.minAllowed?.toFixed(3)}, gap ${s.gap.toFixed(3)} — ${s.separable ? 'a bar can separate them' : 'OVERLAP: no bar separates them'}.`,
  );
  lines.push('');
  const rec = report.recommendation;
  if (rec) {
    lines.push(
      `RECOMMENDED GUEST_GATE_CONFIDENCE=${rec.threshold.toFixed(2)}  (leaks ${rec.leaks}, over-refusals ${rec.falseRefuses}, F1 ${rec.f1 ?? '-'}${rec.leakFree ? '' : ' — NOT leak-free'})`,
    );
    if (rec.equivalent.length > 1) lines.push(`  equivalent on this set: ${rec.equivalent.map((t) => t.toFixed(2)).join(', ')} — the strictest was taken (safety bias: no leaks).`);
    const row = report.rows.find((r) => r.threshold === rec.threshold);
    if (row) {
      lines.push('  per audience at that bar:');
      for (const [a, c] of Object.entries(row.byAudience)) {
        lines.push(`    ${a.padEnd(12)} precision ${pct(c.precision)}  recall ${pct(c.recall)}  F1 ${pct(c.f1)}   leaks ${c.fn}  over-refusals ${c.fp}`);
      }
    }
  } else {
    lines.push(`NO RECOMMENDATION: ${report.reason}`);
  }
  if (report.reason && rec) lines.push(`WARNING: ${report.reason}`);
  if (report.current) lines.push(`Current bar ${report.current.threshold.toFixed(2)}: leaks ${report.current.leaks}, over-refusals ${report.current.falseRefuses}.`);
  return lines.join('\n');
}
