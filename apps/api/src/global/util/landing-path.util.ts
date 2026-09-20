/**
 * Normalize the storefront URL a widget was shown on, for analytics only
 * (PLN-260920).
 *
 * Two rules, both deliberate:
 *
 *  1. **The query string is dropped.** A storefront URL routinely carries an
 *     email, an order token or a session id (`/orders?email=…&token=…`). We are
 *     counting pages, not recording where a shopper has been, so the safest
 *     version of this column is the one that cannot hold a secret.
 *  2. **The client's value is never trusted.** The widget sends whatever the
 *     page said; this runs server-side so a malformed or hostile string becomes
 *     NULL rather than a row of junk in an operator's report.
 *
 * Returns null when there is nothing usable — the caller stores NULL and the
 * console reads that as "not collected", which is honest either way.
 */
const MAX_LEN = 255;

export function normalizeLandingPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    // Only web pages: a `javascript:` or `data:` value is not a storefront page
    // and has no business being rendered back into the console.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    // Trailing slash folded away so `/products/x` and `/products/x/` are one row.
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const out = `${url.origin}${path}`;
    // Truncation would invent a path that was never visited; drop instead.
    return out.length <= MAX_LEN ? out : null;
  } catch {
    return null;
  }
}
