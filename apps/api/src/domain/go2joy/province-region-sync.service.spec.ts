jest.mock('./partner-client', () => {
  const actual = jest.requireActual('./partner-client');
  return { ...actual, partnerCall: jest.fn() };
});

import { ProvinceRegionSyncService } from './province-region-sync.service';
import { PartnerApiError, partnerCall } from './partner-client';

/**
 * Province → region map from the Province Feed (PLN-261023 H1-a): only the
 * provinceRegions keys of handoff_config change; an empty or failed feed and a
 * tenant without credentials or AI configuration write nothing.
 */
const call = partnerCall as jest.Mock;

function harness(opts: { config?: boolean; row?: Record<string, unknown> | null } = {}) {
  const row =
    opts.row === undefined
      ? { tenantId: 4, handoffConfig: { assigneeUserIds: [28], provinceRegions: { 'Hồ Chí Minh': 'south', 'Custom': 'central' } } }
      : opts.row;
  const aiConfigRepo = { findOne: jest.fn(async () => row), save: jest.fn(async (r: unknown) => r) };
  const hotelSync = {
    config: jest.fn(async () => (opts.config === false ? null : { baseUrl: 'https://p.example/', clientId: 'c', clientSecret: 's' })),
    connectedTenantIds: jest.fn(async () => [4, 5]),
  };
  const svc = new ProvinceRegionSyncService(aiConfigRepo as any, hotelSync as any);
  return { svc, aiConfigRepo, row };
}

const FEED = {
  provinceList: [
    { sn: 1, name: 'Hồ Chí Minh', region: 1 },
    { sn: 2, name: 'Hà Nội', region: 2 },
    { sn: 70, name: 'Makati', region: 10 },
  ],
};

describe('ProvinceRegionSyncService', () => {
  beforeEach(() => call.mockReset());

  it('merges the feed into provinceRegions and leaves every other handoff key alone', async () => {
    call.mockResolvedValue(FEED);
    const { svc, aiConfigRepo, row } = harness();
    const r = await svc.syncTenant(4);
    expect(call).toHaveBeenCalledWith(expect.anything(), 'api/v2/datafeed/getProvinceFeed', {});
    expect(r).toMatchObject({ total: 4, added: 2, changed: 0, kept: 1 });
    expect(aiConfigRepo.save).toHaveBeenCalledTimes(1);
    const saved = (row as any).handoffConfig;
    expect(saved.assigneeUserIds).toEqual([28]);
    expect(saved.provinceRegions).toEqual({ Custom: 'central', 'Hồ Chí Minh': 'south', 'Hà Nội': 'north', Makati: 'region_10' });
    expect(saved.provinceRegionsSource).toBe('go2joy_partner');
    expect(typeof saved.provinceRegionsSyncedAt).toBe('string');
  });

  it('an empty feed writes nothing', async () => {
    call.mockResolvedValue({ provinceList: [] });
    const { svc, aiConfigRepo } = harness();
    await expect(svc.syncTenant(4)).rejects.toMatchObject({ errorCode: 'E5102' });
    expect(aiConfigRepo.save).not.toHaveBeenCalled();
  });

  it('a failed call writes nothing; no credentials → E5100; no AI configuration → nothing created', async () => {
    call.mockRejectedValue(new PartnerApiError('signature', 'Invalid signature', 6));
    const a = harness();
    await expect(a.svc.syncTenant(4)).rejects.toMatchObject({ errorCode: 'E5102' });
    expect(a.aiConfigRepo.save).not.toHaveBeenCalled();

    const b = harness({ config: false });
    await expect(b.svc.syncTenant(4)).rejects.toMatchObject({ errorCode: 'E5100' });

    call.mockReset();
    call.mockResolvedValue(FEED);
    const c = harness({ row: null });
    await expect(c.svc.syncTenant(4)).rejects.toBeDefined();
    expect(c.aiConfigRepo.save).not.toHaveBeenCalled();
  });

  it('status counts provinces per region; the daily sweep never throws', async () => {
    const { svc } = harness();
    await expect(svc.status(4)).resolves.toEqual({ total: 2, syncedAt: null, source: null, regions: { south: 1, central: 1 } });
    call.mockRejectedValue(new Error('down'));
    await expect(svc.syncAll()).resolves.toEqual({ tenants: 2, failed: 2 });
  });
});
