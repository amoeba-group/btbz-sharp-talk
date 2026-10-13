/**
 * How a staff member is named on STAFF-FACING surfaces (w3c, ops-manual finding 13).
 *
 * `users.name` was never settable (the invite took none, no endpoint edited it), so the re-route
 * toast could not name the person who was paged, the internal thread note said "user #2" and the
 * comment author read "Unknown". The name is now settable, and until someone sets it this derives
 * a readable one from the e-mail local part ("hung.nguyen@go2joy.vn" -> "Hung Nguyen").
 *
 * PII: the derived name is computed at read time and only for the console (the staff already see
 * the e-mail in Users); it is never stored in a column of its own. Anything a CUSTOMER can read
 * (the widget's agent name) keeps using the real `users.name` only, so an address never leaks
 * into the customer's chat.
 */

/** Longest display name we pass around (the column is 255, a toast is not a place for that). */
const MAX_DISPLAY_NAME = 80;

/** What a staff user row must provide. */
export interface NamedUser {
  name?: string | null;
  email?: string | null;
}

/** The e-mail local part as words: separators become spaces, each word starts upper-case. */
export function nameFromEmail(email: string | null | undefined): string | null {
  const local = String(email ?? '').split('@')[0] ?? '';
  const words = local
    .replace(/[._+\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return null;
  const titled = words
    .split(' ')
    .map((w) => (w ? w.charAt(0).toLocaleUpperCase() + w.slice(1) : w))
    .join(' ');
  return titled.slice(0, MAX_DISPLAY_NAME);
}

/**
 * The staff-facing name: the real `name` when set, else one derived from the e-mail, else null
 * (the caller then falls back to its own wording, e.g. "user #N").
 */
export function displayNameOf(user: NamedUser | null | undefined): string | null {
  if (!user) return null;
  const real = String(user.name ?? '').trim();
  if (real) return real.slice(0, MAX_DISPLAY_NAME);
  return nameFromEmail(user.email);
}
