import {
  NOT_MEANINGFUL_EXIT_CODE,
  NO_SAFE_BAR_EXIT_CODE,
  assessMeaningfulness,
  buildCalibration,
  formatCalibration,
  notMeaningfulBanner,
  thresholdGrid,
} from '../domain/chat/gate-calibration.util';
import type { CalibrationReport, CalibrationSample, LabelledItem, Meaningfulness } from '../domain/chat/gate-calibration.util';
import type { GateDecision } from '../domain/chat/gate-decision';

/**
 * The testable heart of `npm run gate:calibrate` (PLN-261012 SG-51, REQ D-16): argument parsing and
 * the run itself, with the retrieval behind a `measure` function so a spec needs no Nest and no
 * database. The CLI (gate-calibrate.ts) wires the real simulator, the CSV / golden loader and the
 * process exit.
 *
 * Exit codes:
 *   0  meaningful run, a leak-free bar was found
 *   1  could not run (bad arguments, unreadable / empty / mislabelled set)        — set by the CLI
 *   2  meaningful run, but NO leak-free bar exists on this set (or too few questions to choose)
 *   3  NOT MEANINGFUL: measured with stub / keyword-only embeddings or a degraded vector leg
 */

export interface CalibrateArgs {
  tenantId: number;
  agentId: number | null;
  file: string | null;
  from: number;
  to: number;
  step: number;
  json: string | null;
  delayMs: number;
}

/** `--key=value` and `--key value`, both. Unknown flags are an error: a typo must not be ignored. */
export function parseCalibrateArgs(argv: string[]): CalibrateArgs | { error: string } {
  const raw = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) return { error: `unexpected argument "${a}"` };
    const eq = a.indexOf('=');
    const key = (eq === -1 ? a : a.slice(0, eq)).slice(2);
    const value = eq === -1 ? argv[++i] : a.slice(eq + 1);
    if (value === undefined || value.startsWith('--')) return { error: `--${key} needs a value` };
    raw.set(key, value);
  }
  const known = new Set(['tenant', 'agent', 'file', 'from', 'to', 'step', 'json', 'delay-ms']);
  for (const k of raw.keys()) if (!known.has(k)) return { error: `unknown option --${k}` };

  const num = (key: string, fallback: number): number | { error: string } => {
    if (!raw.has(key)) return fallback;
    const n = Number(raw.get(key));
    return Number.isFinite(n) ? n : { error: `--${key} must be a number` };
  };
  const tenant = num('tenant', 1);
  const from = num('from', 0.45);
  const to = num('to', 0.95);
  const step = num('step', 0.05);
  const delay = num('delay-ms', 0);
  for (const v of [tenant, from, to, step, delay]) if (typeof v === 'object') return v;
  const agent = raw.has('agent') ? Number(raw.get('agent')) : null;
  if (agent != null && !Number.isInteger(agent)) return { error: '--agent must be an agent id' };
  if (!Number.isInteger(tenant as number) || (tenant as number) <= 0) return { error: '--tenant must be a tenant id' };
  if ((step as number) <= 0 || (to as number) < (from as number)) return { error: 'the sweep needs --from <= --to and --step > 0' };
  return {
    tenantId: tenant as number,
    agentId: agent,
    file: raw.get('file') ?? null,
    from: from as number,
    to: to as number,
    step: step as number,
    json: raw.get('json') ?? null,
    delayMs: Math.max(0, delay as number),
  };
}

export interface CalibrationContext {
  tenantId: number;
  agentId: number | null;
  source: 'csv' | 'golden';
  /** The agent's CURRENT guest policy — informative: calibration assumes login_guidance either way. */
  guestPolicy: string | null;
  voyageKeySet: boolean;
  qdrantEnabled: boolean;
  /** The bar in force (GUEST_GATE_CONFIDENCE) — evaluated next to the candidates. */
  currentThreshold: number;
}

export interface CalibrationRun {
  exitCode: 0 | 2 | 3;
  text: string;
  json: Record<string, unknown>;
  report: CalibrationReport;
  meaningfulness: Meaningfulness;
  samples: CalibrationSample[];
}

const QUESTION_JSON_MAX = 120;

/** A measurement as a sample: a guest question is the one the guest bar moves. */
export function sampleOf(id: number, item: LabelledItem, d: GateDecision): CalibrationSample {
  return {
    id,
    question: item.question,
    audience: item.audience,
    expect: item.expect,
    decision: d.decision,
    thresholdSensitive: item.audience === 'guest' && d.guestGated,
    grounded: d.grounded,
    topSimilarity: d.topSimilarity,
    vectorProvider: d.vectorProvider,
    degraded: d.degraded,
  };
}

export async function runCalibration(input: {
  items: LabelledItem[];
  /** One retrieval per question. For a guest, the guest policy must be ASSUMED login_guidance. */
  measure: (item: LabelledItem) => Promise<GateDecision>;
  args: Pick<CalibrateArgs, 'from' | 'to' | 'step' | 'delayMs'>;
  context: CalibrationContext;
  sleep?: (ms: number) => Promise<void>;
  /** Progress line per question (the CLI prints it; specs ignore it). */
  onProgress?: (done: number, total: number) => void;
}): Promise<CalibrationRun> {
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const samples: CalibrationSample[] = [];
  for (const [i, item] of input.items.entries()) {
    samples.push(sampleOf(i + 1, item, await input.measure(item)));
    input.onProgress?.(i + 1, input.items.length);
    // Sequential on purpose: the embedding provider's free tier is rate-limited.
    if (input.args.delayMs > 0 && i < input.items.length - 1) await sleep(input.args.delayMs);
  }

  const meaningfulness = assessMeaningfulness(samples);
  const report = buildCalibration(samples, {
    thresholds: thresholdGrid(input.args.from, input.args.to, input.args.step),
    currentThreshold: input.context.currentThreshold,
  });
  // A number measured on stub data must never be copied into an env file.
  const safeReport: CalibrationReport = meaningfulness.meaningful
    ? report
    : { ...report, recommendation: null, reason: 'NOT MEANINGFUL: measured without real embeddings' };

  const exitCode: 0 | 2 | 3 = !meaningfulness.meaningful
    ? NOT_MEANINGFUL_EXIT_CODE
    : report.recommendation?.leakFree
      ? 0
      : NO_SAFE_BAR_EXIT_CODE;

  const c = input.context;
  const header = [
    `gate:calibrate — tenant ${c.tenantId}, agent ${c.agentId ?? 'default'}, ${samples.length} labelled question(s) from ${c.source === 'csv' ? 'a CSV file' : "the tenant's golden questions"}`,
    `environment: VOYAGE_API_KEY ${c.voyageKeySet ? 'set' : 'NOT set'}, Qdrant ${c.qdrantEnabled ? 'enabled' : 'DISABLED'}; providers seen: ${
      Object.entries(meaningfulness.providers).map(([k, v]) => `${k} x${v}`).join(', ') || 'none'
    }`,
    `agent guest policy now: ${c.guestPolicy ?? 'unknown'} (calibration measures guests as if it were login_guidance); GUEST_GATE_CONFIDENCE in force: ${c.currentThreshold}`,
  ];
  const lines = [...header, ''];
  for (const w of meaningfulness.warnings) lines.push(`WARNING: ${w}`);
  if (meaningfulness.warnings.length) lines.push('');
  if (!meaningfulness.meaningful) lines.push(notMeaningfulBanner(meaningfulness), '', '(the table below is for illustration only — it is NOT calibration data)', '');
  lines.push(formatCalibration(safeReport));
  if (!meaningfulness.meaningful) lines.push('', notMeaningfulBanner(meaningfulness));

  const json: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    tenantId: c.tenantId,
    agentId: c.agentId,
    source: c.source,
    guestPolicy: c.guestPolicy,
    environment: { voyageKeySet: c.voyageKeySet, qdrantEnabled: c.qdrantEnabled },
    currentThreshold: c.currentThreshold,
    meaningful: meaningfulness.meaningful,
    notMeaningfulReasons: meaningfulness.reasons,
    warnings: meaningfulness.warnings,
    providers: meaningfulness.providers,
    exitCode,
    report: safeReport,
    samples: samples.map((s) => ({
      id: s.id,
      audience: s.audience,
      expect: s.expect,
      decision: s.decision,
      thresholdSensitive: s.thresholdSensitive,
      grounded: s.grounded,
      topSimilarity: s.topSimilarity,
      vectorProvider: s.vectorProvider,
      degraded: s.degraded,
      question: s.question.slice(0, QUESTION_JSON_MAX),
    })),
  };
  return { exitCode, text: lines.join('\n'), json, report: safeReport, meaningfulness, samples };
}
