import { HttpStatus } from '@nestjs/common';
import {
  KB_VERSION_MISMATCH,
  KB_VERSION_MISMATCH_VALUES,
  KB_VERSION_NOTICE_MAX_LEN,
  SESSION_LANGUAGE_CODES,
  isValidKbVersionLabel,
  normalizeKbVersion,
} from '@sharptalk/types';
import type { KbVersionMismatchPolicy, KbVersionPolicy, LocalizedText } from '@sharptalk/types';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/**
 * Server side of KB UI-version stamping (PLN-261012 SG-20). The comparison
 * rules live in `@sharptalk/types` (kb-version.ts) so the console shares them;
 * this file holds what only the API needs: validating the tenant policy before
 * it is stored, and the MySQL spelling of the same comparison.
 *
 * Standalone on purpose (no service imports): ai-config, rag and knowledge all
 * import it, and a constant exported from a service file has already crashed
 * boot through a circular import in this repo.
 */

function invalidPolicy(problem: string): never {
  throw new BusinessException(ERROR_CODE.KB_VERSION_POLICY_INVALID, HttpStatus.BAD_REQUEST, {
    kb_version_policy: [problem],
  });
}

/**
 * Validate and clean `tenant_ai_config.kb_version_policy` before it is stored.
 *
 * - `null` / `undefined`, or a blank reference with mode `off` and no notice
 *   → null: the tenant resets to "no stamping" and behaves byte-identically to
 *   one that never configured it.
 * - Accepts both `referenceVersion`/`onMismatch` and the snake_case spellings
 *   (the console sends the camelCase JSON it reads back, API clients may not).
 * - Rejects (400, E5111): a non-object, a mode outside caveat|hide|off, a
 *   reference that is not a valid version label, `caveat`/`hide` with no
 *   reference (nothing to compare against would silently do nothing), a notice
 *   that is not an object or whose text is over its limit.
 * - Cleans silently: trims, drops languages we do not serve and blank notices,
 *   forgets unknown fields. An absent mode defaults to `caveat`.
 */
export function sanitizeKbVersionPolicy(input: unknown): KbVersionPolicy | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'object' || Array.isArray(input)) invalidPolicy('kb_version_policy must be an object');
  const raw = input as Record<string, unknown>;
  const read = (camel: string, snake: string): unknown => raw[camel] ?? raw[snake];

  const rawRef = read('referenceVersion', 'reference_version');
  if (rawRef !== undefined && rawRef !== null && typeof rawRef !== 'string') {
    invalidPolicy('referenceVersion must be text');
  }
  const reference = typeof rawRef === 'string' ? rawRef.trim() : '';
  if (reference && !isValidKbVersionLabel(reference)) {
    invalidPolicy('referenceVersion must be 1-16 characters: letters, digits and . _ + -');
  }

  const rawMode = read('onMismatch', 'on_mismatch');
  if (rawMode !== undefined && rawMode !== null && rawMode !== '') {
    if (typeof rawMode !== 'string' || !(KB_VERSION_MISMATCH_VALUES as readonly string[]).includes(rawMode)) {
      invalidPolicy(`onMismatch must be one of ${KB_VERSION_MISMATCH_VALUES.join(', ')}`);
    }
  }
  const onMismatch: KbVersionMismatchPolicy =
    typeof rawMode === 'string' && rawMode ? (rawMode as KbVersionMismatchPolicy) : KB_VERSION_MISMATCH.CAVEAT;

  const rawNotice = read('notice', 'notice');
  if (rawNotice !== undefined && rawNotice !== null && (typeof rawNotice !== 'object' || Array.isArray(rawNotice))) {
    invalidPolicy('notice must be an object keyed by language');
  }
  const notice: LocalizedText = {};
  for (const lang of SESSION_LANGUAGE_CODES) {
    const v = (rawNotice as Record<string, unknown> | null | undefined)?.[lang];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') invalidPolicy(`notice.${lang} must be text`);
    const text = v.trim();
    if (!text) continue; // a blank box in the console, not an error
    if (text.length > KB_VERSION_NOTICE_MAX_LEN) {
      invalidPolicy(`notice.${lang} exceeds ${KB_VERSION_NOTICE_MAX_LEN} characters`);
    }
    notice[lang] = text;
  }
  const hasNotice = Object.keys(notice).length > 0;

  if (!reference) {
    if (onMismatch !== KB_VERSION_MISMATCH.OFF) {
      invalidPolicy(`referenceVersion is required when onMismatch is ${onMismatch}`);
    }
    // Off, no reference, no wording: nothing worth a row's worth of JSON.
    if (!hasNotice) return null;
  }
  return { referenceVersion: reference, onMismatch, ...(hasNotice ? { notice } : {}) };
}

/**
 * A document's `ui_version` as it will be stored: trimmed, blank → null
 * ("unversioned"), anything that is not a valid label → 400 E5110. The label is
 * kept as typed (display form); comparison always goes through the normaliser.
 */
export function parseUiVersionInput(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  if (!text) return null;
  if (!isValidKbVersionLabel(text)) {
    throw new BusinessException(ERROR_CODE.KB_UI_VERSION_INVALID, HttpStatus.BAD_REQUEST, {
      ui_version: ['1-16 characters: letters, digits and . _ + -'],
    });
  }
  return text;
}

/**
 * The reference version that actually acts on retrieval/answers, normalised, or
 * null when the policy is absent, `off`, or has no reference. One place so
 * "is stamping active for this tenant" cannot be answered two ways.
 */
export function activeKbReference(
  policy: Pick<KbVersionPolicy, 'referenceVersion' | 'onMismatch'> | null | undefined,
  mode?: KbVersionMismatchPolicy,
): string | null {
  if (!policy || policy.onMismatch === KB_VERSION_MISMATCH.OFF) return null;
  if (mode && policy.onMismatch !== mode) return null;
  return normalizeKbVersion(policy.referenceVersion);
}

/**
 * Did saving `after` over `before` change what answers may say or cite? The
 * reference version and the mode do; the caveat wording does not (it is
 * appended at delivery, so a replay picks the new wording up anyway). A change
 * retires the answer-reuse store: a stored answer was generated under the old
 * rule (`hide` kept other versions out of its context) and would otherwise be
 * replayed for up to the reuse TTL.
 */
export function kbPolicyChangedBehaviour(
  before: Pick<KbVersionPolicy, 'referenceVersion' | 'onMismatch'> | null | undefined,
  after: Pick<KbVersionPolicy, 'referenceVersion' | 'onMismatch'> | null | undefined,
): boolean {
  const key = (p: typeof before) =>
    !p || p.onMismatch === KB_VERSION_MISMATCH.OFF
      ? 'off'
      : `${p.onMismatch}|${normalizeKbVersion(p.referenceVersion) ?? ''}`;
  return key(before) !== key(after);
}

/**
 * `normalizeKbVersion` in SQL — the comparison key of a column, so the `hide`
 * predicate and the console's mismatch/unversioned filters agree with the
 * TypeScript (`packages/types/src/common/kb-version.ts`) on every stored value.
 * Trim, lower-case, drop ONE leading `v` that sits directly before a digit.
 * NULL stays NULL; a blank string becomes '' (callers treat both as unversioned).
 *
 * `column` is a trusted literal (`kb.ui_version`), never user input.
 */
export function kbVersionNormSql(column: string): string {
  const t = `LOWER(TRIM(${column}))`;
  return `(CASE WHEN ${t} REGEXP '^v[0-9]' THEN SUBSTRING(${t}, 2) ELSE ${t} END)`;
}

/** SQL: the document has no version (NULL or blank). */
export function kbUnversionedSql(column: string): string {
  return `(${column} IS NULL OR TRIM(${column}) = '')`;
}

/**
 * SQL for the `hide` policy: keep a document that is unversioned or whose version
 * equals the (already normalised) reference bound to `:param`. Documents without
 * a version are never hidden — "unversioned" is a console warning, not a verdict.
 */
export function kbVersionKeepSql(column: string, param: string): string {
  return `(${kbUnversionedSql(column)} OR ${kbVersionNormSql(column)} = :${param})`;
}

/** SQL for the console's "mismatch" filter: stamped, and not the (normalised) reference bound to `:param`. */
export function kbVersionMismatchSql(column: string, param: string): string {
  return `(NOT ${kbUnversionedSql(column)} AND ${kbVersionNormSql(column)} <> :${param})`;
}
