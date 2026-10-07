import { envNumber } from '../../global/util/env-number.util';

/**
 * How much of each knowledge document the model sees (PLN-261007-Go2Joy-FAQ-Accuracy R3).
 *
 * It was the first 800 characters, always. 131 of go2joy's 227 documents are
 * longer, and the answers lost exactly what sat past the cut: C1's
 * "Chưa thanh toán" starts at character 830, its phone-number tip at 1,092.
 * Now a document up to the budget goes whole (every FAQ entry fits), and a
 * longer one contributes the paragraphs that match the question.
 */
export const snippetChars = () => envNumber('RAG_SNIPPET_CHARS', 2000);
/** Cap on all snippets together, so six long documents cannot balloon the prompt. */
export const contextChars = () => envNumber('RAG_CONTEXT_CHARS', 9000);

const GAP = '\n…\n';

function terms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length > 1),
    ),
  ];
}

/**
 * The part of `content` worth showing for `query`, at most `budget` chars.
 * Whole when it fits. Otherwise: paragraphs (blank-line separated) scored by
 * how many query words they contain; the first paragraph (the question line /
 * heading) always stays, the best-scoring others fill the budget, and the
 * result keeps the document's own order with "…" where something was skipped.
 */
export function selectPassages(content: string, query: string, budget = snippetChars()): string {
  const text = content ?? '';
  if (text.length <= budget) return text;
  const paras = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paras.length <= 1) return text.slice(0, budget);

  const words = terms(query);
  const scored = paras.map((p, i) => {
    const low = p.toLowerCase();
    return { i, p, score: words.reduce((n, w) => n + (low.includes(w) ? 1 : 0), 0) };
  });

  const chosen = new Set<number>([0]);
  let used = Math.min(paras[0].length, budget);
  const rest = scored.slice(1).sort((a, b) => b.score - a.score || a.i - b.i);
  for (const s of rest) {
    if (s.score === 0 && chosen.size > 1) break;
    const cost = s.p.length + GAP.length;
    if (used + cost > budget) continue;
    chosen.add(s.i);
    used += cost;
  }

  let out = '';
  let prev = -1;
  for (const i of [...chosen].sort((a, b) => a - b)) {
    if (out) out += i === prev + 1 ? '\n\n' : GAP;
    out += paras[i];
    prev = i;
  }
  return out.slice(0, budget);
}

/**
 * Keep the total under `cap`, cutting from the last (lowest-ranked) chunk
 * backwards; a chunk left with nothing is dropped.
 */
export function capContext<T extends { snippet: string }>(chunks: T[], cap = contextChars()): T[] {
  let left = cap;
  const out: T[] = [];
  for (const c of chunks) {
    if (left <= 0) break;
    const snippet = c.snippet.length > left ? c.snippet.slice(0, left) : c.snippet;
    left -= snippet.length;
    out.push(snippet === c.snippet ? c : { ...c, snippet });
  }
  return out;
}
