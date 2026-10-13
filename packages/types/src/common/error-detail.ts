/**
 * Turn the API's error `details` (field → messages) into one line for a toast (PLN-261012 SG-65).
 *
 * The API refuses a malformed region table or hand-off setting with a generic code message and a
 * `details` map that says WHICH row is wrong ("categories[1].provinces entries are at most 80
 * characters"). The web client used to keep only the generic message, so the operator saw
 * "The region routing table is invalid" and had to guess the row.
 *
 * Pure and dependency-free for the same reason as routing-queue.ts.
 */

/** Most detail lines shown in one toast; the rest are summarised as "+N more". */
export const ERROR_DETAIL_SHOWN = 3;
/** A toast is not a log: one detail line is cut at this many characters. */
export const ERROR_DETAIL_LINE_MAX = 200;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;

export type ErrorDetails = Record<string, string[] | string> | null | undefined;

/**
 * "a; b; c (+2 more)" from a details map, or '' when there is nothing to say. Field names are not
 * repeated — the messages already name what is wrong — and a field repeated across keys is shown once.
 */
export function errorDetailText(details: ErrorDetails, shown: number = ERROR_DETAIL_SHOWN): string {
  if (!details || typeof details !== 'object') return '';
  const lines: string[] = [];
  for (const value of Object.values(details)) {
    for (const raw of Array.isArray(value) ? value : [value]) {
      if (typeof raw !== 'string') continue;
      const line = raw.replace(CONTROL_CHARS, ' ').trim().slice(0, ERROR_DETAIL_LINE_MAX);
      if (line && !lines.includes(line)) lines.push(line);
    }
  }
  if (lines.length === 0) return '';
  const head = lines.slice(0, Math.max(1, shown)).join('; ');
  const rest = lines.length - Math.max(1, shown);
  return rest > 0 ? `${head} (+${rest} more)` : head;
}
