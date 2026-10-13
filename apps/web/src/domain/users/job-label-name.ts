// Source deep-import: the package entry point is CJS and fails the browser build for values.
import { isDefaultJobLabelName } from '../../../../../packages/types/src/common/job-label-name';
import type { JobLabel } from './users.service';

/**
 * The name the console shows for each role label (w3c, ops-manual finding 1).
 *
 * `job_labels.name` is one string per tenant. While it is still a built-in default (the English
 * one new tenants get, or the Korean one older tenants were seeded with) the console shows the
 * default in ITS language, from the locale files; once an operator renames the label the typed
 * name is shown as typed. `storedName` keeps the server value, which is what the "Role names"
 * dialog edits and compares against.
 *
 * Pure so it can be reasoned about (and reused) without React: `defaultName` returns the localized
 * default for a code, or undefined when the locale has none (the stored name is then shown).
 */
export function localizeJobLabels(
  rows: readonly JobLabel[],
  defaultName: (code: string) => string | undefined,
): JobLabel[] {
  return rows.map((l) => {
    const stored = l.storedName ?? l.name;
    const localized = isDefaultJobLabelName(l.code, stored) ? defaultName(l.code)?.trim() : undefined;
    return { ...l, storedName: stored, name: localized || stored };
  });
}
