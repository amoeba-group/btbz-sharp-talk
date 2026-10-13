import { envNumber } from '../../global/util/env-number.util';

/** Minutes a conversation may wait unclaimed before the alert is raised again (0 = sweeper off). */
export const UNCLAIMED_MINUTES_ENV = 'ALERT_UNCLAIMED_MINUTES';
export const UNCLAIMED_DEFAULT_MINUTES = 5;
/** Re-pages per waiting spell before the sweeper stops (the queue chip and age still show it). */
export const UNCLAIMED_DEFAULT_MAX_PAGES = 3;
/** Hard ceiling on the page counter the sweeper query scans — bounds the candidate set. */
export const UNCLAIMED_PAGES_HARD_CAP = 20;

export const UNCLAIMED_MAX_PAGES_ENV = 'ALERT_UNCLAIMED_MAX_PAGES';

/** `ALERT_UNCLAIMED_MINUTES`: a number of minutes; 0 disables; blank/invalid = the default. */
export function unclaimedMinutes(): number {
  const n = envNumber(UNCLAIMED_MINUTES_ENV, UNCLAIMED_DEFAULT_MINUTES);
  return n > 0 ? Math.floor(n) : 0;
}

/** `ALERT_UNCLAIMED_MAX_PAGES`: re-pages per waiting spell; blank/invalid/below 1 = the default. */
export function unclaimedMaxPages(): number {
  const n = Math.floor(envNumber(UNCLAIMED_MAX_PAGES_ENV, UNCLAIMED_DEFAULT_MAX_PAGES));
  return n >= 1 ? Math.min(n, UNCLAIMED_PAGES_HARD_CAP) : UNCLAIMED_DEFAULT_MAX_PAGES;
}

export interface UnclaimedPlanInput {
  nowMs: number;
  /** When the conversation became WAITING. */
  escalatedAtMs: number;
  /** When the last UNCLAIMED page went out; null = none yet. */
  pagedAtMs: number | null;
  /** UNCLAIMED pages sent so far for this waiting spell. */
  pages: number;
  intervalMin: number;
  maxPages: number;
  /** The tenant's region mode is strict and the hotel's region is known. */
  strict: boolean;
  /** Strict only: minutes after which the alert widens to the other region; null/0 = never. */
  widenAfterMin: number | null;
}

export interface UnclaimedPlan {
  /** Send an UNCLAIMED page now. */
  page: boolean;
  /**
   * The page goes to everyone, not just the hotel's regional team. Always true outside
   * strict mode; in strict mode only once `widenAfterMin` has passed.
   */
  crossRegion: boolean;
  /** 1-based number of the page about to be sent (pages + 1). */
  attempt: number;
  /** The cap that applied: `maxPages`, raised in strict mode so the widening page can happen. */
  cap: number;
}

/**
 * When does a waiting, unclaimed conversation get its next "UNCLAIMED" page, and who sees
 * it? (PLN-261012 SG-63, SG-67). Pure and time-injected so the timing, the de-dupe and the
 * cap are unit-testable without a clock.
 *
 * - The first page is due `intervalMin` after the conversation became WAITING; every later
 *   one `intervalMin` after the previous page — never on every tick, which is the de-dupe.
 * - At most `cap` pages, so an unattended conversation does not page forever.
 * - Outside strict mode a page is a plain broadcast (that is the "widening": a targeted
 *   alert is visible only to its addressee). In strict mode pages stay inside the hotel's
 *   region until `widenAfterMin` has passed, and the first page after that crosses —
 *   `cap` is raised to `ceil(widenAfterMin / intervalMin) + 1` so a long widening delay is
 *   never starved of its crossing page by the plain cap.
 */
export function planUnclaimedPage(i: UnclaimedPlanInput): UnclaimedPlan {
  const intervalMs = Math.max(1, i.intervalMin) * 60_000;
  const widens = i.strict && !!i.widenAfterMin && i.widenAfterMin > 0;
  const cap = widens
    ? Math.max(i.maxPages, Math.ceil((i.widenAfterMin as number) / Math.max(1, i.intervalMin)) + 1)
    : i.maxPages;
  const crossRegion = !i.strict || (widens && i.nowMs - i.escalatedAtMs >= (i.widenAfterMin as number) * 60_000);
  const since = i.pagedAtMs ?? i.escalatedAtMs;
  const due = i.nowMs - since >= intervalMs;
  return { page: due && i.pages < cap, crossRegion, attempt: i.pages + 1, cap };
}
