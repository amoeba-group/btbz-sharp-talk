/**
 * Transcript search helpers (PLN-261023 S1). Message bodies are stored in the
 * clear (PII is scrubbed only from the AI-bound copy), so a tenant-scoped
 * LIKE is enough at this volume — no FULLTEXT index.
 */

/** Shortest term worth a scan; one character matches nearly every row. */
export const SEARCH_TERM_MIN = 2;
/** Content search only looks this far back, so a scan stays bounded. */
export const SEARCH_WINDOW_DAYS = 180;
/** In-room matches returned at most (the console steps through them). */
export const SEARCH_MESSAGE_LIMIT = 200;

/** Trimmed term, or null when it is too short to search for. */
export function searchTerm(q: string | null | undefined): string | null {
  const term = String(q ?? '').trim();
  return term.length >= SEARCH_TERM_MIN ? term : null;
}

/** `%term%` with LIKE wildcards in the term itself taken literally (default `\` escape). */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * The part of `body` around the first match — `radius` characters each side,
 * with an ellipsis where it was cut. The column collation matches without
 * case or accents ("hoan" finds "hoàn"), so locating the term folds both the
 * same way, one character at a time to keep positions aligned.
 */
export function matchSnippet(body: string, term: string, radius = 40): string {
  const text = String(body ?? '').replace(/\s+/g, ' ');
  const at = fold(text).indexOf(fold(term));
  if (at < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + term.length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/** Lower-case, accents dropped, same length as the input (per UTF-16 unit). */
function fold(value: string): string {
  let out = '';
  for (const unit of value.split('')) {
    const base = unit.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    out += base.length === 1 ? base : unit;
  }
  return out;
}
