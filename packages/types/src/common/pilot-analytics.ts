/**
 * Pilot analytics — what the API and the console must agree on (PLN-261012 SG-52).
 *
 * `GET /analytics/pilot` groups the pilot's conversations by hotel, role or day over a bounded window.
 * The bounds and the group vocabulary live HERE so the server that enforces them (E5140 / E5141) and the
 * console that stops a request it knows will be refused cannot drift apart. The definitions of the
 * numbers themselves (AI-only resolved, hand-off, refusal …) live next to the SQL that computes them,
 * in apps/api/src/domain/analytics/analytics-pilot.util.ts.
 *
 * Browser bundles deep-import this file (a value import from the package root fails the CJS build).
 */

export const PILOT_ANALYTICS_GROUP = { HOTEL: 'hotel', ROLE: 'role', DAY: 'day' } as const;
export type PilotAnalyticsGroup = (typeof PILOT_ANALYTICS_GROUP)[keyof typeof PILOT_ANALYTICS_GROUP];
export const PILOT_ANALYTICS_GROUPS = Object.values(PILOT_ANALYTICS_GROUP) as PilotAnalyticsGroup[];

/** The pilot is two weeks long: a request with no dates reads the last 14 days. */
export const PILOT_ANALYTICS_DEFAULT_WINDOW_DAYS = 14;
/** The longest window one request may read; longer is refused, never silently clamped. */
export const PILOT_ANALYTICS_MAX_WINDOW_DAYS = 92;
/** Group key of conversations that carry no hotel / role stamp (legacy rows, guests). */
export const PILOT_ANALYTICS_UNKNOWN_KEY = 'unknown';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Days a console date range covers, bounds INCLUSIVE (`2026-10-01`..`2026-10-14` = 14). Mirrors how the
 * server reads the same two strings: a bare `to` date widens to the end of that day. Null when either
 * side is not a `YYYY-MM-DD` date, or the range is inverted.
 */
export function pilotRangeDays(from: string, to: string): number | null {
  if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to)) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Whether the server would refuse the range as longer than the cap (E5141). */
export function pilotRangeTooLong(from: string, to: string): boolean {
  const days = pilotRangeDays(from, to);
  return days != null && days > PILOT_ANALYTICS_MAX_WINDOW_DAYS;
}

/** A fraction as a whole-number percent; a dash when there is nothing to divide. */
export function pilotPercent(rate: number | null | undefined): string {
  return rate == null || !Number.isFinite(rate) ? '—' : `${Math.round(rate * 100)}%`;
}

/**
 * The reasons of a `reason -> count` map, largest first (ties by name so the order is stable between
 * renders), at most `limit` of them, zero counts dropped.
 */
export function pilotTopReasons(
  reasons: Record<string, number> | null | undefined,
  limit = 3,
): Array<{ reason: string; count: number }> {
  return Object.entries(reasons ?? {})
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, Math.max(0, limit));
}
