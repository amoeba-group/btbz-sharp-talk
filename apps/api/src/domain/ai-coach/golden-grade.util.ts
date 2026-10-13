import { sanitizePartnerCtx } from '../partner-data/partner-golden.util';
import { sanitizeAudience, sanitizeExpectGate } from './golden-gate-grade.util';
import type { ExpectGate, GateAs } from '@sharptalk/types';
import type { GoldenPartnerCtx } from '../partner-data/partner-golden.util';

/**
 * Grading for regression answers (PLN-261007-Golden-Graded-Regression S2).
 *
 * The golden set reported differences only, on purpose: wording changes every
 * run. Facts do not — "19133261136016" is either in the D3 answer or it is
 * not — so a question that lists its expected facts gets a verdict, and one
 * that does not keeps the old diff-only behaviour.
 */

/**
 * Marks that must never reach a customer, checked on every graded question:
 * the masking/substitution defects fixed in REQ-261007 (▇▇▇ masks, raw PII
 * placeholders) are caught the moment they come back.
 */
export const DEFAULT_FORBIDDEN = ['▇▇▇', '[PHONE]', '[EMAIL]', '[ADDR]', '[CARD]', '[ORDER]'];

export const GRADE_MAX_ITEMS = 10;
export const GRADE_MAX_CHARS = 200;

export type Verdict = 'pass' | 'fail';

export interface GradeResult {
  verdict: Verdict | null;
  /** "missing: x" / "forbidden: y" — what failed, for the console. */
  failedChecks: string[];
}

/** Lowercase, drop markdown emphasis, collapse whitespace — "ngày **17**" matches "ngày 17". */
export function normalizeForGrade(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keep non-empty, de-duplicated, capped strings; anything else is dropped. */
export function sanitizeChecks(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out = [
    ...new Set(
      raw
        .filter((v): v is string => typeof v === 'string')
        .map((v) => v.trim().slice(0, GRADE_MAX_CHARS))
        .filter(Boolean),
    ),
  ].slice(0, GRADE_MAX_ITEMS);
  return out.length ? out : null;
}

/**
 * Verdict for one answer. No expected facts → null (not graded), but the
 * default forbidden marks still fail a graded question. An empty answer with
 * expected facts fails on every fact.
 */
export function gradeAnswer(
  answer: string,
  expected: string[] | null | undefined,
  forbidden: string[] | null | undefined,
): GradeResult {
  if (!expected?.length) return { verdict: null, failedChecks: [] };
  const text = normalizeForGrade(answer);
  const failed: string[] = [];
  for (const e of expected) {
    if (!text.includes(normalizeForGrade(e))) failed.push(`missing: ${e}`);
  }
  for (const f of [...DEFAULT_FORBIDDEN, ...(forbidden ?? [])]) {
    // Forbidden marks are matched raw as well: "[PHONE]" must not be softened.
    if (answer.includes(f) || text.includes(normalizeForGrade(f))) failed.push(`forbidden: ${f}`);
  }
  return { verdict: failed.length ? 'fail' : 'pass', failedChecks: failed };
}

/**
 * Optional 4th TSV column: the partner context the question runs under
 * (PLN-261012 SG-31), `hotel=1721|role=manager|mock=default` (mock optional).
 * Returns undefined when the column is absent or malformed, which leaves an
 * existing question's context untouched on a re-paste.
 */
export function parsePartnerColumn(cell: string | undefined): GoldenPartnerCtx | undefined {
  if (!cell?.trim()) return undefined;
  const kv = new Map(
    cell
      .split('|')
      .map((p) => p.split('=') as [string, string | undefined])
      .map(([k, v]) => [k.trim().toLowerCase(), (v ?? '').trim()] as const),
  );
  return (
    sanitizePartnerCtx({ hotelSn: kv.get('hotel'), role: kv.get('role'), mockSet: kv.get('mock') }) ?? undefined
  );
}

/**
 * One line of the bulk-import paste: `question<TAB>fact1|fact2<TAB>forbidden1|…<TAB>hotel=…|role=…|mock=…`.
 * Blank lines and lines starting with # are skipped.
 */
export function parseBulkLines(
  text: string,
): Array<{
  question: string;
  expected: string[] | null;
  forbidden: string[] | null;
  partnerCtx?: GoldenPartnerCtx;
  /** 5th / 6th columns (PLN-261012 SG-51); absent when the column is absent or blank (a re-paste keeps the stored value). */
  audience?: GateAs;
  expectGate?: ExpectGate;
}> {
  return (text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [q, e = '', f = '', partner, audience, expectGate] = l.split('\t');
      const split = (s: string) => sanitizeChecks(s.split('|'));
      const viewer = sanitizeAudience(audience);
      const expectation = sanitizeExpectGate(expectGate);
      return {
        question: q.trim(),
        expected: split(e),
        forbidden: split(f),
        partnerCtx: parsePartnerColumn(partner),
        ...(viewer ? { audience: viewer } : {}),
        ...(expectation ? { expectGate: expectation } : {}),
      };
    })
    .filter((r) => r.question.length >= 2);
}
