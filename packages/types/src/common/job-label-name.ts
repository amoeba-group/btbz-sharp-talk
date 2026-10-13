/**
 * Display names of the built-in job labels (PLN-261012 w3c, ops-manual finding 1).
 *
 * `job_labels.name` is one string per tenant. Until now a new tenant (and the seed) got a Korean
 * name ("상담", "영업관리"), so a Vietnamese console listed Korean role names and the operator had
 * no screen to change them. Two rules fix that without touching any existing row:
 *
 *  1. NEW tenants and the seed write the English-neutral names below.
 *  2. A name that is still one of the built-in defaults (the English one, or the Korean one older
 *     tenants carry) is a "default": the console shows it in the console language, from its own
 *     locale files. A name the operator typed is shown exactly as typed.
 *
 * So an untouched label follows the language of whoever is reading, a renamed one is the
 * tenant's own word, and "reset to default" is just writing the default name back.
 *
 * Pure and dependency-free: the API seeds with it, the console deep-imports this file (a value
 * import through the package root fails the browser build, see `language.ts`).
 */

/** The English-neutral default each built-in label is created with. */
export const DEFAULT_JOB_LABEL_NAME: Readonly<Record<string, string>> = {
  consult: 'Customer Support',
  accounting: 'Accounting',
  operations: 'Operations',
  sales_admin: 'Sales Admin',
};

/** What tenants created before this change were seeded with (Korean). Recognised, never written. */
const LEGACY_JOB_LABEL_NAME: Readonly<Record<string, string>> = {
  consult: '상담',
  accounting: '회계',
  operations: '운영',
  sales_admin: '영업관리',
};

function norm(name: string | null | undefined): string {
  return String(name ?? '').trim().toLowerCase();
}

/**
 * True when `name` is the built-in default of `code` (English or the legacy Korean one): the
 * console then shows the localized default instead. Any other value, including the default of a
 * DIFFERENT label, is a custom name.
 */
export function isDefaultJobLabelName(code: string, name: string | null | undefined): boolean {
  const n = norm(name);
  if (!n) return false;
  return n === norm(DEFAULT_JOB_LABEL_NAME[code]) || n === norm(LEGACY_JOB_LABEL_NAME[code]);
}

/** A label as the rename dialog sees it: `name` is what the console shows, `storedName` the server value. */
export interface RenamableLabel {
  id?: string | number;
  code: string;
  name: string;
  storedName?: string;
}

/** One PATCH the dialog has to send. */
export interface JobLabelRename {
  id: string | number;
  code: string;
  name: string;
}

/**
 * Which labels the "Role names" dialog must PATCH (w3c, ops-manual finding 1).
 *
 *  - A row the operator typed into is saved with the typed text when it differs from what the
 *    console shows now.
 *  - A row marked "use default" is saved with the English-neutral default - never with the
 *    localized text on screen, which would pin one language into the tenant's data. A label that
 *    already has a built-in name has nothing to reset and is skipped.
 *  - Rows without an id cannot be addressed and are skipped; untouched rows are never sent, so a
 *    label left alone keeps following the console language.
 * Blank typed text is not planned here: the dialog disables Save for it and the server refuses it.
 */
export function planJobLabelRenames(
  labels: readonly RenamableLabel[],
  draft: Readonly<Record<string, string>>,
  reset: ReadonlySet<string>,
): JobLabelRename[] {
  const out: JobLabelRename[] = [];
  for (const l of labels) {
    if (l.id == null) continue;
    if (reset.has(l.code)) {
      const target = DEFAULT_JOB_LABEL_NAME[l.code];
      if (target && !isDefaultJobLabelName(l.code, l.storedName ?? l.name)) {
        out.push({ id: l.id, code: l.code, name: target });
      }
      continue;
    }
    const typed = draft[l.code];
    if (typed === undefined) continue;
    const next = typed.trim();
    if (next && next !== l.name.trim()) out.push({ id: l.id, code: l.code, name: next });
  }
  return out;
}

/** True when any row of the draft is blank (Save must stay disabled: a role needs a name). */
export function hasBlankJobLabelName(
  labels: readonly RenamableLabel[],
  draft: Readonly<Record<string, string>>,
  reset: ReadonlySet<string>,
): boolean {
  return labels.some((l) => !reset.has(l.code) && draft[l.code] !== undefined && !draft[l.code].trim());
}
