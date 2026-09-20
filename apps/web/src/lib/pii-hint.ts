/**
 * Console-side PII hint for text an operator is about to publish (PLN-260920 F-10).
 *
 * Knowledge documents are written from real conversations, get embedded for
 * retrieval, get answered back to other shoppers, and can be exported as a
 * spreadsheet — none of which is covered by the conversation retention window.
 * So a shopper's address pasted into one outlives the chat it came from.
 *
 * This is a HINT, not a filter: it warns and offers a one-click scrub, and the
 * operator stays in charge of the text. It deliberately errs toward silence —
 * a warning on every order number would train people to ignore it. The server
 * keeps its own scrubber for anything leaving toward an AI provider; this one
 * exists so the person writing the document sees the problem first.
 */

interface Pattern {
  kind: 'email' | 'phone' | 'card';
  re: RegExp;
  mask: string;
}

// Ordered: cards before phones, so a 16-digit run is not half-eaten.
const PATTERNS: Pattern[] = [
  { kind: 'email', re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, mask: '[email]' },
  { kind: 'card', re: /\b(?:\d[ -]?){13,19}\b/g, mask: '[card]' },
  // Formatted numbers only: +country, or separated groups totalling 9-15
  // digits. Bare digit runs (SKUs, tracking, order ids) are left alone.
  { kind: 'phone', re: /\+\d[\d\s-]{7,}\d|\b\d{2,4}[-.]\d{3,4}[-.]\d{4}\b/g, mask: '[phone]' },
];

export interface PiiHint {
  /** Kinds found, in the order they were looked for. Empty when the text is clean. */
  kinds: Array<Pattern['kind']>;
  /** The same text with every match replaced by a placeholder. */
  scrubbed: string;
}

export function findPii(text: string): PiiHint {
  const kinds: Array<Pattern['kind']> = [];
  let scrubbed = text ?? '';
  for (const p of PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags);
    if (re.test(scrubbed)) {
      kinds.push(p.kind);
      scrubbed = scrubbed.replace(new RegExp(p.re.source, p.re.flags), p.mask);
    }
  }
  return { kinds, scrubbed };
}
