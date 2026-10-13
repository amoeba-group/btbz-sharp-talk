import {
  PILOT_ANALYTICS_DEFAULT_WINDOW_DAYS,
  PILOT_ANALYTICS_GROUPS,
  PILOT_ANALYTICS_MAX_WINDOW_DAYS,
  pilotPercent,
  pilotRangeDays,
  pilotRangeTooLong,
  pilotTopReasons,
} from './pilot-analytics';

describe('pilot analytics bounds (shared by the API and the console)', () => {
  it('pins the group vocabulary and the window bounds', () => {
    expect([...PILOT_ANALYTICS_GROUPS].sort()).toEqual(['day', 'hotel', 'role']);
    expect(PILOT_ANALYTICS_DEFAULT_WINDOW_DAYS).toBe(14);
    expect(PILOT_ANALYTICS_MAX_WINDOW_DAYS).toBe(92);
  });
});

describe('pilotRangeDays', () => {
  it('counts both bounds: a single day is 1, 1..14 October is 14', () => {
    expect(pilotRangeDays('2026-10-05', '2026-10-05')).toBe(1);
    expect(pilotRangeDays('2026-10-01', '2026-10-14')).toBe(14);
  });

  it('agrees with the server on the cap: exactly 92 days is allowed, 93 is not', () => {
    // 2026-07-01 .. 2026-09-30 inclusive is 92 days (the API test "exactly 92 days is allowed")
    expect(pilotRangeDays('2026-07-01', '2026-09-30')).toBe(PILOT_ANALYTICS_MAX_WINDOW_DAYS);
    expect(pilotRangeTooLong('2026-07-01', '2026-09-30')).toBe(false);
    expect(pilotRangeTooLong('2026-06-30', '2026-09-30')).toBe(true);
  });

  it('the console presets fit: "last 90 days" is allowed', () => {
    expect(pilotRangeTooLong('2026-07-16', '2026-10-13')).toBe(false); // 90 days inclusive
  });

  it('is DST-proof (a UTC calendar difference, not milliseconds of local time)', () => {
    expect(pilotRangeDays('2026-03-01', '2026-03-31')).toBe(31);
    expect(pilotRangeDays('2026-10-25', '2026-10-31')).toBe(7);
  });

  it.each([
    ['', '2026-10-01'],
    ['2026-10-01', ''],
    ['10/01/2026', '2026-10-05'],
    ['2026-13-40', '2026-10-05'],
    ['2026-10-05', '2026-10-01'], // inverted
  ])('is null for an unusable range (%j .. %j) — never a number to enable a request on', (from, to) => {
    expect(pilotRangeDays(from, to)).toBeNull();
    expect(pilotRangeTooLong(from, to)).toBe(false);
  });
});

describe('pilotPercent', () => {
  it.each([
    [0.7083, '71%'],
    [0, '0%'],
    [1, '100%'],
    [0.005, '1%'],
    [null, '—'],
    [undefined, '—'],
    [NaN, '—'],
  ])('%j -> %s', (rate, text) => {
    expect(pilotPercent(rate as number | null | undefined)).toBe(text);
  });
});

describe('pilotTopReasons', () => {
  it('largest first, ties by name, limited, zero counts dropped', () => {
    expect(pilotTopReasons({ b: 2, a: 2, c: 9, d: 0, e: 1 }, 3)).toEqual([
      { reason: 'c', count: 9 },
      { reason: 'a', count: 2 },
      { reason: 'b', count: 2 },
    ]);
  });

  it('tolerates a missing map and a non-positive limit', () => {
    expect(pilotTopReasons(null)).toEqual([]);
    expect(pilotTopReasons(undefined)).toEqual([]);
    expect(pilotTopReasons({ a: 1 }, 0)).toEqual([]);
    expect(pilotTopReasons({ a: 1 }, -2)).toEqual([]);
  });

  it('ignores NaN and Infinity counts instead of sorting on them', () => {
    expect(pilotTopReasons({ a: NaN, b: Infinity, c: 3 })).toEqual([{ reason: 'c', count: 3 }]);
  });
});
