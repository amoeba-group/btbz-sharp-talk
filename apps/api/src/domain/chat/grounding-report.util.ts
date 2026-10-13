import { TRACE_TOP_MATCHES } from '@sharptalk/types';
import type { RefusalTraceExtra } from '@sharptalk/types';

/**
 * What a retrieval found, for the gate decision, the trace and the simulator
 * (PLN-261012 SG-51). `RagService.groundingReport()` returns it; the confidence number the
 * guest gate and the handoff decision have always compared stays the same figure
 * (`groundingConfidence()` is a thin wrapper over it).
 */

/** One retrieved document, reduced to what a gate decision needs. */
export interface GroundingChunk {
  id: number;
  title: string | null;
  category: string | null;
  group: string | null;
  similarity: number | null;
}

/** The part of a report that is cheap to keep: what `RagAnswer.grounding` and traces carry. */
export interface GroundingSummary {
  /** Best dense similarity among the retrieved documents; null when the vector leg contributed none. */
  topSimilarity: number | null;
  /** Top-3 distinct category NAMES in rank order (operator content, never the visitor's words). */
  categories: string[];
  /** Top-3 document ids in rank order. */
  docIds: number[];
  /** What the embedding gateway reported: 'voyage', 'stub', or null (Qdrant off / failed). */
  vectorProvider: string | null;
  /** The vector leg SHOULD have run (real embeddings configured, Qdrant on) and did not. */
  degraded: boolean;
}

export interface GroundingReport extends GroundingSummary {
  /** The figure `groundingConfidence()` returns — same scale as the handoff decision. */
  confidence: number;
  /** Every retrieved document, in rank order (the simulator shows them with their tier). */
  chunks: GroundingChunk[];
  /** `embedding_fallback` / `qdrant_error` when degraded, else null. */
  degradedReason: string | null;
}

interface ChunkLike {
  id?: unknown;
  title?: string | null;
  category?: string | null;
  group?: string | null;
  similarity?: number | null;
}

/** The highest similarity among `chunks`, or null when none carries one. */
export function bestSimilarity(chunks: ReadonlyArray<ChunkLike>): number | null {
  return chunks.reduce<number | null>(
    (m, c) => (c.similarity != null && (m === null || c.similarity > m) ? c.similarity : m),
    null,
  );
}

export function summarizeGrounding(
  chunks: ReadonlyArray<ChunkLike>,
  vectorProvider: string | null,
  degraded: boolean,
): GroundingSummary {
  const categories: string[] = [];
  for (const c of chunks) {
    if (c.category && !categories.includes(c.category)) categories.push(c.category);
    if (categories.length >= TRACE_TOP_MATCHES) break;
  }
  return {
    topSimilarity: bestSimilarity(chunks),
    categories,
    docIds: chunks
      .slice(0, TRACE_TOP_MATCHES)
      .map((c) => Number(c.id))
      .filter((n) => Number.isInteger(n)),
    vectorProvider,
    degraded,
  };
}

export function buildGroundingReport(
  chunks: ReadonlyArray<ChunkLike>,
  vectorProvider: string | null,
  degradedReason: string | null,
  confidence: number,
): GroundingReport {
  return {
    confidence,
    chunks: chunks.map((c) => ({
      id: Number(c.id),
      title: c.title ?? null,
      category: c.category ?? null,
      group: c.group ?? null,
      similarity: c.similarity ?? null,
    })),
    degradedReason,
    ...summarizeGrounding(chunks, vectorProvider, degradedReason !== null),
  };
}

/**
 * The provider word a TRACE stores. Same convention as the AI turn's existing
 * `vectorProvider: 'degraded'` (SG-84): a vector leg that should have run and did not is
 * 'degraded', whatever the gateway fell back to; otherwise the gateway's own word.
 */
export function traceVectorProvider(summary: Pick<GroundingSummary, 'vectorProvider' | 'degraded'>): string {
  if (summary.degraded) return 'degraded';
  return summary.vectorProvider ?? 'none';
}

/** The measurement part of a trace (no decision word, no tier): what was found. */
export function groundingTraceExtras(summary: GroundingSummary): RefusalTraceExtra {
  return {
    ...(summary.topSimilarity != null ? { topSimilarity: summary.topSimilarity } : {}),
    vectorProvider: traceVectorProvider(summary),
    categories: summary.categories,
    docIds: summary.docIds,
  };
}
