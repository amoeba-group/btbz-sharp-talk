import {
  QUEUE_WARN_AFTER_MIN,
  defaultRegionFilter,
  formatWait,
  isOverdue,
  regionOptions,
  teamChips,
  unclaimedSummary,
  waitingSince,
} from './routing-queue';
import type { QueueCountsView } from './routing-queue';
import { ERROR_DETAIL_LINE_MAX, errorDetailText } from './error-detail';
import { defaultHoursDraft, hoursConfigFrom, hoursDraftFrom } from './handoff-hours';

/**
 * The console's pure routing helpers (PLN-261012 SG-65/SG-66/SG-67): queue counters and waiting
 * time, the error detail line for a toast, and the business-hours draft round trip. They live here,
 * not in the React components, so they run under jest.
 */
const NOW = Date.parse('2026-10-15T09:00:00.000Z');
const ago = (sec: number) => new Date(NOW - sec * 1000).toISOString();

const COUNTS: QueueCountsView = {
  total: 14,
  teams: [
    { id: 'cs', count: 9 },
    { id: 'business', count: 5 },
    { id: null, count: 3 }, // guests / AI threads: in the total only
  ],
  regions: { north: 4, south: 8, none: 2, unmapped: 1 },
  unclaimed: 3,
  oldestUnclaimedAt: ago(7 * 60 + 42),
  myRegion: 'south',
};

describe('formatWait', () => {
  it('reads mm:ss under an hour — "07:42" as in the wireframe', () => {
    expect(formatWait(ago(7 * 60 + 42), NOW)).toBe('07:42');
    expect(formatWait(ago(5), NOW)).toBe('00:05');
    expect(formatWait(ago(59 * 60 + 59), NOW)).toBe('59:59');
  });

  it('switches to h:mm:ss from an hour', () => {
    expect(formatWait(ago(3600), NOW)).toBe('1:00:00');
    expect(formatWait(ago(3 * 3600 + 5 * 60 + 9), NOW)).toBe('3:05:09');
  });

  it('is empty for a missing or unreadable start, and never negative', () => {
    expect(formatWait(null, NOW)).toBe('');
    expect(formatWait(undefined, NOW)).toBe('');
    expect(formatWait('', NOW)).toBe('');
    expect(formatWait('not a date', NOW)).toBe('');
    expect(formatWait(new Date(NOW + 3000), NOW)).toBe('00:00');
  });

  it('accepts a Date as well as an ISO string', () => {
    expect(formatWait(new Date(NOW - 61_000), NOW)).toBe('01:01');
  });
});

describe('isOverdue / waitingSince', () => {
  it('warns from the unclaimed limit on, boundary included', () => {
    expect(isOverdue(ago(QUEUE_WARN_AFTER_MIN * 60 - 1), NOW)).toBe(false);
    expect(isOverdue(ago(QUEUE_WARN_AFTER_MIN * 60), NOW)).toBe(true);
    expect(isOverdue(ago(60), NOW, 1)).toBe(true);
    expect(isOverdue(null, NOW)).toBe(false);
  });

  it('shows an age only for a waiting row that has a start time', () => {
    expect(waitingSince({ status: 'waiting', escalatedAt: ago(30) })).toBe(ago(30));
    expect(waitingSince({ status: 'agent', escalatedAt: ago(30) })).toBeNull();
    expect(waitingSince({ status: 'ai_active', escalatedAt: ago(30) })).toBeNull();
    expect(waitingSince({ status: 'waiting', escalatedAt: null })).toBeNull();
    expect(waitingSince({ status: 'waiting', escalatedAt: 'garbage' })).toBeNull();
    expect(waitingSince({})).toBeNull();
  });
});

describe('teamChips', () => {
  it('"All teams 14 · CS 9 · Business 5": all first with the total, then each team, no-team rows only in the total', () => {
    expect(teamChips(COUNTS, 'all')).toEqual([
      { id: 'all', count: 14, active: true },
      { id: 'cs', count: 9, active: false },
      { id: 'business', count: 5, active: false },
    ]);
  });

  it('marks the active team', () => {
    expect(teamChips(COUNTS, 'business').map((c) => [c.id, c.active])).toEqual([
      ['all', false],
      ['cs', false],
      ['business', true],
    ]);
  });

  it('keeps the active team as a chip even when the queue holds none of it (the filter never points at nothing)', () => {
    expect(teamChips(COUNTS, 'accounting').at(-1)).toEqual({ id: 'accounting', count: 0, active: true });
  });

  it('is just "all" with nothing loaded yet', () => {
    expect(teamChips(undefined, 'all')).toEqual([{ id: 'all', count: 0, active: true }]);
  });
});

describe('regionOptions / defaultRegionFilter', () => {
  it('offers my region (with its count) to someone who has one, then the teams, no region and the unlisted ones', () => {
    expect(regionOptions(COUNTS, 'mine')).toEqual([
      { key: 'all', count: 14 },
      { key: 'mine', count: 8 },
      { key: 'north', count: 4 },
      { key: 'south', count: 8 },
      { key: 'none', count: 2 },
      { key: 'unmapped', count: 1 },
    ]);
  });

  it('has no "my region" for nationwide staff, and no unlisted-province choice when there is none', () => {
    const counts = { ...COUNTS, myRegion: null, regions: { ...COUNTS.regions, unmapped: 0 } };
    expect(regionOptions(counts, 'all').map((o) => o.key)).toEqual(['all', 'north', 'south', 'none']);
  });

  it('keeps the current choice listed even when it has nothing to show', () => {
    const empty = { ...COUNTS, myRegion: null, regions: { north: 0, south: 0, none: 0, unmapped: 0 } };
    expect(regionOptions(empty, 'unmapped').map((o) => o.key)).toContain('unmapped');
    expect(regionOptions({ ...empty }, 'mine').map((o) => o.key)).toContain('mine');
  });

  it('defaults to my region only when the user has one', () => {
    expect(defaultRegionFilter(COUNTS)).toBe('mine');
    expect(defaultRegionFilter({ ...COUNTS, myRegion: 'north' })).toBe('mine');
    expect(defaultRegionFilter({ ...COUNTS, myRegion: null })).toBe('all');
    expect(defaultRegionFilter({ ...COUNTS, myRegion: 'east' })).toBe('all');
    expect(defaultRegionFilter(undefined)).toBe('all');
  });
});

describe('unclaimedSummary', () => {
  it('counts the unclaimed and ages the oldest', () => {
    expect(unclaimedSummary(COUNTS, NOW)).toEqual({ count: 3, oldest: '07:42', overdue: true });
  });

  it('is null when nothing waits unclaimed, or nothing is loaded', () => {
    expect(unclaimedSummary({ ...COUNTS, unclaimed: 0 }, NOW)).toBeNull();
    expect(unclaimedSummary(undefined, NOW)).toBeNull();
  });

  it('is not overdue while the oldest is young', () => {
    expect(unclaimedSummary({ ...COUNTS, oldestUnclaimedAt: ago(40) }, NOW)).toMatchObject({ overdue: false, oldest: '00:40' });
  });
});

describe('errorDetailText', () => {
  it('joins the detail messages so the operator sees WHICH row is wrong', () => {
    expect(
      errorDetailText({ regionRouting: ['categories[1].provinces entries are at most 80 characters'] }),
    ).toBe('categories[1].provinces entries are at most 80 characters');
  });

  it('joins several, from several fields, without repeating one', () => {
    expect(errorDetailText({ a: ['x is wrong', 'y is wrong'], b: ['x is wrong', 'z is wrong'] })).toBe('x is wrong; y is wrong; z is wrong');
  });

  it('caps the lines shown and says how many were left out', () => {
    expect(errorDetailText({ a: ['1', '2', '3', '4', '5'] })).toBe('1; 2; 3 (+2 more)');
    expect(errorDetailText({ a: ['1', '2', '3', '4', '5'] }, 2)).toBe('1; 2 (+3 more)');
  });

  it('accepts a bare string value too', () => {
    expect(errorDetailText({ _: 'one thing' })).toBe('one thing');
  });

  it('is empty for no details', () => {
    expect(errorDetailText(undefined)).toBe('');
    expect(errorDetailText(null)).toBe('');
    expect(errorDetailText({})).toBe('');
    expect(errorDetailText({ a: [] })).toBe('');
    expect(errorDetailText({ a: ['  ', ''] })).toBe('');
  });

  it('keeps a hostile detail to one bounded line', () => {
    const out = errorDetailText({ a: [`line1\nline2\u0007${'x'.repeat(500)}`] });
    expect(out).not.toMatch(/[\n\u0007]/);
    expect(out.length).toBeLessThanOrEqual(ERROR_DETAIL_LINE_MAX);
  });
});

describe('business-hours draft', () => {
  const stored = { timezone: 'Asia/Ho_Chi_Minh', days: [1, 2, 3], start: '08:30', end: '17:30', breaks: [{ start: '12:00', end: '13:30' }] };

  it('round-trips stored hours with a break', () => {
    expect(hoursConfigFrom(hoursDraftFrom(stored))).toEqual(stored);
  });

  it('round-trips hours with no break, writing an empty list so a removed break is really removed', () => {
    const noBreak = { ...stored, breaks: [] };
    expect(hoursConfigFrom(hoursDraftFrom(noBreak))).toEqual(noBreak);
    // Hours stored with no `breaks` key at all come back with an explicit empty list.
    const { breaks: _drop, ...bare } = stored;
    expect(hoursConfigFrom(hoursDraftFrom(bare))?.breaks).toEqual([]);
  });

  it('nothing stored is "off" with the defaults, and off writes nothing (the team follows the shared hours)', () => {
    const draft = hoursDraftFrom(undefined, 'Asia/Seoul');
    expect(draft).toEqual({ ...defaultHoursDraft('Asia/Seoul'), on: false });
    expect(hoursConfigFrom(draft)).toBeUndefined();
    expect(hoursDraftFrom(null).on).toBe(false);
  });

  it('switching on and editing gives a usable config from the defaults', () => {
    const on = { ...defaultHoursDraft('Asia/Ho_Chi_Minh'), on: true, end: '20:00' };
    expect(hoursConfigFrom(on)).toEqual({ timezone: 'Asia/Ho_Chi_Minh', days: [1, 2, 3, 4, 5], start: '09:00', end: '20:00', breaks: [] });
  });

  it('keeps a stored zone and fills only what is blank', () => {
    expect(hoursDraftFrom({ ...stored, timezone: '', start: '' }, 'UTC')).toMatchObject({ timezone: 'UTC', start: '09:00', end: '17:30' });
  });
});
