/**
 * Per-turn latency (PLN-261012 SG-53, NFR-001).
 *
 * The chat path answers in one round trip (there is no streaming: the
 * moderation gate must see the whole text before anything is shown), so the
 * number that matters is "time until the answer exists" and where it went.
 * Each persisted AI turn now carries these in its `retrieval_trace.latencyMs`,
 * as plain numbers — no endpoint, no metrics registry — so whatever builds
 * /metrics or a report later reads them from the rows (observability stream).
 *
 * Stages, in the order a turn runs them:
 *   classify  intent / needs-order-data label (one small model call)
 *   retrieve  hybrid search (Voyage embed + Qdrant + fulltext), incl. merging
 *   generate  the answering model call (also the no-knowledge reply)
 *   moderate  the mandatory outbound gate (FR-069)
 * A stage a turn did not run is `null`, never 0: a replayed (reused) answer has
 * no retrieve/generate, and "0 ms" would read as "instant" in a percentile.
 * `total` is wall-clock from the start of the turn, so it also holds the
 * unmeasured remainder (history load, PII scrub, DB writes).
 */

export interface TurnLatency {
  total: number;
  classify: number | null;
  retrieve: number | null;
  generate: number | null;
  moderate: number | null;
}

export type TurnStage = 'classify' | 'retrieve' | 'generate' | 'moderate';

/** Milliseconds since `startedAt`, never negative (a clock step must not poison a percentile). */
export function elapsedMs(startedAt: number, now: number = Date.now()): number {
  return Math.max(0, Math.round(now - startedAt));
}

export function buildTurnLatency(
  startedAt: number,
  stages: Partial<Record<TurnStage, number | null | undefined>>,
  now: number = Date.now(),
): TurnLatency {
  const stage = (s: TurnStage): number | null => {
    const v = stages[s];
    return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : null;
  };
  return {
    total: elapsedMs(startedAt, now),
    classify: stage('classify'),
    retrieve: stage('retrieve'),
    generate: stage('generate'),
    moderate: stage('moderate'),
  };
}

/**
 * Nearest-rank percentile (p in 0..100) of a list of milliseconds, or null when
 * there is nothing to rank. Nearest-rank on purpose: it always returns a value
 * that was actually observed, which is what an SLA statement ("95% of turns
 * answered within N ms") means, and it needs no interpolation convention.
 */
export function percentile(values: readonly number[], p: number): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const rank = Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

export interface LatencySummary {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export function summarizeLatency(values: readonly number[]): LatencySummary {
  const finite = values.filter((v) => Number.isFinite(v));
  return {
    count: finite.length,
    p50: percentile(finite, 50),
    p95: percentile(finite, 95),
    max: finite.length ? Math.max(...finite) : null,
  };
}

/** Pull one stage out of persisted traces (`retrieval_trace.latencyMs`), skipping rows without it. */
export function latenciesFromTraces(traces: readonly unknown[], stage: 'total' | TurnStage = 'total'): number[] {
  const out: number[] = [];
  for (const t of traces) {
    const v = (t as { latencyMs?: Record<string, unknown> } | null)?.latencyMs?.[stage];
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  }
  return out;
}
