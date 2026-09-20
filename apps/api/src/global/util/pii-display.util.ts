/**
 * PII masking for VALUES THAT LEAVE THE API TOWARD A CONSOLE SCREEN
 * (PLN-260920, PRV-002/PRV-005).
 *
 * Three masking utilities now exist and they are deliberately separate:
 * - `pii.util.ts` `maskPii` — log and audit lines (one shape, terse).
 * - `pii-scrub.util.ts` `scrubPii` — the copy of a message sent to an AI
 *   provider (regex passes over free text).
 * - this file — the structured customer identifiers rendered in the console.
 *
 * Do not merge them. Log masking may change without touching what an operator
 * sees on screen, and vice versa; a shared helper would couple two controls
 * that answer to different requirements.
 *
 * The rule here: an operator must be able to TELL TWO CUSTOMERS APART without
 * being handed their contact details. So a mask keeps the shape (first letter,
 * domain, last four digits) and drops everything that identifies or reaches
 * the person. Full values come back only through the audited reveal path.
 */

/** `hong.gildong@gmail.com` -> `ho***@gmail.com`; unparseable input -> `***`. */
export function maskEmail(value: string | null | undefined): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const at = raw.lastIndexOf('@');
  if (at <= 0 || at === raw.length - 1) return '***';
  const local = raw.slice(0, at);
  const domain = raw.slice(at + 1);
  // One-character local parts would be fully revealed by a 2-char head.
  const head = local.length > 2 ? local.slice(0, 2) : local.slice(0, 1);
  return `${head}***@${domain}`;
}

/**
 * `+82 10-1234-5678` -> `***-5678`. Keeps the last four digits, which is what
 * an operator reads back to a customer to confirm identity, and drops the rest
 * including the country/carrier prefix.
 */
export function maskPhone(value: string | null | undefined): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, '');
  if (digits.length < 4) return '***';
  return `***-${digits.slice(-4)}`;
}

/**
 * `홍길동` -> `홍*동`, `LISA ANDRE` -> `L**A A***E`, `Bo` -> `B*`.
 *
 * Masks each whitespace-separated token so given/family name structure stays
 * readable in a list. The first and last characters survive because an
 * operator scanning a queue needs to match a name a customer just said.
 */
export function maskName(value: string | null | undefined): string | null {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  return raw
    .split(/(\s+)/)
    .map((token) => {
      if (!token.trim()) return token; // preserve the original spacing
      const chars = [...token];
      if (chars.length === 1) return '*';
      if (chars.length === 2) return `${chars[0]}*`;
      return `${chars[0]}${'*'.repeat(chars.length - 2)}${chars[chars.length - 1]}`;
    })
    .join('');
}

/** A label built from whatever identifies the customer, already masked. */
export function maskIdentityLabel(
  name: string | null | undefined,
  email: string | null | undefined,
): string | null {
  return maskName(name) ?? maskEmail(email);
}
