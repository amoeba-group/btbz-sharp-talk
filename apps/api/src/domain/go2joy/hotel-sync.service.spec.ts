jest.mock('./partner-client', () => {
  const actual = jest.requireActual('./partner-client');
  return { ...actual, partnerCall: jest.fn() };
});

import { HotelSyncService, parseHotelSn } from './hotel-sync.service';
import { PartnerApiError, partnerCall } from './partner-client';
import { encryptSecret } from '../../global/util/crypto.util';

/**
 * Hotel profile + room types from the Partner API (PLN-261023 B): a hotel the
 * API confirms becomes a company; its room types become that company's
 * products; a room that leaves the feed is archived; the entered room count
 * survives a sync; nothing is created for a hotel the API does not know.
 */
const call = partnerCall as jest.Mock;

function harness(opts: { creds?: boolean; companies?: any[]; products?: any[] } = {}) {
  process.env.CRED_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
  const companies: any[] = opts.companies ?? [];
  const products: any[] = opts.products ?? [];
  const match = (row: any, where: any) => Object.entries(where).every(([k, v]) => String(row[k]) === String(v));
  const credRepo = {
    findOne: jest.fn(async () =>
      opts.creds === false
        ? null
        : { secretEnc: encryptSecret(JSON.stringify({ base_url: 'https://p.example', client_id: 'c', client_secret: 's' })) },
    ),
    find: jest.fn(async () => [{ tenantId: 4 }]),
  };
  const companyRepo = {
    findOne: jest.fn(async ({ where }: any) => companies.find((c) => match(c, where)) ?? null),
    create: jest.fn((x: any) => ({ ...x })),
    save: jest.fn(async (c: any) => {
      if (!c.id) {
        c.id = String(100 + companies.length);
        companies.push(c);
      }
      return c;
    }),
  };
  const productRepo = {
    find: jest.fn(async ({ where }: any) => products.filter((p) => match(p, where))),
    create: jest.fn((x: any) => ({ ...x })),
    save: jest.fn(async (p: any) => {
      if (!products.includes(p)) products.push(p);
      return p;
    }),
  };
  const svc = new HotelSyncService(credRepo as any, companyRepo as any, productRepo as any);
  return { svc, companies, products, credRepo };
}

const INFO = { sn: 4118, name: 'Lá Hotel Quận 10', hourly: true, startHourly: 7, endHourly: 21 };
const V1 = [
  { sn: 11360, name: 'Standard Room', status: 1, firstHoursOrigin: 60000, overnightOrigin: 340000 },
  { sn: 73935, name: 'Phòng Bị từ chối', status: 4, overnightOrigin: 100000 },
];
const V2 = { roomTypeList: [{ sn: 11360, bedType: 2, facilityList: [{ name: 'máy sấy', nameEn: 'dryer' }] }] };

function answer(info: unknown = INFO, v1: unknown = V1, v2: unknown = V2) {
  call.mockImplementation(async (_cfg: unknown, path: string) => {
    if (path.includes('getHotelInfo')) {
      if (info instanceof Error) throw info;
      return info;
    }
    if (path.startsWith('api/v1/datafeed')) return v1;
    return v2;
  });
}

describe('HotelSyncService', () => {
  const savedKey = process.env.CRED_ENC_KEY;
  beforeEach(() => call.mockReset());
  afterAll(() => {
    if (savedKey === undefined) delete process.env.CRED_ENC_KEY;
    else process.env.CRED_ENC_KEY = savedKey;
  });

  it('creates the hotel company and its room products', async () => {
    answer();
    const { svc, companies, products } = harness();
    const r = await svc.syncHotel(4, 4118);
    expect(companies).toHaveLength(1);
    expect(companies[0]).toMatchObject({ externalKey: 'hotel:4118', name: 'Lá Hotel Quận 10', partnerSyncError: null });
    expect(companies[0].partnerInfo.hourly).toEqual({ enabled: true, start: 7, end: 21 });
    expect(r.rooms).toEqual({ upserted: 2, archived: 0 });
    const std = products.find((p) => p.handle === 'hotel-4118-rt-11360');
    expect(std).toMatchObject({ companyId: Number(companies[0].id), source: 'go2joy_partner', status: 'active', price: 60000, currency: 'VND' });
    expect(std.attributes.facilities).toEqual([{ vi: 'máy sấy', en: 'dryer' }]);
    // HA status 4 (rejected) is kept, not for sale.
    expect(products.find((p) => p.handle === 'hotel-4118-rt-73935').status).toBe('archived');
  });

  it('archives a room that left the feed and keeps the entered room count', async () => {
    const companies = [{ id: '7', tenantId: 4, externalKey: 'hotel:4118' }];
    const products = [
      { id: 1, tenantId: 4, companyId: 7, source: 'go2joy_partner', handle: 'hotel-4118-rt-11360', status: 'active', attributes: { roomCount: 14 } },
      { id: 2, tenantId: 4, companyId: 7, source: 'go2joy_partner', handle: 'hotel-4118-rt-999', status: 'active', attributes: null },
    ];
    answer(INFO, [V1[0]]);
    const { svc } = harness({ companies, products });
    const r = await svc.syncHotel(4, 4118);
    expect(r.rooms).toEqual({ upserted: 1, archived: 1 });
    expect(products[0].attributes).toMatchObject({ roomCount: 14 });
    expect(products[1].status).toBe('archived');
  });

  it('a hotel the API does not know creates nothing (E5101)', async () => {
    answer(new PartnerApiError('not_found', 'The selected hotelSn is invalid.', 4));
    const { svc, companies } = harness();
    await expect(svc.syncHotel(4, 999)).rejects.toMatchObject({ errorCode: 'E5101' });
    expect(companies).toHaveLength(0);
  });

  it('a reply about another hotel is treated as not found', async () => {
    answer({ ...INFO, sn: 227 });
    const { svc, companies } = harness();
    await expect(svc.syncHotel(4, 4118)).rejects.toMatchObject({ errorCode: 'E5101' });
    expect(companies).toHaveLength(0);
  });

  it('without Partner credentials: E5100 on the console, silence on sign-in', async () => {
    const { svc } = harness({ creds: false });
    await expect(svc.syncHotel(4, 4118)).rejects.toMatchObject({ errorCode: 'E5100' });
    await expect(svc.ensureHotel(4, '4118')).resolves.toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it('sign-in skips a hotel synced within a day and never throws', async () => {
    const fresh = [{ id: '7', tenantId: 4, externalKey: 'hotel:4118', partnerSyncedAt: new Date() }];
    const { svc } = harness({ companies: fresh });
    await expect(svc.ensureHotel(4, '4118')).resolves.toBe(fresh[0]);
    expect(call).not.toHaveBeenCalled();

    answer(new PartnerApiError('server', 'boom'));
    const stale = [{ id: '8', tenantId: 4, externalKey: 'hotel:4118', partnerSyncedAt: new Date(Date.now() - 2 * 86_400_000) }];
    const h = harness({ companies: stale });
    await expect(h.svc.ensureHotel(4, '4118')).resolves.toBe(stale[0]);
    expect(stale[0]).toMatchObject({ partnerSyncError: 'boom' });
  });

  it('only digit hotel numbers are accepted', () => {
    expect(parseHotelSn('4118')).toBe(4118);
    expect(parseHotelSn(' 4118 ')).toBe(4118);
    expect(parseHotelSn('H-2428')).toBeNull();
    expect(parseHotelSn('0')).toBeNull();
    expect(parseHotelSn(null)).toBeNull();
  });
});
