import {
  AnalyticsBreakdownService,
  emptyAccessRow,
  inZone,
  median,
  mergeRow,
  withRates,
} from './analytics-breakdown.service';

/**
 * The two calculations in these lenses that can be wrong without looking wrong.
 */
describe('median message count', () => {
  it('is not moved by one enormous room', () => {
    // KakaoTalk averages 131.7 messages per conversation on staging because a
    // few group rooms run to hundreds of turns. The mean describes none of the
    // conversations; the median describes the typical one, and showing both is
    // what makes the skew visible instead of quietly reported as normal.
    const sizes = [3, 4, 5, 6, 900];

    expect(median(sizes)).toBe(5);
  });

  it('averages the middle pair on an even count', () => {
    expect(median([2, 4, 6, 8])).toBe(5);
  });

  it('is zero for nothing rather than NaN', () => {
    expect(median([])).toBe(0);
  });
});

describe('hour-of-day in the tenant timezone', () => {
  it('puts a Seoul afternoon in the afternoon', () => {
    // 06:00 UTC is 15:00 in Seoul. Drawn in UTC the shop's busiest hour appears
    // at dawn — not a rounding error, the opposite of the answer.
    const at = new Date('2026-08-26T06:00:00Z');

    expect(inZone(at, 'Asia/Seoul').hour).toBe(15);
    expect(inZone(at, 'UTC').hour).toBe(6);
  });

  it('rolls the weekday over with the clock', () => {
    // Late Tuesday in UTC is already Wednesday in Seoul.
    const at = new Date('2026-08-25T23:30:00Z');

    expect(inZone(at, 'UTC').weekday).toBe(2);
    expect(inZone(at, 'Asia/Seoul').weekday).toBe(3);
  });

  it('reports midnight as hour 0, not 24', () => {
    // Intl's h23/h24 boundary: an hour cycle that returns 24 would write past
    // the end of the row and lose the busiest hour of a night shift.
    const at = new Date('2026-08-26T15:00:00Z');

    expect(inZone(at, 'Asia/Seoul').hour).toBe(0);
  });
});


/**
 * The 500 the unit tests could not see.
 *
 * `agents()` selected `c.session_id` — the column, not the property — so
 * TypeORM returned entities whose `sessionId` was undefined, `Number(undefined)`
 * bound as NaN, and MySQL answered "Unknown column 'NaN' in 'where clause'".
 * Every double in this suite returns whatever shape the test writes, so only
 * the real database could produce it; the guard below is what makes the failure
 * impossible to reach again.
 */
describe('session lookup for the agent lens', () => {
  const build = (captured: unknown[]) => {
    const qb: Record<string, unknown> = {};
    for (const m of ['select', 'where', 'andWhere']) {
      qb[m] = (_a: unknown, params?: Record<string, unknown>) => {
        if (params) captured.push(params);
        return qb;
      };
    }
    qb.getMany = async () => [];
    return new AnalyticsBreakdownService(
      {} as never,
      {} as never,
      { createQueryBuilder: () => qb } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  };

  it('never binds a NaN id', async () => {
    const captured: unknown[] = [];
    const svc = build(captured);

    await (
      svc as unknown as { sessionsOf: (c: unknown[]) => Promise<unknown> }
    ).sessionsOf([{ sessionId: 5 }, { sessionId: undefined }, { sessionId: null }]);

    const ids = (captured[0] as { ids: number[] })?.ids ?? [];
    expect(ids).toEqual([5]);
    expect(ids.every(Number.isFinite)).toBe(true);
  });

  it('does not query at all when nothing has a session', async () => {
    const captured: unknown[] = [];
    const svc = build(captured);

    const rows = await (
      svc as unknown as { sessionsOf: (c: unknown[]) => Promise<unknown[]> }
    ).sessionsOf([{ sessionId: undefined }]);

    expect(rows).toEqual([]);
    expect(captured).toHaveLength(0);
  });
});

describe('access funnel rates (PLN-260920)', () => {
  const row = (over: Partial<ReturnType<typeof emptyAccessRow>>) =>
    Object.assign(emptyAccessRow('k'), over);

  it('divides by sessions, not by raw opens', () => {
    // The trap: one shopper who opens and closes four times is ONE person who
    // engaged. Dividing conversations by `opens` would report 25% where the
    // truth is 100%, and an open-happy page could print rates above 100%.
    const r = withRates(row({ impressions: 10, opens: 4, openedSessions: 1, conversations: 1 }));

    expect(r.openRate).toBeCloseTo(0.1);
    expect(r.chatRate).toBe(1);
  });

  it('is zero rather than NaN when nothing happened', () => {
    const r = withRates(row({ impressions: 0, opens: 0, openedSessions: 0, conversations: 0 }));

    expect(r.openRate).toBe(0);
    expect(r.chatRate).toBe(0);
  });

  it('reports a page that is shown and never opened as exactly zero', () => {
    // The row the operator is meant to act on: plenty of impressions, no opens.
    const r = withRates(row({ impressions: 402, opens: 0, openedSessions: 0, conversations: 0 }));

    expect(r.openRate).toBe(0);
    expect(r.chatRate).toBe(0);
  });

  it('folds the long tail without losing any count', () => {
    const others = emptyAccessRow('others');
    mergeRow(others, row({ impressions: 5, opens: 3, openedSessions: 2, conversations: 1 }));
    mergeRow(others, row({ impressions: 7, opens: 1, openedSessions: 1, conversations: 0 }));

    expect(others).toMatchObject({ impressions: 12, opens: 4, openedSessions: 3, conversations: 1 });
    expect(withRates(others).chatRate).toBeCloseTo(1 / 3);
  });
});
