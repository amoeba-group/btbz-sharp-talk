import { localized } from './language';
import type { LocalizedText } from './language';

/**
 * Knowledge-base UI version stamping (PLN-261012 SG-20, REQ FR-010).
 *
 * A KB document can carry the version of the product UI it describes
 * (`kb_documents.ui_version`); the tenant names the version its users run today
 * (`tenant_ai_config.kb_version_policy.referenceVersion`). A document stamped
 * with a different version is "mismatched": the answer that cites it gets one
 * fixed caveat sentence, or the document is hidden from retrieval, depending on
 * the tenant's policy.
 *
 * Dependency-free on purpose — the API (retrieval, answer caveat, importer) and
 * the console (badge, filter, validation) must normalise and compare versions
 * with THE SAME function, and the browser bundles deep-import this source file
 * (a value import from the package entry fails the build, see language.ts).
 *
 * THE VERSION AXIS IS NOT DECIDED. The Go2Joy policy CSV cites Hotel Admin
 * "v23.3.0 / v23.4.0" while the requirements doc (FR-010 / R10) cites
 * "v0.4.1 – v0.12.0". Nothing here assumes either: a version is an opaque label
 * and the only operation is EQUALITY after normalisation. There is deliberately
 * no ordering ("newer than", "within one minor") — that would bake in a scheme.
 */

/** What to do with an answer that cites a document of a different version. */
export const KB_VERSION_MISMATCH = {
  /** Keep the document, append one fixed sentence to the answer. */
  CAVEAT: 'caveat',
  /** Exclude the document from retrieval altogether (NULL-version docs stay). */
  HIDE: 'hide',
  /** Stamping is informational only — answers and retrieval are untouched. */
  OFF: 'off',
} as const;
export type KbVersionMismatchPolicy = (typeof KB_VERSION_MISMATCH)[keyof typeof KB_VERSION_MISMATCH];

export const KB_VERSION_MISMATCH_VALUES: readonly KbVersionMismatchPolicy[] = [
  KB_VERSION_MISMATCH.CAVEAT,
  KB_VERSION_MISMATCH.HIDE,
  KB_VERSION_MISMATCH.OFF,
];

/** `tenant_ai_config.kb_version_policy` as stored and as the console edits it. */
export interface KbVersionPolicy {
  /** The version the tenant's users run today, as typed (display form). */
  referenceVersion: string;
  onMismatch: KbVersionMismatchPolicy;
  /** Per-language override of the built-in caveat sentence; blank = built-in. */
  notice?: LocalizedText;
}

/** `kb_documents.ui_version` is VARCHAR(16). */
export const KB_UI_VERSION_MAX_LEN = 16;
/** Longest per-language caveat override a tenant may store. */
export const KB_VERSION_NOTICE_MAX_LEN = 300;

/**
 * Characters a version label may hold: starts alphanumeric, then letters,
 * digits and `. _ + -` ("v23.3.0", "0.12.0", "2026-10", "R5", "v23.4.0-rc1").
 * No whitespace — a pasted "v23.3.0 " is trimmed first, but an inner space is
 * refused rather than silently kept, because it would never compare equal.
 */
export const KB_UI_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

/**
 * The comparison key of a version label, or null for "no version".
 *
 * Trim, lower-case, then drop ONE leading `v` that sits directly before a digit
 * ("V23.3.0" == "v23.3.0" == "23.3.0"). The `v`-before-a-digit rule keeps
 * labels such as "version2" intact. Blank / whitespace-only → null.
 *
 * `kbVersionNormSql` in the API builds the identical expression for MySQL —
 * change one, change the other (the spec runs both against the same matrix).
 */
export function normalizeKbVersion(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const t = String(raw).trim().toLowerCase();
  const key = /^v\d/.test(t) ? t.slice(1) : t;
  return key || null;
}

/** True when `raw` is an acceptable stored label (non-empty, ≤ 16 chars, allowed characters). */
export function isValidKbVersionLabel(raw: string | null | undefined): boolean {
  if (raw === null || raw === undefined) return false;
  const t = String(raw).trim();
  return (
    t.length > 0 &&
    t.length <= KB_UI_VERSION_MAX_LEN &&
    KB_UI_VERSION_PATTERN.test(t) &&
    normalizeKbVersion(t) !== null
  );
}

/** Why a policy form cannot be saved (the API refuses the same two cases with E5111). */
export type KbVersionPolicyProblem = 'reference_invalid' | 'reference_required';

/**
 * The two rules the console checks before it posts a policy and the API enforces
 * when it stores one: a typed reference must be a valid label, and a mode that
 * acts (caveat / hide) needs a reference to compare against — "caveat with no
 * reference" would silently do nothing, which is worse than refusing it.
 */
export function kbVersionPolicyProblem(p: {
  referenceVersion?: string | null;
  onMismatch?: string | null;
}): KbVersionPolicyProblem | null {
  const ref = (p.referenceVersion ?? '').trim();
  if (ref && !isValidKbVersionLabel(ref)) return 'reference_invalid';
  const mode = p.onMismatch || KB_VERSION_MISMATCH.CAVEAT;
  if (!ref && mode !== KB_VERSION_MISMATCH.OFF) return 'reference_required';
  return null;
}

/** Two labels are the same version when their comparison keys are equal. */
export function sameKbVersion(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = normalizeKbVersion(a);
  return ka !== null && ka === normalizeKbVersion(b);
}

export const KB_VERSION_STATE = {
  /** The document carries no version — never caveated, flagged in the console. */
  UNVERSIONED: 'unversioned',
  /** The document has a version but the tenant set no reference to compare with. */
  UNCHECKED: 'unchecked',
  MATCH: 'match',
  MISMATCH: 'mismatch',
} as const;
export type KbVersionState = (typeof KB_VERSION_STATE)[keyof typeof KB_VERSION_STATE];

/** Where a document stands against the tenant's reference version. */
export function kbVersionState(
  docVersion: string | null | undefined,
  referenceVersion: string | null | undefined,
): KbVersionState {
  const doc = normalizeKbVersion(docVersion);
  if (doc === null) return KB_VERSION_STATE.UNVERSIONED;
  const ref = normalizeKbVersion(referenceVersion);
  if (ref === null) return KB_VERSION_STATE.UNCHECKED;
  return doc === ref ? KB_VERSION_STATE.MATCH : KB_VERSION_STATE.MISMATCH;
}

/** How loudly the console flags a document's version. */
export type KbVersionSeverity = 'ok' | 'warn' | 'neutral';

/**
 * What the console shows for a document's version: its state, the label to print
 * (trimmed, as typed; null when there is none) and how loud to be about it.
 *
 * "Unversioned" is a warning only while the tenant uses the feature (it has a
 * reference version): for a tenant that never configured it every document is
 * unversioned, and flagging all of them would be noise, not information.
 */
export function kbVersionBadge(
  docVersion: string | null | undefined,
  referenceVersion: string | null | undefined,
): { state: KbVersionState; label: string | null; severity: KbVersionSeverity } {
  const state = kbVersionState(docVersion, referenceVersion);
  const label = normalizeKbVersion(docVersion) === null ? null : String(docVersion).trim();
  const inUse = normalizeKbVersion(referenceVersion) !== null;
  const severity: KbVersionSeverity =
    state === KB_VERSION_STATE.MISMATCH
      ? 'warn'
      : state === KB_VERSION_STATE.MATCH
        ? 'ok'
        : state === KB_VERSION_STATE.UNVERSIONED && inUse
          ? 'warn'
          : 'neutral';
  return { state, label, severity };
}

/**
 * The fixed caveat sentence, per session language (PLN-261012 SG-20).
 *
 * ONE sentence, no placeholders: a tenant that changes its reference version
 * must not leave older conversations holding a sentence that no longer matches
 * anything we could strip, and a model that copies it from the history is
 * removed by plain substring match (see `kbVersionCaveatVariants`). Draft copy —
 * the operator can replace it per language in the console.
 */
export const KB_VERSION_CAVEAT_DEFAULTS: Required<LocalizedText> = {
  EN: 'Note: this guide was written for a different version of the interface, so some screens or buttons may look different from what you see.',
  ES: 'Nota: esta guía fue redactada para otra versión de la interfaz, por lo que algunas pantallas o botones pueden verse distintos a lo que ves.',
  KO: '참고: 이 안내는 현재와 다른 버전의 화면을 기준으로 작성되어, 일부 화면이나 버튼이 실제와 다를 수 있습니다.',
  VI: 'Lưu ý: hướng dẫn này được viết cho một phiên bản giao diện khác, nên một số màn hình hoặc nút bấm có thể khác với những gì bạn đang thấy.',
  JA: 'ご注意：この案内は現在とは異なるバージョンの画面を基に作成されているため、一部の画面やボタンが実際と異なる場合があります。',
  ZH: '提示：本指南基于与当前不同版本的界面编写，部分页面或按钮可能与您看到的不同。',
};

/**
 * The caveat to append for a session language: the tenant's own wording for
 * exactly that language when it wrote one, else the built-in sentence (English
 * for a language the built-ins somehow lack). Never mixes in another language of
 * the tenant's notice — a Vietnamese caveat under an English answer is worse
 * than the built-in English one.
 */
export function kbVersionCaveatText(
  policy: Pick<KbVersionPolicy, 'notice'> | null | undefined,
  language: string | null | undefined,
): string {
  const key = String(language ?? '').toUpperCase() as keyof LocalizedText;
  const own = policy?.notice?.[key]?.trim();
  return own || localized(KB_VERSION_CAVEAT_DEFAULTS, language);
}

/**
 * Every caveat sentence that could be in a conversation: the six built-ins plus
 * the tenant's overrides. Used to strip a copy the model wrote itself (so the
 * sentence appears once) and to keep earlier caveats out of the history the
 * model reads (it copies what it sees — the contact footer taught us that).
 * Independent of the current reference version on purpose: the sentences carry
 * no version, so a reference change leaves nothing stale to chase.
 */
export function kbVersionCaveatVariants(
  policy: Pick<KbVersionPolicy, 'notice'> | null | undefined,
): string[] {
  const out = new Set<string>(Object.values(KB_VERSION_CAVEAT_DEFAULTS));
  for (const v of Object.values(policy?.notice ?? {})) {
    if (typeof v === 'string' && v.trim()) out.add(v.trim());
  }
  return [...out];
}
