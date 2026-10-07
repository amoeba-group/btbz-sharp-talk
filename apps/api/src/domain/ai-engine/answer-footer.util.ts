import { localized } from '@sharptalk/types';
import type { LocalizedText } from '@sharptalk/types';

/**
 * Tenant contact footer + protected values (PLN-261007-Go2Joy-FAQ-Accuracy R2/R4).
 *
 * The model used to write the contact block itself at the end of every answer:
 * it cost output tokens (two Vietnamese answers were cut off mid-footer), the
 * moderation e-mail rule masked the support address in 48 of 50 answers, and a
 * history-masking bug turned the northern hotline into "the number you
 * provided". Now the operator writes it once, the system appends it, and the
 * values in it are exempt from PII masking.
 *
 * Standalone on purpose: both ai-config and moderation import it, and a
 * constant exported from a service file has already crashed boot through a
 * circular import in this repo.
 */
export interface AnswerFooter {
  enabled: boolean;
  /** Footer per language code (EN/KO/VI/JA/ZH/ES). */
  text: LocalizedText;
  /** Extra values masking must never touch (e.g. a bank account), one per entry. */
  protected: string[];
}

export const FOOTER_MAX_CHARS = 500;
export const PROTECTED_MAX = 20;
export const PROTECTED_MAX_CHARS = 100;

/** Redis key for a tenant's protected values; ai-config deletes it on save. */
export const moderationProtectedCacheKey = (tenantId: number) => `mod:protected:${tenantId}`;

/** Keep only what the shape allows; anything else is dropped, never stored. */
export function sanitizeAnswerFooter(raw: unknown): AnswerFooter | null {
  if (raw == null || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const text: Record<string, string> = {};
  if (r.text && typeof r.text === 'object') {
    for (const [lang, v] of Object.entries(r.text as Record<string, unknown>)) {
      if (!/^[A-Z]{2}$/.test(lang.toUpperCase()) || typeof v !== 'string') continue;
      const t = v.trim().slice(0, FOOTER_MAX_CHARS);
      if (t) text[lang.toUpperCase()] = t;
    }
  }
  const protectedValues = Array.isArray(r.protected)
    ? [...new Set(
        (r.protected as unknown[])
          .filter((v): v is string => typeof v === 'string')
          .map((v) => v.trim().slice(0, PROTECTED_MAX_CHARS))
          .filter((v) => v.length >= 3),
      )].slice(0, PROTECTED_MAX)
    : [];
  return { enabled: r.enabled === true, text: text as LocalizedText, protected: protectedValues };
}

/**
 * The footer to append for a session language, or null. Missing language →
 * EN → the first one written, so a tenant that wrote only Vietnamese still
 * gets it on English sessions rather than nothing.
 */
export function footerFor(footer: AnswerFooter | null | undefined, lang: string): string | null {
  if (!footer?.enabled) return null;
  const entries = Object.entries(footer.text ?? {}).filter(([, v]) => typeof v === 'string' && v.trim());
  if (!entries.length) return null;
  const code = (lang || 'EN').toUpperCase();
  const own = (footer.text as Record<string, string>)[code];
  if (own?.trim()) return own.trim();
  const en = (footer.text as Record<string, string>).EN;
  if (en?.trim()) return en.trim();
  return localized(footer.text, code) || entries[0][1].trim();
}

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu;
/** Phone-ish runs: 8+ digits allowing spaces, dots, dashes, a leading +. */
const PHONE_RE = /\+?\d[\d .-]{6,}\d/g;

/**
 * Every value masking must leave alone for this tenant: the explicit list,
 * plus e-mails and phone/account numbers found in any footer text — the
 * operator published those, so they are not anyone's private data.
 * Longest first, so "077 789 2399" is shielded before a shorter overlap.
 */
export function protectedValuesOf(footer: AnswerFooter | null | undefined): string[] {
  if (!footer) return [];
  const out = new Set<string>(footer.protected ?? []);
  for (const t of Object.values(footer.text ?? {})) {
    if (typeof t !== 'string') continue;
    for (const m of t.matchAll(EMAIL_RE)) out.add(m[0]);
    for (const m of t.matchAll(PHONE_RE)) out.add(m[0].trim());
  }
  return [...out].filter((v) => v.length >= 3).sort((a, b) => b.length - a.length);
}

/**
 * Swap protected values for placeholders no moderation pattern can match, and
 * give back a function that restores them. Placeholders use private-use
 * characters and no `@`, so e-mail, phone and long-digit rules pass them by.
 */
export function shieldProtected(text: string, values: string[]): { text: string; restore: (s: string) => string } {
  if (!values.length || !text) return { text, restore: (s) => s };
  const found: string[] = [];
  let out = text;
  for (const v of values) {
    if (!out.includes(v)) continue;
    const token = `${found.length}`;
    found.push(v);
    out = out.split(v).join(token);
  }
  if (!found.length) return { text, restore: (s) => s };
  return {
    text: out,
    restore: (s: string) => s.replace(/(\d+)/g, (_, i: string) => found[Number(i)] ?? ''),
  };
}
