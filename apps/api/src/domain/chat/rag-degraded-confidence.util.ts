import { envNumber } from '../../global/util/env-number.util';

/**
 * Confidence when the VECTOR leg should have run and did not (PLN-261012 SG-84, D-19).
 *
 * History. Hybrid retrieval scores a turn on the best dense similarity. When Voyage or Qdrant
 * failed there was no similarity, and FIX-260930 D2 made `RagService.confidence` return the
 * sentinel 0.2 — under the handoff bar — because the count formula it replaced scored six
 * full-text hits at 0.95: ivyusa's "What is your return policy?" was answered "I don't have that
 * information" with six unrelated products and nobody paged. That fix was right about the noise
 * and wrong about the blast radius: with the vector leg down, EVERY turn handed off, including
 * the ones FULLTEXT answered perfectly well.
 *
 * Rule implemented here. FULLTEXT noise is what must not be trusted, so trust is earned from
 * lexical evidence instead of a hit count: a turn may be answered from the keyword leg only when
 * at least one retrieved document actually contains most of the question's distinctive words in
 * its title/body. Even then the confidence is CAPPED (default 0.55) — above the chat handoff bar
 * (0.45) so the answer is delivered, far below a healthy similarity score so it never reads as a
 * high-confidence answer in the console or qualifies for the answer-reuse cache (which needs
 * 0.75). No documents, or no lexical evidence → the old sentinel, i.e. hand off.
 */

/**
 * The confidence the sentinel gives a turn the vector leg could not ground.
 *
 * ALSO what `groundingConfidence()` returns while the vector leg is down. The guest gate
 * (`ChatService`: `grounded < GUEST_GATE_CONFIDENCE`) and the out-of-scope override read that
 * method, and they must NOT be loosened by an outage: with the vector leg gone a signed-out visitor
 * is asked to sign in rather than answered from keyword guesses (fail-closed — the gate's whole
 * point). PLN-261012 wave 2 / s2a refactors the gate decision; this named constant is the one
 * place its "vector down" behaviour is defined, so that refactor can change it deliberately.
 */
export const VECTOR_DOWN_GROUNDING_CONFIDENCE = 0.2;

/** Upper bound of a confidence earned from the keyword leg alone. `RAG_DEGRADED_CONFIDENCE_CAP`. */
export function degradedConfidenceCap(): number {
  return envNumber('RAG_DEGRADED_CONFIDENCE_CAP', 0.55);
}

/**
 * Share of the question's distinctive words one document must contain. `RAG_DEGRADED_MIN_COVERAGE`.
 * Set the cap at or below the handoff bar (0.45) to switch the feature off and restore the old
 * "vector down → always hand off" behaviour.
 */
export function degradedMinCoverage(): number {
  return envNumber('RAG_DEGRADED_MIN_COVERAGE', 0.6);
}

/**
 * Words that appear in almost any question or document and so prove nothing when they match.
 * Deliberately short: a stopword list is a heuristic, and an over-aggressive one would throw
 * away the topic words a small knowledge base depends on.
 */
const STOPWORDS = new Set([
  // en
  'the', 'and', 'for', 'you', 'your', 'are', 'was', 'what', 'how', 'can', 'does', 'did', 'has', 'have',
  'with', 'from', 'this', 'that', 'there', 'when', 'where', 'which', 'who', 'why', 'will', 'would',
  'could', 'should', 'about', 'please', 'any', 'get', 'got', 'our', 'its', 'not', 'but', 'all',
  'is', 'do', 'to', 'of', 'in', 'on', 'at', 'be', 'my', 'me', 'we', 'it', 'an', 'or', 'if', 'as', 'by',
  // es
  'que', 'los', 'las', 'una', 'uno', 'por', 'con', 'para', 'como', 'cómo', 'del', 'mis', 'sus', 'puedo',
  'hay', 'qué', 'cuál', 'donde', 'dónde', 'cuando', 'cuándo',
  // vi
  'là', 'của', 'và', 'có', 'không', 'cho', 'tôi', 'bạn', 'như', 'thế', 'nào', 'gì', 'sao', 'được',
  'để', 'các', 'những', 'một', 'này', 'khi', 'thì', 'mà', 'với', 'từ', 'đã', 'sẽ', 'đang', 'xin',
  'vui', 'lòng', 'nhé', 'làm', 'cách', 'muốn', 'cần',
]);

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Most distinctive terms looked at — a pasted paragraph must not make coverage unreachable. */
const MAX_TERMS = 12;

/**
 * The question's distinctive words. Space-delimited scripts split on non-letters; a CJK run has
 * no spaces, so it is cut into overlapping bigrams (a coarse stand-in for word boundaries that
 * lets "환불정책이" still meet a document saying "환불 정책").
 */
export function distinctiveTerms(query: string): string[] {
  const out = new Set<string>();
  for (const raw of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (raw.length < 2) continue;
    if (CJK.test(raw) && raw.length > 2) {
      for (let i = 0; i < raw.length - 1; i++) out.add(raw.slice(i, i + 2));
    } else if (!STOPWORDS.has(raw)) {
      out.add(raw);
    }
  }
  return [...out].slice(0, MAX_TERMS);
}

export interface CoverageChunk {
  title?: string | null;
  category?: string | null;
  snippet?: string | null;
}

/** Share of `terms` found (substring, case-insensitive) in one document's title/category/body. */
export function lexicalCoverage(terms: string[], chunk: CoverageChunk): number {
  if (!terms.length) return 0;
  const hay = `${chunk.title ?? ''} ${chunk.category ?? ''} ${chunk.snippet ?? ''}`.toLowerCase();
  return terms.filter((t) => hay.includes(t)).length / terms.length;
}

export interface DegradedConfidence {
  confidence: number;
  /** Best coverage any document reached, 0..1 — for logs and the retrieval trace. */
  coverage: number;
  /** `fulltext_answer` = trusted the keyword leg; `withheld` = hand off. */
  result: 'fulltext_answer' | 'withheld';
}

/**
 * The confidence of a turn whose vector leg was unavailable. `queries` are the texts the
 * retrieval ran on (the current message and, for a follow-up, the context-enriched one, whose lines
 * are the earlier turns); the best coverage of any one line counts, because a follow-up like "and for my son?" has no topic words of its
 * own and borrows them from the conversation. Without `queries` there is no lexical evidence to
 * weigh, which is the strict (gate) behaviour: the sentinel.
 */
export function degradedFulltextConfidence(
  chunks: CoverageChunk[],
  queries: Array<string | undefined | null> = [],
): DegradedConfidence {
  const withheld = { confidence: VECTOR_DOWN_GROUNDING_CONFIDENCE, coverage: 0, result: 'withheld' as const };
  if (!chunks.length) return withheld;
  let coverage = 0;
  for (const q of queries) {
    // The context-enriched query is one line per earlier turn plus the current message
    // (`retrievalQuery`); each line is weighed ALONE, so a follow-up is not diluted by words that
    // belong to a different turn than the one the document answers.
    for (const line of (q ?? '').split(/\r?\n+/)) {
      const terms = line.trim() ? distinctiveTerms(line) : [];
      for (const c of chunks) coverage = Math.max(coverage, lexicalCoverage(terms, c));
    }
  }
  if (coverage < degradedMinCoverage()) return { ...withheld, coverage };
  return { confidence: degradedConfidenceCap(), coverage, result: 'fulltext_answer' };
}
