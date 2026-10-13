import { BusinessException } from '../../global/exception/business.exception';
import { AnalyticsPilotService } from './analytics-pilot.service';
import { AnalyticsPilotMapper } from './analytics-pilot.mapper';
import {
  PILOT_EXPORT_MAX_ROWS,
  PILOT_MAX_CONVERSATIONS,
  PILOT_MAX_ROWS,
  PILOT_MAX_WINDOW_DAYS,
  emptyMessageStats,
  emptyModeration,
  emptyPartner,
} from './analytics-pilot.util';
import type {
  ConversationRow,
  LatencySample,
  MessageStats,
  ModerationStat,
  PartnerStat,
  ReasonStat,
} from './analytics-pilot.util';
import { CSV_BOM, PILOT_CSV_COLUMNS } from './analytics-pilot-csv.util';
import type { TranscriptMessage } from './analytics-pilot-csv.util';
import { row } from './testing/pilot-fixtures';

const NOW = new Date('2026-10-13T10:00:00Z');
const TENANT = 7;

/** In-memory stand-in for the SQL layer: the service's orchestration is what is under test here. */
function build(opts: {
  rows?: ConversationRow[];
  messages?: Record<number, Partial<MessageStats>>;
  reasons?: Record<number, ReasonStat[]>;
  moderation?: Record<number, Partial<ModerationStat>>;
  partner?: Record<number, Partial<PartnerStat>>;
  latencies?: Record<number, LatencySample[]>;
  alerts?: Record<number, string>;
  transcripts?: Record<number, TranscriptMessage[]>;
  activeHotels?: string[];
  listed?: string[];
  pilotEnabled?: boolean;
  timezone?: string | null;
} = {}) {
  const rows = opts.rows ?? [];
  const conversations = jest.fn(async (_t: number, _scope: unknown, limit: number) => rows.slice(0, limit));
  const messageStats = jest.fn(async (ids: number[]) =>
    new Map(ids.map((id) => [id, { ...emptyMessageStats(), ...opts.messages?.[id] }])),
  );
  const reasons = jest.fn(async (ids: number[]) => new Map(ids.filter((id) => opts.reasons?.[id]).map((id) => [id, opts.reasons![id]])));
  const latencies = jest.fn(async (ids: number[]) => new Map(ids.filter((id) => opts.latencies?.[id]).map((id) => [id, opts.latencies![id]])));
  const moderation = jest.fn(async (_t: number, ids: number[]) =>
    new Map(ids.filter((id) => opts.moderation?.[id]).map((id) => [id, { ...emptyModeration(), ...opts.moderation![id] }])),
  );
  const partner = jest.fn(async (_t: number, ids: number[]) =>
    new Map(ids.filter((id) => opts.partner?.[id]).map((id) => [id, { ...emptyPartner(), ...opts.partner![id] }])),
  );
  const alertReasons = jest.fn(async (_t: number, ids: number[]) =>
    new Map(ids.filter((id) => opts.alerts?.[id]).map((id) => [id, opts.alerts![id]])),
  );
  const transcripts = jest.fn(async (ids: number[]) =>
    new Map(ids.filter((id) => opts.transcripts?.[id]).map((id) => [id, opts.transcripts![id]])),
  );
  const activeHotels = jest.fn(async () => opts.activeHotels ?? []);
  const queries = { conversations, messageStats, reasons, latencies, moderation, partner, alertReasons, transcripts, activeHotels };

  const tenantRepo = {
    findOne: jest.fn(async () => ({
      id: TENANT,
      timezone: opts.timezone === undefined ? null : opts.timezone,
      pilotAccess: opts.pilotEnabled ? { enabled: true } : null,
    })),
  };
  const hotelRepo = { find: jest.fn(async () => (opts.listed ?? []).map((hotelSn) => ({ hotelSn }))) };
  const svc = new AnalyticsPilotService(queries as never, tenantRepo as never, hotelRepo as never);
  return { svc, queries, tenantRepo, hotelRepo };
}

const codeOf = async (p: Promise<unknown>): Promise<string | undefined> => {
  try {
    await p;
    return undefined;
  } catch (e) {
    return (e as BusinessException).errorCode;
  }
};

describe('AnalyticsPilotService.report — grouping and totals', () => {
  const rows = [
    row({ id: 1, hotelSn: '1721', actorRole: 'manager' }),
    row({ id: 2, hotelSn: '1721', actorRole: 'receptionist', escalated: true }),
    row({ id: 3, hotelSn: '1721', actorRole: 'receptionist' }),
    row({ id: 4, hotelSn: '2204', actorRole: 'manager' }),
    row({ id: 5, hotelSn: null, actorRole: null }), // legacy / guest: no stamps
  ];
  const messages = { 1: { answers: 2 }, 2: { answers: 1, agents: 1 }, 3: {}, 4: { answers: 1 }, 5: { answers: 1 } };
  const reasons = {
    2: [{ reason: 'low_confidence', turns: 1, firstId: 9 }],
    3: [{ reason: 'guest_gate', turns: 2, firstId: 3 }],
  };

  it('by hotel: one row per stamp plus an "unknown" row for legacy conversations; totals add up', async () => {
    const { svc } = build({ rows, messages, reasons });
    const r = await svc.report(TENANT, { group: 'hotel' }, NOW);

    const byKey = Object.fromEntries(r.rows.map((x) => [x.key, x]));
    expect(Object.keys(byKey).sort()).toEqual(['1721', '2204', 'unknown']);
    expect(byKey['1721']).toMatchObject({ conversations: 3, aiOnlyResolved: 1, handedOff: 1, refused: 1, guestGatePrompts: 2 });
    expect(byKey['1721'].handoffReasons).toEqual({ low_confidence: 1 });
    expect(byKey['unknown']).toMatchObject({ unknown: true, conversations: 1, aiOnlyResolved: 1 });
    expect(r.totals).toMatchObject({ conversations: 5, aiOnlyResolved: 3, handedOff: 1, refused: 1, noAnswer: 0 });
    // the partition holds for every row and for the total
    for (const x of [...r.rows, r.totals]) {
      expect(x.aiOnlyResolved + x.handedOff + x.refused + x.noAnswer).toBe(x.conversations);
    }
    // rows are ordered by volume
    expect(r.rows.map((x) => x.key)).toEqual(['1721', '2204', 'unknown']);
  });

  it('by role: receptionist vs manager vs unknown', async () => {
    const { svc } = build({ rows, messages, reasons });
    const r = await svc.report(TENANT, { group: 'role' }, NOW);
    const byKey = Object.fromEntries(r.rows.map((x) => [x.key, x.conversations]));
    expect(byKey).toEqual({ receptionist: 2, manager: 2, unknown: 1 });
  });

  it('group defaults to hotel and is case-insensitive', async () => {
    const { svc } = build({ rows });
    expect((await svc.report(TENANT, {}, NOW)).group).toBe('hotel');
    expect((await svc.report(TENANT, { group: ' ROLE ' }, NOW)).group).toBe('role');
  });

  it('by day: drawn in the tenant timezone, chronological', async () => {
    const dayRows = [
      row({ id: 1, createdAt: new Date('2026-10-12T20:00:00Z') }), // 03:00 on the 13th in Ho Chi Minh
      row({ id: 2, createdAt: new Date('2026-10-13T02:00:00Z') }), // 09:00 on the 13th
      row({ id: 3, createdAt: new Date('2026-10-11T08:00:00Z') }), // the 11th
    ];
    const hcm = await build({ rows: dayRows, timezone: 'Asia/Ho_Chi_Minh' }).svc.report(TENANT, { group: 'day' }, NOW);
    expect(hcm.timezone).toBe('Asia/Ho_Chi_Minh');
    expect(hcm.rows.map((x) => [x.key, x.conversations])).toEqual([['2026-10-11', 1], ['2026-10-13', 2]]);

    const utc = await build({ rows: dayRows, timezone: null }).svc.report(TENANT, { group: 'day' }, NOW);
    expect(utc.timezone).toBe('UTC');
    expect(utc.rows.map((x) => [x.key, x.conversations])).toEqual([['2026-10-11', 1], ['2026-10-12', 1], ['2026-10-13', 1]]);
  });

  it('a tenant timezone that Intl does not know does not take the report down', async () => {
    const r = await build({ rows, timezone: 'Mars/Olympus' }).svc.report(TENANT, { group: 'day' }, NOW);
    expect(r.timezone).toBe('UTC');
  });

  it('an empty window answers with empty rows and zero totals, not an error', async () => {
    const r = await build({ rows: [] }).svc.report(TENANT, {}, NOW);
    expect(r.rows).toEqual([]);
    expect(r.totals.conversations).toBe(0);
    expect(r.totals.aiOnlyResolvedRate).toBeNull();
    expect(r.truncated).toBe(false);
  });

  it('NULL / missing facts for a conversation (legacy rows with no message stats at all) never crash the report', async () => {
    // messageStats / reasons / moderation / partner return nothing for these ids.
    const { svc } = build({ rows: [row({ id: 1 }), row({ id: 2, hotelSn: null })] });
    const r = await svc.report(TENANT, {}, NOW);
    expect(r.totals).toMatchObject({ conversations: 2, noAnswer: 2, answers: 0, avgConfidence: null });
  });

  it('moderation, partner, CSAT and latency from their own queries land on the right group', async () => {
    const rs = [
      row({ id: 1, hotelSn: 'A', csatRating: 5 }),
      row({ id: 2, hotelSn: 'B', csatRating: 3 }),
    ];
    const { svc } = build({
      rows: rs,
      moderation: { 1: { blocked: 1, edited: 2 } },
      partner: { 2: { lookups: 2, ok: 1, denied: 1, topics: { rates: 2 } } },
      latencies: { 1: [{ total: 1000, classify: 100, retrieve: 200, generate: 600, moderate: 50 }] },
    });
    const r = await svc.report(TENANT, {}, NOW);
    const a = r.rows.find((x) => x.key === 'A')!;
    const b = r.rows.find((x) => x.key === 'B')!;
    expect(a.moderation).toEqual({ blocked: 1, edited: 2 });
    expect(b.moderation).toEqual({ blocked: 0, edited: 0 });
    expect(b.partner).toMatchObject({ lookups: 2, ok: 1, denied: 1, topics: { rates: 2 } });
    expect(a.partner.lookups).toBe(0);
    expect(a.csat).toEqual({ rated: 1, avg: 5 });
    expect(b.csat).toEqual({ rated: 1, avg: 3 });
    expect(a.latency.total).toMatchObject({ count: 1, p50: 1000 });
    expect(b.latency.total.count).toBe(0);
    expect(r.totals.csat).toEqual({ rated: 2, avg: 4 });
  });
});

describe('AnalyticsPilotService.report — caps and bounded work', () => {
  it('reads at most the cap + 1 conversations and flags the report truncated past it', async () => {
    const rows = Array.from({ length: PILOT_MAX_CONVERSATIONS + 5 }, (_, i) => row({ id: i + 1 }));
    const { svc, queries } = build({ rows });
    const r = await svc.report(TENANT, {}, NOW);
    expect(queries.conversations).toHaveBeenCalledWith(TENANT, expect.anything(), PILOT_MAX_CONVERSATIONS + 1);
    expect(r.truncated).toBe(true);
    expect(r.scanned).toBe(PILOT_MAX_CONVERSATIONS);
    expect(r.totals.conversations).toBe(PILOT_MAX_CONVERSATIONS);
  }, 30_000);

  it('exactly the cap is NOT truncated', async () => {
    const rows = Array.from({ length: PILOT_MAX_CONVERSATIONS }, (_, i) => row({ id: i + 1 }));
    const r = await build({ rows }).svc.report(TENANT, {}, NOW);
    expect(r.truncated).toBe(false);
  }, 30_000);

  it('reads the per-conversation facts in chunks of at most 1000 ids (one IN list each), never one query per conversation', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => row({ id: i + 1 }));
    const { svc, queries } = build({ rows });
    await svc.report(TENANT, {}, NOW);
    expect(queries.messageStats).toHaveBeenCalledTimes(3);
    for (const [ids] of queries.messageStats.mock.calls) expect((ids as number[]).length).toBeLessThanOrEqual(1000);
    expect(queries.reasons).toHaveBeenCalledTimes(3);
    expect(queries.moderation).toHaveBeenCalledTimes(3);
    // every conversation was looked at exactly once
    const seen = queries.messageStats.mock.calls.flatMap(([ids]) => ids as number[]);
    expect(new Set(seen).size).toBe(2500);
    expect(seen).toHaveLength(2500);
  });

  it('caps the number of group rows returned and says how many there were', async () => {
    const rows = Array.from({ length: PILOT_MAX_ROWS + 40 }, (_, i) => row({ id: i + 1, hotelSn: `H${i}` }));
    const r = await build({ rows }).svc.report(TENANT, {}, NOW);
    expect(r.rows).toHaveLength(PILOT_MAX_ROWS);
    expect(r.rowsTotal).toBe(PILOT_MAX_ROWS + 40);
    expect(r.totals.conversations).toBe(PILOT_MAX_ROWS + 40); // totals still cover everything scanned
  });

  it('asks the alert table only for escalations that have no stored hand-off reason', async () => {
    const rs = [
      row({ id: 1, escalated: true }), // no stored reason -> asks the alert
      row({ id: 2, escalated: true }), // has a stored reason -> does not
      row({ id: 3 }), // never escalated -> does not
      row({ id: 4, agentAssigned: true }), // an agent owns it, no reason -> asks
    ];
    const { svc, queries } = build({
      rows: rs,
      reasons: { 2: [{ reason: 'low_confidence', turns: 1, firstId: 3 }] },
      alerts: { 1: 'user_request', 4: 'moderation_blocked' },
    });
    const r = await svc.report(TENANT, {}, NOW);
    expect(queries.alertReasons).toHaveBeenCalledTimes(1);
    expect(queries.alertReasons.mock.calls[0][1]).toEqual([1, 4]);
    expect(r.totals.handoffReasons).toEqual({ user_request: 1, low_confidence: 1, moderation: 1 });
  });
});

describe('AnalyticsPilotService — window and request validation', () => {
  it('defaults to the 14 days before now', async () => {
    const { svc, queries } = build();
    const r = await svc.report(TENANT, {}, NOW);
    expect(r.days).toBe(14);
    const scope = queries.conversations.mock.calls[0][1] as { from: Date; to: Date };
    expect(scope.to.toISOString()).toBe(NOW.toISOString());
    expect(scope.from.toISOString()).toBe('2026-09-29T10:00:00.000Z');
  });

  it('a bare `to` date includes that whole day (exclusive upper bound = next midnight)', async () => {
    const { svc, queries } = build();
    await svc.report(TENANT, { from: '2026-10-01', to: '2026-10-07' }, NOW);
    const scope = queries.conversations.mock.calls[0][1] as { from: Date; to: Date };
    expect(scope.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(scope.to.toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });

  it(`a window longer than ${PILOT_MAX_WINDOW_DAYS} days is refused with E5141 — and nothing is queried`, async () => {
    const { svc, queries } = build();
    expect(await codeOf(svc.report(TENANT, { from: '2026-06-01', to: '2026-10-01' }, NOW))).toBe('E5141');
    expect(queries.conversations).not.toHaveBeenCalled();
  });

  it(`exactly ${PILOT_MAX_WINDOW_DAYS} days is allowed`, async () => {
    const { svc } = build();
    // 2026-07-01 .. 2026-09-30 inclusive = 92 days
    await expect(svc.report(TENANT, { from: '2026-07-01', to: '2026-09-30' }, NOW)).resolves.toBeDefined();
    expect(await codeOf(svc.report(TENANT, { from: '2026-06-30', to: '2026-09-30' }, NOW))).toBe('E5141');
  });

  it.each([
    ['from after to', { from: '2026-10-10', to: '2026-10-01' }],
    ['an unreadable from', { from: 'yesterday' }],
    ['an unreadable to', { to: '13/10/2026' }],
    ['an unknown group', { group: 'region' }],
    ['a hotel filter that is a document', { hotel_sn_too_long: true }],
  ])('refuses %s with E5140', async (_label, q) => {
    const { svc } = build();
    const req = 'hotel_sn_too_long' in q ? { hotelSn: 'x'.repeat(200) } : (q as Record<string, string>);
    expect(await codeOf(svc.report(TENANT, req, NOW))).toBe('E5140');
  });

  it('passes the trimmed hotel / role filters to the query, and an empty one means "no filter"', async () => {
    const { svc, queries } = build();
    await svc.report(TENANT, { hotelSn: ' 1721 ', role: '   ' }, NOW);
    const scope = queries.conversations.mock.calls[0][1] as { hotelSn?: string; role?: string };
    expect(scope.hotelSn).toBe('1721');
    expect(scope.role).toBeUndefined();
  });
});

describe('AnalyticsPilotService — adoption', () => {
  it('"Active 9 / pilot list 12": the allowlist comes from the repository, the active hotels from the SQL layer', async () => {
    const listed = Array.from({ length: 12 }, (_, i) => String(1700 + i));
    const { svc, hotelRepo, queries } = build({ listed, activeHotels: listed.slice(0, 9), pilotEnabled: true });
    const r = await svc.report(TENANT, {}, NOW);
    expect(r.adoption).toMatchObject({ pilotEnabled: true, listed: 12, listedActive: 9, listedSilent: 3 });
    expect(r.adoption.silentHotels).toEqual(['1709', '1710', '1711']);
    // only ACTIVE list rows are the pilot list, and only for this tenant
    expect(hotelRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, active: 1 } }));
    expect(queries.activeHotels).toHaveBeenCalledWith(TENANT, expect.any(Date), expect.any(Date));
  });

  it('adoption stays exact when the main read hit its cap (it asks for the distinct hotels separately)', async () => {
    const rows = Array.from({ length: PILOT_MAX_CONVERSATIONS + 1 }, (_, i) => row({ id: i + 1, hotelSn: 'A' }));
    const { svc } = build({ rows, listed: ['A', 'B'], activeHotels: ['A', 'B'] });
    const r = await svc.report(TENANT, {}, NOW);
    expect(r.truncated).toBe(true);
    expect(r.adoption.listedSilent).toBe(0); // B chatted, even though its rows were past the cap
  }, 30_000);

  it('a tenant that never configured the pilot reports pilotEnabled false and an empty list', async () => {
    const r = await build({ activeHotels: ['1'] }).svc.report(TENANT, {}, NOW);
    expect(r.adoption).toMatchObject({ pilotEnabled: false, listed: 0, hotelsActive: 1, offListActive: 1 });
  });

  it('identify does not make a hotel "active": only conversations do (a hotel that signed in and never chatted is silent)', async () => {
    // follow-up (d): EmbedService.identify upserts a customer even for a hotel outside the pilot. The
    // report never reads `customers` — activity is a conversation — so such a hotel is silent here.
    const { svc } = build({ listed: ['1721', '2204'], activeHotels: ['1721'] });
    const r = await svc.report(TENANT, {}, NOW);
    expect(r.adoption.silentHotels).toEqual(['2204']);
  });
});

describe('AnalyticsPilotService — tenant isolation', () => {
  it('every tenant-scoped query gets the caller\'s tenant, and the id lists come only from the tenant-scoped conversation read', async () => {
    const { svc, queries, tenantRepo, hotelRepo } = build({ rows: [row({ id: 11 }), row({ id: 12 })], listed: ['1'] });
    await svc.report(TENANT, {}, NOW);
    expect(queries.conversations.mock.calls[0][0]).toBe(TENANT);
    for (const call of queries.moderation.mock.calls) expect(call[0]).toBe(TENANT);
    for (const call of queries.partner.mock.calls) expect(call[0]).toBe(TENANT);
    for (const call of queries.alertReasons.mock.calls) expect(call[0]).toBe(TENANT);
    expect(queries.activeHotels.mock.calls[0][0]).toBe(TENANT);
    expect(tenantRepo.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: TENANT } }));
    expect((hotelRepo.find.mock.calls[0][0] as { where: { tenantId: number } }).where.tenantId).toBe(TENANT);
    // the message-level queries only ever see ids the conversation read returned
    for (const [ids] of queries.messageStats.mock.calls) expect(ids).toEqual([11, 12]);
    for (const [ids] of queries.reasons.mock.calls) expect(ids).toEqual([11, 12]);
  });
});

describe('AnalyticsPilotMapper', () => {
  it('camelCase response with ISO dates, the window facts and what is NOT recorded', async () => {
    const { svc } = build({ rows: [row({ id: 1 })], listed: ['1721'], activeHotels: ['1721'] });
    const res = AnalyticsPilotMapper.toReport(await svc.report(TENANT, { from: '2026-10-01', to: '2026-10-07' }, NOW));
    expect(res.window).toEqual({
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-08T00:00:00.000Z',
      days: 7,
      timezone: 'UTC',
    });
    expect(res.meta).toMatchObject({
      scanned: 1,
      truncated: false,
      maxConversations: PILOT_MAX_CONVERSATIONS,
      maxWindowDays: PILOT_MAX_WINDOW_DAYS,
      exportMaxRows: PILOT_EXPORT_MAX_ROWS,
      rowsShown: 1,
      rowsTotal: 1,
    });
    // pilot_denied and consent turns are never stored: the API says so instead of reporting a 0
    expect(res.meta.unrecordedReasons.sort()).toEqual(['consent', 'pilot_denied']);
    // snake_case never leaks into the response
    expect(JSON.stringify(res)).not.toMatch(/[a-z]_[a-z]+":/);
  });

  it('carries no customer, session, message or conversation id', async () => {
    const { svc } = build({ rows: [row({ id: 4242, customerId: 99871, sessionId: 77123 })] });
    const json = JSON.stringify(AnalyticsPilotMapper.toReport(await svc.report(TENANT, {}, NOW)));
    for (const needle of ['4242', '99871', '77123']) expect(json).not.toContain(needle);
  });
});

describe('AnalyticsPilotService — CSV export', () => {
  const longRows = (n: number) => Array.from({ length: n }, (_, i) => row({ id: i + 1, hotelSn: '1721' }));
  const collect = async (gen: AsyncGenerator<string>) => {
    const parts: string[] = [];
    for await (const p of gen) parts.push(p);
    return parts;
  };

  it('plans at most the row cap and flags truncation without writing anything', async () => {
    const { svc, queries } = build({ rows: longRows(PILOT_EXPORT_MAX_ROWS + 3) });
    const plan = await svc.prepareExport(TENANT, {}, NOW);
    expect(queries.conversations).toHaveBeenCalledWith(TENANT, expect.anything(), PILOT_EXPORT_MAX_ROWS + 1);
    expect(plan.rows).toHaveLength(PILOT_EXPORT_MAX_ROWS);
    expect(plan.truncated).toBe(true);
    expect(queries.transcripts).not.toHaveBeenCalled();
  }, 30_000);

  it('exactly the cap is not truncated and has no trailer', async () => {
    const { svc } = build({ rows: longRows(PILOT_EXPORT_MAX_ROWS) });
    const plan = await svc.prepareExport(TENANT, {}, NOW);
    expect(plan.truncated).toBe(false);
  }, 30_000);

  it('validates before anything is written: a bad range is an E5140/E5141, not a half file', async () => {
    const { svc } = build();
    expect(await codeOf(svc.prepareExport(TENANT, { from: '2026-10-10', to: '2026-10-01' }, NOW))).toBe('E5140');
    expect(await codeOf(svc.prepareExport(TENANT, { from: '2026-01-01', to: '2026-10-01' }, NOW))).toBe('E5141');
  });

  it('streams the BOM + header first, one page of conversations at a time (pages of 200), trailer only when capped', async () => {
    const rows = longRows(450);
    const { svc, queries } = build({ rows });
    const plan = await svc.prepareExport(TENANT, {}, NOW);
    const parts = await collect(svc.exportChunks(TENANT, plan));

    expect(parts[0].startsWith(CSV_BOM)).toBe(true);
    expect(parts[0].split(',')).toHaveLength(PILOT_CSV_COLUMNS.length);
    expect(parts).toHaveLength(1 + 3); // header + pages of 200, 200, 50
    expect(queries.transcripts.mock.calls.map(([ids]) => (ids as number[]).length)).toEqual([200, 200, 50]);
    expect(parts.join('').split(CSV_BOM)).toHaveLength(2); // the BOM appears exactly once
    expect(parts.join('')).not.toContain('#truncated');
  });

  it('appends the truncation record when capped', async () => {
    const { svc } = build({ rows: longRows(PILOT_EXPORT_MAX_ROWS + 1) });
    const plan = await svc.prepareExport(TENANT, {}, NOW);
    expect(plan.truncated).toBe(true);
    // do not stream 5000 rows through the transcript query: trim the plan, keep the flag
    const small = { ...plan, rows: plan.rows.slice(0, 3) };
    const parts = await collect(svc.exportChunks(TENANT, small));
    expect(parts[parts.length - 1]).toContain('#truncated');
  }, 30_000);

  it('the transcript is scrubbed and the row carries the verdict', async () => {
    const rows = [row({ id: 9, hotelSn: '1721', actorRole: 'manager', escalated: true })];
    const { svc } = build({
      rows,
      messages: { 9: { total: 3, answers: 1, confidenceSum: 0.8, agents: 1 } },
      reasons: { 9: [{ reason: 'low_confidence', turns: 1, firstId: 30 }] },
      transcripts: {
        9: [
          { id: 28, senderType: 'user', body: 'Gửi báo cáo cho a@b.vn hoặc gọi 0901 234 567, mã BK9988776' },
          { id: 29, senderType: 'ai', body: 'Hoa hồng 15%', confidence: 0.8 },
          { id: 30, senderType: 'system', body: 'Chuyển nhân viên', reason: 'low_confidence' },
        ],
      },
    });
    const plan = await svc.prepareExport(TENANT, {}, NOW);
    const text = (await collect(svc.exportChunks(TENANT, plan))).join('');
    for (const secret of ['a@b.vn', '0901 234 567', 'BK9988776']) expect(text).not.toContain(secret);
    expect(text).toContain('handoff,low_confidence');
    expect(text).toContain('AI [0.80]: Hoa hồng 15%');
  });

  it('a conversation with no messages still gets a row (empty transcript), and none of its facts is invented', async () => {
    const { svc } = build({ rows: [row({ id: 5 })] });
    const plan = await svc.prepareExport(TENANT, {}, NOW);
    const text = (await collect(svc.exportChunks(TENANT, plan))).join('');
    expect(text.split('\r\n').filter(Boolean)).toHaveLength(2); // header + one row
    expect(text).toContain('no_answer');
    expect(text).not.toMatch(/null|undefined|NaN/);
  });

  it('does not ask for latency (the CSV has no latency column): one less query per page', async () => {
    const { svc, queries } = build({ rows: longRows(10) });
    const plan = await svc.prepareExport(TENANT, {}, NOW);
    await collect(svc.exportChunks(TENANT, plan));
    expect(queries.latencies).not.toHaveBeenCalled();
  });
});
