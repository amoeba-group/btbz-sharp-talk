import { randomBytes } from 'crypto';
import { HandoffRouterService } from './handoff-router.service';
import type { AiConfigService } from './ai-config.service';
import type { HandoffConfig } from './entity/tenant-ai-config.entity';
import { sealWebhook } from './slack-webhook.util';

/**
 * Routing extras on the router (PLN-261012 SG-63/SG-67): the hotel→province fallback keyed by the
 * SIGNED hotelSn only, the route decision per team and region, and the routing policy the alert
 * side reads. Time is frozen where the clock matters.
 */
const REGION_TABLE: HandoffConfig = {
  regionRouting: {
    enabled: true,
    categories: [
      { id: 'north', team: 'north', provinces: ['Hà Nội'] },
      { id: 'south_central', team: 'south', provinces: ['Đà Nẵng'] },
    ],
  },
};

function build(config: HandoffConfig | null, table: Array<{ tenantId: number; hotelSn: string; province: string }> = [], withRepo = true) {
  const findOne = jest.fn(async (q: { where: { tenantId: number; hotelSn: string } }) => {
    const row = table.find((r) => r.tenantId === q.where.tenantId && r.hotelSn === q.where.hotelSn);
    return row ? { ...row } : null;
  });
  const aiConfig = { getHandoffConfig: jest.fn(async () => config) } as unknown as AiConfigService;
  const router = new HandoffRouterService(aiConfig, withRepo ? ({ findOne } as never) : undefined);
  // The unmapped-province warning is not what these cases are about.
  jest.spyOn((router as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation();
  return { router, findOne, aiConfig };
}

const signed = (over: Record<string, unknown> = {}) => ({ signed: true as const, hotelSn: '1721', province: undefined, ...over });

describe('HandoffRouterService.regionLookup — hotel table fallback (SG-67)', () => {
  const TABLE = [{ tenantId: 1, hotelSn: '1721', province: 'Đà Nẵng' }];

  it('falls back to the table, keyed by the signed hotelSn, when the claims carry no province', async () => {
    const h = build(REGION_TABLE, TABLE);
    const r = await h.router.regionLookup(1, signed());
    expect(r.region).toMatchObject({ category: 'south_central', team: 'south' });
    expect(r.source).toBe('hotel_table');
    expect(h.findOne).toHaveBeenCalledWith({ where: { tenantId: 1, hotelSn: '1721' } });
  });

  it('a province the SIGNED claims carry always wins, and the table is not even read', async () => {
    const h = build(REGION_TABLE, TABLE);
    const r = await h.router.regionLookup(1, signed({ province: 'Hà Nội' }));
    expect(r.region).toMatchObject({ category: 'north', team: 'north' });
    expect(r.source).toBeUndefined();
    expect(h.findOne).not.toHaveBeenCalled();
  });

  it('TRUST: an UNSIGNED claim never reaches the table, even with a matching hotelSn', async () => {
    const h = build(REGION_TABLE, TABLE);
    expect(await h.router.regionLookup(1, { signed: false, hotelSn: '1721', province: undefined })).toEqual({ region: null });
    expect(await h.router.regionLookup(1, { signed: false, hotelSn: '1721', province: 'Hà Nội' })).toEqual({ region: null });
    expect(h.findOne).not.toHaveBeenCalled();
  });

  it('TRUST: a hotel NAME or CODE is never a key — only the signed hotelSn is', async () => {
    const h = build(REGION_TABLE, [
      { tenantId: 1, hotelSn: 'Sao Mai', province: 'Hà Nội' }, // a row keyed by what is really a name
      { tenantId: 1, hotelSn: 'SM-01', province: 'Hà Nội' }, // ... or a code
    ]);
    // Signed claims with name and code but no hotelSn: nothing to look up.
    const claims = { signed: true as const, hotelSn: '', hotelName: 'Sao Mai', hotelCode: 'SM-01', province: undefined };
    expect(await h.router.regionLookup(1, claims)).toEqual({ region: null });
    expect(h.findOne).not.toHaveBeenCalled();
    // And a signed hotelSn is looked up as the hotelSn, whatever the name says.
    const withSn = { ...claims, hotelSn: '9999' };
    expect(await h.router.regionLookup(1, withSn)).toEqual({ region: null });
    expect(h.findOne).toHaveBeenCalledWith({ where: { tenantId: 1, hotelSn: '9999' } });
  });

  it('claims without a hotelSn, or with no claims at all, resolve to nothing', async () => {
    const h = build(REGION_TABLE, TABLE);
    expect(await h.router.regionLookup(1, null)).toEqual({ region: null });
    expect(await h.router.regionLookup(1, undefined)).toEqual({ region: null });
    expect(await h.router.regionLookup(1, signed({ hotelSn: '   ' }))).toEqual({ region: null });
    expect(h.findOne).not.toHaveBeenCalled();
  });

  it('a province from the table that the region table does not list is reported as unmapped, with its source', async () => {
    const h = build(REGION_TABLE, [{ tenantId: 1, hotelSn: '1721', province: 'Tp Quy Nhơn' }]);
    expect(await h.router.regionLookup(1, signed())).toEqual({ region: null, unmapped: 'Tp Quy Nhơn', source: 'hotel_table' });
  });

  it('is off when region routing is off: the table is not read', async () => {
    const h = build({ regionRouting: { ...REGION_TABLE.regionRouting!, enabled: false } }, TABLE);
    expect(await h.router.regionLookup(1, signed())).toEqual({ region: null });
    expect(h.findOne).not.toHaveBeenCalled();
    const none = build(null, TABLE);
    expect(await none.router.regionLookup(1, signed())).toEqual({ region: null });
  });

  it('is off without the repository (a router built the old way): no fallback, no error', async () => {
    const h = build(REGION_TABLE, TABLE, false);
    expect(await h.router.regionLookup(1, signed())).toEqual({ region: null });
  });

  it('a hotel with no row resolves to nothing — not unmapped (there is no province to show)', async () => {
    const h = build(REGION_TABLE, TABLE);
    expect(await h.router.regionLookup(1, signed({ hotelSn: '5555' }))).toEqual({ region: null });
  });

  it('reads the table of the right tenant only', async () => {
    const h = build(REGION_TABLE, [{ tenantId: 2, hotelSn: '1721', province: 'Đà Nẵng' }]);
    expect(await h.router.regionLookup(1, signed())).toEqual({ region: null });
    expect(await h.router.regionLookup(2, signed())).toMatchObject({ region: { team: 'south' } });
  });

  it('carries the table mode with it', async () => {
    const strict = build({ regionRouting: { ...REGION_TABLE.regionRouting!, mode: 'strict' } }, TABLE);
    expect((await strict.router.regionLookup(1, signed())).mode).toBe('strict');
    expect((await strict.router.regionLookup(1, signed({ province: 'Hà Nội' }))).mode).toBe('strict');
    const prefer = build(REGION_TABLE, TABLE);
    expect((await prefer.router.regionLookup(1, signed())).mode).toBeUndefined();
  });

  describe('per-tenant cache', () => {
    beforeEach(() => jest.useFakeTimers().setSystemTime(Date.parse('2026-10-15T09:00:00Z')));
    afterEach(() => jest.useRealTimers());

    it('answers a repeat lookup from memory, then re-reads after a minute', async () => {
      const h = build(REGION_TABLE, TABLE);
      await h.router.regionLookup(1, signed());
      await h.router.regionLookup(1, signed());
      expect(h.findOne).toHaveBeenCalledTimes(1);
      jest.setSystemTime(Date.parse('2026-10-15T09:01:01Z'));
      await h.router.regionLookup(1, signed());
      expect(h.findOne).toHaveBeenCalledTimes(2);
    });

    it('remembers a hotel with no row too, so a province-sending tenant costs nothing', async () => {
      const h = build(REGION_TABLE, []);
      await h.router.regionLookup(1, signed());
      await h.router.regionLookup(1, signed());
      expect(h.findOne).toHaveBeenCalledTimes(1);
    });

    it('an upload clears that tenant only — the next lookup sees the new table at once', async () => {
      const table = [{ tenantId: 1, hotelSn: '1721', province: 'Hà Nội' }, { tenantId: 2, hotelSn: '1721', province: 'Hà Nội' }];
      const h = build(REGION_TABLE, table);
      expect((await h.router.regionLookup(1, signed())).region?.team).toBe('north');
      await h.router.regionLookup(2, signed());
      expect(h.findOne).toHaveBeenCalledTimes(2);

      table[0].province = 'Đà Nẵng'; // the upload replaced it
      h.router.invalidateHotelProvinces(1);
      expect((await h.router.regionLookup(1, signed())).region?.team).toBe('south');
      await h.router.regionLookup(2, signed()); // tenant 2 stays cached
      expect(h.findOne).toHaveBeenCalledTimes(3);
    });

    it('is bounded: a stream of distinct hotelSn values cannot grow it without limit', async () => {
      const h = build(REGION_TABLE, []);
      for (let i = 0; i < 5100; i++) await h.router.regionLookup(1, signed({ hotelSn: `h${i}` }));
      expect((h.router as unknown as { hotelProvinces: Map<string, unknown> }).hotelProvinces.size).toBeLessThanOrEqual(5000);
    });
  });
});

describe('HandoffRouterService.route — per team hours and regional mailbox (SG-67)', () => {
  afterEach(() => jest.useRealTimers());
  const HOURS = { timezone: 'Asia/Ho_Chi_Minh', days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };
  const at = (utc: string) => jest.useFakeTimers().setSystemTime(Date.parse(utc));
  const WED_1600 = '2026-10-14T09:00:00Z'; // local 16:00
  const WED_2000 = '2026-10-14T13:00:00Z'; // local 20:00
  const teams = (hours?: typeof HOURS) => ({
    enabled: true,
    options: [
      { id: 'cs', jobLabel: 'consult', ...(hours ? { businessHours: hours } : {}) },
      { id: 'business', jobLabel: 'sales_admin' },
    ],
  });

  it('with no scope it decides exactly as before', async () => {
    at(WED_2000);
    const h = build({ businessHours: HOURS, offHours: { email: 'cs@x.co' }, teamRouting: teams({ ...HOURS, end: '22:00' }) });
    expect((await h.router.route(1, 'EN')).mode).toBe('email');
  });

  it("a team's own hours replace the tenant-wide ones for that team only", async () => {
    at(WED_2000);
    const h = build({ businessHours: HOURS, offHours: { email: 'cs@x.co' }, teamRouting: teams({ ...HOURS, start: '12:00', end: '22:00' }) });
    expect((await h.router.route(1, 'EN', { supportType: 'cs' })).mode).toBe('agents');
    expect((await h.router.route(1, 'EN', { supportType: 'business' })).mode).toBe('email');
  });

  it('a team can be closed while the tenant-wide hours are open', async () => {
    at(WED_1600);
    const h = build({ businessHours: HOURS, offHours: { email: 'cs@x.co' }, teamRouting: teams({ ...HOURS, start: '08:00', end: '12:00' }) });
    expect((await h.router.route(1, 'EN', { supportType: 'cs' })).mode).toBe('email');
    expect((await h.router.route(1, 'EN', { supportType: 'business' })).mode).toBe('agents');
  });

  it('a team with hours works even when the tenant set none', async () => {
    at(WED_2000);
    const h = build({ offHours: { email: 'cs@x.co' }, teamRouting: teams(HOURS) });
    expect((await h.router.route(1, 'EN', { supportType: 'cs' })).mode).toBe('email');
    expect((await h.router.route(1, 'EN')).mode).toBe('agents');
  });

  it('team breaks carve holes like the tenant-wide ones', async () => {
    at(WED_1600);
    const h = build({
      offHours: { email: 'cs@x.co' },
      teamRouting: { enabled: true, options: [{ id: 'cs', jobLabel: 'consult', businessHours: { ...HOURS, breaks: [{ start: '15:30', end: '16:30' }] } }] },
    });
    expect((await h.router.route(1, 'EN', { supportType: 'cs' })).mode).toBe('email');
  });

  it('an unknown team, or team routing switched off, falls back to the tenant-wide hours', async () => {
    at(WED_2000);
    const cfg: HandoffConfig = { businessHours: HOURS, offHours: { email: 'cs@x.co' }, teamRouting: teams({ ...HOURS, end: '22:00' }) };
    expect((await build(cfg).router.route(1, 'EN', { supportType: 'ghost' })).mode).toBe('email');
    const off: HandoffConfig = { ...cfg, teamRouting: { ...teams({ ...HOURS, end: '22:00' }), enabled: false } };
    expect((await build(off).router.route(1, 'EN', { supportType: 'cs' })).mode).toBe('email');
  });

  it('off hours, the hotel regional mailbox wins over the shared one; a region without one uses the shared', async () => {
    at(WED_2000);
    const cfg: HandoffConfig = { businessHours: HOURS, offHours: { email: 'cs@x.co', emailByRegion: { south: 'south@x.co' } } };
    expect((await build(cfg).router.route(1, 'EN', { region: 'south' })).email).toBe('south@x.co');
    expect((await build(cfg).router.route(1, 'EN', { region: 'north' })).email).toBe('cs@x.co');
    expect((await build(cfg).router.route(1, 'EN')).email).toBe('cs@x.co');
    expect((await build(cfg).router.route(1, 'EN', { region: null })).email).toBe('cs@x.co');
  });

  it('a regional mailbox alone is enough for a hotel of that region; others keep paging agents', async () => {
    at(WED_2000);
    const cfg: HandoffConfig = { businessHours: HOURS, offHours: { emailByRegion: { south: 'south@x.co' } } };
    expect((await build(cfg).router.route(1, 'EN', { region: 'south' })).mode).toBe('email');
    expect((await build(cfg).router.route(1, 'EN', { region: 'north' })).mode).toBe('agents');
  });

  it('the notice and the mailbox decision never leak across tenants (a tenant without config)', async () => {
    at(WED_2000);
    expect(await build(null).router.route(1, 'EN', { region: 'south', supportType: 'cs' })).toEqual({ mode: 'agents', targetUserIds: [] });
  });
});

describe('HandoffRouterService.routingPolicy (SG-63/SG-67)', () => {
  const OLD_KEY = process.env.CRED_ENC_KEY;
  beforeAll(() => {
    process.env.CRED_ENC_KEY = randomBytes(32).toString('base64');
  });
  afterAll(() => {
    if (OLD_KEY === undefined) delete process.env.CRED_ENC_KEY;
    else process.env.CRED_ENC_KEY = OLD_KEY;
  });
  const policy = (cfg: HandoffConfig | null) => build(cfg).router.routingPolicy(1);

  it('a tenant with no hand-off config is left alone: not configured, no re-alert', async () => {
    expect(await policy(null)).toMatchObject({ configured: false, unclaimedAlerts: false, regionEnabled: false, regionMode: 'prefer', teams: [], assigneeUserIds: [] });
  });

  it('the re-alert defaults ON only where an alert can be pinned to one person', async () => {
    expect((await policy({ assigneeUserIds: [4] })).unclaimedAlerts).toBe(true);
    expect((await policy({ teamRouting: { enabled: true } })).unclaimedAlerts).toBe(true);
    expect((await policy(REGION_TABLE)).unclaimedAlerts).toBe(true);
    // Only deny rules / hours / SLA: nobody is pinned, so nothing changes for the tenant.
    expect((await policy({ sla: { normalHours: 24 }, offHours: { email: 'a@b.co' } })).unclaimedAlerts).toBe(false);
    expect((await policy({ assigneeUserIds: [] })).unclaimedAlerts).toBe(false);
    expect((await policy({ regionRouting: { enabled: false } })).unclaimedAlerts).toBe(false);
  });

  it('an explicit setting beats the default, both ways', async () => {
    expect((await policy({ assigneeUserIds: [4], unclaimedAlerts: false })).unclaimedAlerts).toBe(false);
    expect((await policy({ sla: {}, unclaimedAlerts: true })).unclaimedAlerts).toBe(true);
  });

  it('reports strict mode only when region routing is on, and the widening delay', async () => {
    const strict = await policy({ regionRouting: { enabled: true, mode: 'strict', widenAfterMinutes: 15 } });
    expect(strict).toMatchObject({ regionEnabled: true, regionMode: 'strict', widenAfterMinutes: 15 });
    expect((await policy({ regionRouting: { enabled: false, mode: 'strict' } })).regionMode).toBe('prefer');
    expect((await policy({ regionRouting: { enabled: true } })).regionMode).toBe('prefer');
    expect((await policy({ regionRouting: { enabled: true } })).widenAfterMinutes).toBeNull();
  });

  it('opens the regional Slack webhooks for the alert side, and skips ones it cannot read', async () => {
    const hook = 'https://hooks.slack.com/services/T1/B1/northToken1';
    const out = await policy({
      regionRouting: { enabled: true, slackByRegion: { north: sealWebhook(hook), south: 'enc:v1:garbage' } },
    });
    expect(out.slackByRegion).toEqual({ north: hook });
  });

  it('lists the team options in English when team routing is on', async () => {
    const out = await policy({ teamRouting: { enabled: true } });
    expect(out.teams.map((t) => [t.id, t.jobLabel, t.label])).toEqual([
      ['cs', 'consult', 'Customer Service Support'],
      ['business', 'sales_admin', 'Business Support'],
    ]);
    expect((await policy({ teamRouting: { enabled: false } })).teams).toEqual([]);
  });
});
