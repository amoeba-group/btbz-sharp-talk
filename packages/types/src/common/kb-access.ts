import { AUDIENCE, AUDIENCE_RANK } from './audience';
import type { Audience } from './audience';

/**
 * Access tier of a KB category (PLN-261012 SG-10): `kb_categories.min_audience`
 * together with the older `guest_visible` flag.
 *
 * The two columns are written together by `setAccess()` and read by the API
 * (retrieval, answer reuse) and the console (the 3-state select, wireframe W1)
 * through THIS file, so they cannot drift apart:
 *
 *  - `guest_visible` stays THE single public flag. The guest gate's SQL reads it
 *    and nothing here changes that.
 *  - `min_audience` NULL = a row from before tiers existed: `guest_visible = 1`
 *    means public, otherwise partner. No backfill — NULL keeps meaning that.
 *  - Only `manager` restricts reading. `public` / `partner` just spell out what
 *    `guest_visible` already says.
 *
 * Dependency-light for the same reason as `audience.ts` (browser deep-import).
 */

/** The select's options, widest audience first. */
export const KB_ACCESS_OPTIONS: readonly Audience[] = [AUDIENCE.PUBLIC, AUDIENCE.PARTNER, AUDIENCE.MANAGER];

const KNOWN: ReadonlySet<string> = new Set(KB_ACCESS_OPTIONS);

/** A stored or submitted value as a tier, or `null` when it is not one (NULL included). */
export function normalizeAudience(value: unknown): Audience | null {
  return typeof value === 'string' && KNOWN.has(value) ? (value as Audience) : null;
}

/** What `kbAccessOf` reads off a category row (the entity's tinyint or the console's boolean). */
export interface KbAccessRow {
  guestVisible?: boolean | number | null;
  minAudience?: string | null;
}

/**
 * The tier a category reads as.
 *
 * `manager` wins over everything: retrieval excludes a manager category from every
 * non-manager caller even when `guest_visible` was left at 1 by a hand edit, so the
 * console must show the stricter of the two. An explicit `public` / `partner`
 * without the matching flag is not believed either — the flag is the public switch.
 */
export function kbAccessOf(row: KbAccessRow): Audience {
  if (normalizeAudience(row.minAudience) === AUDIENCE.MANAGER) return AUDIENCE.MANAGER;
  return row.guestVisible === true || row.guestVisible === 1 ? AUDIENCE.PUBLIC : AUDIENCE.PARTNER;
}

/** Both columns for a tier — what `setAccess()` writes. */
export function kbAccessColumns(access: Audience): { guestVisible: 0 | 1; minAudience: Audience } {
  return { guestVisible: access === AUDIENCE.PUBLIC ? 1 : 0, minAudience: access };
}

/** Does reading this tier require more than a signed-in partner? (The only restriction retrieval enforces.) */
export function kbAccessRestrictsRead(access: Audience): boolean {
  return AUDIENCE_RANK[access] >= AUDIENCE_RANK[AUDIENCE.MANAGER];
}

/** True when moving `from` -> `to` makes the category readable by more people. */
export function kbAccessWidens(from: Audience, to: Audience): boolean {
  return AUDIENCE_RANK[to] < AUDIENCE_RANK[from];
}

/**
 * The question the console asks before saving a change, as an i18n key — or `null`
 * when no confirmation is needed. Widening is what needs a second look: documents
 * already filed here become readable by people who could not read them a second ago
 * (a visitor who never signed in, or a receptionist). An empty category, narrowing
 * and an unchanged value never ask.
 */
export function kbAccessConfirmKey(
  from: Audience,
  to: Audience,
  documentCount: number,
): 'categoryAccessConfirmPublic' | 'categoryAccessConfirmPartner' | null {
  if (documentCount <= 0 || !kbAccessWidens(from, to)) return null;
  return to === AUDIENCE.PUBLIC ? 'categoryAccessConfirmPublic' : 'categoryAccessConfirmPartner';
}

/** The warning shown under a tier in the console, as an i18n key, or `null`. */
export function kbAccessWarningKey(access: Audience): 'categoryAccessManagerWarning' | null {
  return kbAccessRestrictsRead(access) ? 'categoryAccessManagerWarning' : null;
}
