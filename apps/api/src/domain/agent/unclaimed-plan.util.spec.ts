import {
  UNCLAIMED_DEFAULT_MAX_PAGES,
  UNCLAIMED_DEFAULT_MINUTES,
  UNCLAIMED_PAGES_HARD_CAP,
  planUnclaimedPage,
  unclaimedMaxPages,
  unclaimedMinutes,
} from './unclaimed-plan.util';
import type { UnclaimedPlanInput } from './unclaimed-plan.util';

/**
 * When does an unclaimed conversation get its next "UNCLAIMED" page? (PLN-261012 SG-63, SG-67.)
 * Time is injected, so these are the timing, de-dupe and cap rules with no clock in sight.
 */
const MIN = 60_000;
const T0 = Date.parse('2026-10-15T09:00:00.000Z');

function input(over: Partial<UnclaimedPlanInput> = {}): UnclaimedPlanInput {
  return {
    nowMs: T0,
    escalatedAtMs: T0,
    pagedAtMs: null,
    pages: 0,
    intervalMin: 5,
    maxPages: 3,
    strict: false,
    widenAfterMin: null,
    ...over,
  };
}

describe('planUnclaimedPage — timing', () => {
  it('is not due before the interval has passed since the conversation started waiting', () => {
    expect(planUnclaimedPage(input({ nowMs: T0 + 4 * MIN + 59_000 })).page).toBe(false);
  });

  it('is due exactly at the interval, and the boundary counts', () => {
    const plan = planUnclaimedPage(input({ nowMs: T0 + 5 * MIN }));
    expect(plan.page).toBe(true);
    expect(plan.attempt).toBe(1);
  });

  it('measures later pages from the PREVIOUS page, not from the start — never a re-page on every tick', () => {
    const paged = T0 + 5 * MIN;
    // A tick 30 s after a page, then 4 min later: still not due.
    expect(planUnclaimedPage(input({ nowMs: paged + 30_000, pagedAtMs: paged, pages: 1 })).page).toBe(false);
    expect(planUnclaimedPage(input({ nowMs: paged + 4 * MIN, pagedAtMs: paged, pages: 1 })).page).toBe(false);
    // Another full interval after the page: due again, as the second one.
    const again = planUnclaimedPage(input({ nowMs: paged + 5 * MIN, pagedAtMs: paged, pages: 1 }));
    expect(again.page).toBe(true);
    expect(again.attempt).toBe(2);
  });

  it('respects a different interval', () => {
    expect(planUnclaimedPage(input({ intervalMin: 10, nowMs: T0 + 9 * MIN })).page).toBe(false);
    expect(planUnclaimedPage(input({ intervalMin: 10, nowMs: T0 + 10 * MIN })).page).toBe(true);
  });
});

describe('planUnclaimedPage — cap', () => {
  it('stops after maxPages pages however long it keeps waiting', () => {
    const plan = planUnclaimedPage(
      input({ nowMs: T0 + 6 * 60 * MIN, pagedAtMs: T0 + 15 * MIN, pages: 3, maxPages: 3 }),
    );
    expect(plan.page).toBe(false);
    expect(plan.cap).toBe(3);
  });

  it('allows the last permitted page', () => {
    expect(planUnclaimedPage(input({ nowMs: T0 + 20 * MIN, pagedAtMs: T0 + 10 * MIN, pages: 2, maxPages: 3 })).page).toBe(true);
  });

  it('a full simulated wait pages exactly maxPages times at 5, 10 and 15 minutes', () => {
    let pages = 0;
    let pagedAt: number | null = null;
    const pagedAtMinutes: number[] = [];
    // A sweep tick every 30 s for two hours.
    for (let t = 0; t <= 120 * MIN; t += 30_000) {
      const plan = planUnclaimedPage(input({ nowMs: T0 + t, pages, pagedAtMs: pagedAt }));
      if (plan.page) {
        pages += 1;
        pagedAt = T0 + t;
        pagedAtMinutes.push(t / MIN);
      }
    }
    expect(pagedAtMinutes).toEqual([5, 10, 15]);
  });
});

describe('planUnclaimedPage — who sees the page', () => {
  it('outside strict mode every page is a plain broadcast (that is the widening)', () => {
    expect(planUnclaimedPage(input({ nowMs: T0 + 5 * MIN })).crossRegion).toBe(true);
  });

  it('strict mode keeps pages inside the region while no widening delay is set', () => {
    for (const k of [1, 2, 3]) {
      const plan = planUnclaimedPage(
        input({ strict: true, nowMs: T0 + 5 * k * MIN, pagedAtMs: k === 1 ? null : T0 + 5 * (k - 1) * MIN, pages: k - 1 }),
      );
      expect(plan.page).toBe(true);
      expect(plan.crossRegion).toBe(false);
    }
  });

  it('strict mode crosses only once the widening delay has passed, never before', () => {
    const base = { strict: true, widenAfterMin: 15 };
    // The pages at 5 and 10 minutes stay in the region...
    expect(planUnclaimedPage(input({ ...base, nowMs: T0 + 5 * MIN })).crossRegion).toBe(false);
    expect(planUnclaimedPage(input({ ...base, nowMs: T0 + 10 * MIN, pagedAtMs: T0 + 5 * MIN, pages: 1 })).crossRegion).toBe(false);
    // ...the one at 15 crosses (the boundary counts).
    const crossing = planUnclaimedPage(input({ ...base, nowMs: T0 + 15 * MIN, pagedAtMs: T0 + 10 * MIN, pages: 2 }));
    expect(crossing.page).toBe(true);
    expect(crossing.crossRegion).toBe(true);
  });

  it('a long widening delay still gets its crossing page: the cap is raised past it', () => {
    // widen after 40 min with a 5 min interval needs pages at 5..40: 8 of them, plus the crossing one.
    const plan = planUnclaimedPage(
      input({ strict: true, widenAfterMin: 40, maxPages: 3, nowMs: T0 + 40 * MIN, pagedAtMs: T0 + 35 * MIN, pages: 7 }),
    );
    expect(plan.cap).toBe(9);
    expect(plan.page).toBe(true);
    expect(plan.crossRegion).toBe(true);
  });

  it('without a widening delay the cap is the plain one even in strict mode', () => {
    expect(planUnclaimedPage(input({ strict: true, nowMs: T0 + 60 * MIN, pagedAtMs: T0 + 15 * MIN, pages: 3 })).page).toBe(false);
  });

  it('widenAfterMin 0 means never', () => {
    const plan = planUnclaimedPage(input({ strict: true, widenAfterMin: 0, nowMs: T0 + 90 * MIN, pagedAtMs: T0 + 85 * MIN, pages: 1 }));
    expect(plan.crossRegion).toBe(false);
  });
});

describe('unclaimed env settings', () => {
  const OLD = { ...process.env };
  afterEach(() => {
    process.env = { ...OLD };
  });

  it('defaults to 5 minutes and 3 pages when nothing is set', () => {
    delete process.env.ALERT_UNCLAIMED_MINUTES;
    delete process.env.ALERT_UNCLAIMED_MAX_PAGES;
    expect(unclaimedMinutes()).toBe(UNCLAIMED_DEFAULT_MINUTES);
    expect(unclaimedMaxPages()).toBe(UNCLAIMED_DEFAULT_MAX_PAGES);
  });

  it('a blank value means "not configured", never zero', () => {
    process.env.ALERT_UNCLAIMED_MINUTES = '';
    process.env.ALERT_UNCLAIMED_MAX_PAGES = '  ';
    expect(unclaimedMinutes()).toBe(5);
    expect(unclaimedMaxPages()).toBe(3);
  });

  it('0 minutes switches the sweep off', () => {
    process.env.ALERT_UNCLAIMED_MINUTES = '0';
    expect(unclaimedMinutes()).toBe(0);
  });

  it('reads a custom value, floors it, and bounds the page cap', () => {
    process.env.ALERT_UNCLAIMED_MINUTES = '12.9';
    process.env.ALERT_UNCLAIMED_MAX_PAGES = '999';
    expect(unclaimedMinutes()).toBe(12);
    expect(unclaimedMaxPages()).toBe(UNCLAIMED_PAGES_HARD_CAP);
    process.env.ALERT_UNCLAIMED_MAX_PAGES = '0';
    expect(unclaimedMaxPages()).toBe(UNCLAIMED_DEFAULT_MAX_PAGES);
    process.env.ALERT_UNCLAIMED_MINUTES = 'soon';
    expect(unclaimedMinutes()).toBe(5);
  });
});
