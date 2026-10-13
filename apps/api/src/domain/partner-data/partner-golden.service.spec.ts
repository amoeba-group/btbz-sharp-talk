import { PartnerGoldenService } from './partner-golden.service';
import { partnerCtxFromBody, sanitizePartnerCtx } from './partner-golden.util';
import type { PartnerDataBlock, PartnerNotice } from './partner-data.step';
import { parseBulkLines, parsePartnerColumn } from '../ai-coach/golden-grade.util';

/**
 * Golden (regression) questions that carry a hotel / role / mock set
 * (PLN-261012 SG-31): they run through the SAME partner step as the chat, but
 * always against a named MOCK fixture set — deterministic, and never the live API.
 */
describe('PartnerGoldenService', () => {
  const NOW = Date.parse('2026-10-13T02:00:00.000Z'); // Tuesday 09:00 +07:00
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.PARTNER_API_MODE;
    delete process.env.PARTNER_DATA_ENABLED;
  });

  const svc = new PartnerGoldenService();
  const data = (r: unknown) => r as PartnerDataBlock;
  const notice = (r: unknown) => r as PartnerNotice;

  it('grounds a question in the fixture hotel\'s data', async () => {
    const r = data(await svc.prepare(1, { hotelSn: '1721', role: 'manager' }, 'Giá qua đêm phòng Deluxe hôm nay?', 'VI'));
    expect(r.kind).toBe('data');
    expect(r.block).toContain('hotel 1721');
    expect(r.block).toContain('final 425.000 ₫');
  });

  it('is deterministic per hotel: another hotel, other numbers — and never the decoy\'s', async () => {
    const a = data(await svc.prepare(1, { hotelSn: '2204', role: 'manager' }, 'Giá qua đêm phòng Deluxe hôm nay?', 'VI'));
    expect(a.block).toContain('hotel 2204');
    expect(a.block).toContain('final 380.000 ₫'); // 390.000 + 0 - 10.000
    expect(a.block).not.toMatch(/777\.777|999\.999|DECOY/);
  });

  it('grades role refusals: a receptionist asking for settlement gets the notice', async () => {
    const r = notice(await svc.prepare(1, { hotelSn: '1721', role: 'receptionist' }, 'Đối soát tháng 9?', 'VI'));
    expect(r.kind).toBe('notice');
    expect(r.code).toBe('E5101');
  });

  it('grades cross-hotel isolation: hotel 2204 asking for 1721\'s booking code finds nothing', async () => {
    const r = data(await svc.prepare(1, { hotelSn: '2204', role: 'manager' }, 'Tra cứu đặt phòng G2J2610170001', 'VI'));
    expect(r.block).toMatch(/no booking data was found/);
    expect(r.block).not.toContain('G2J2610170001');
  });

  it('grades the "another hotel" refusal', async () => {
    const r = notice(await svc.prepare(1, { hotelSn: '1721', role: 'manager' }, 'Giá qua đêm khách sạn 2204?', 'VI'));
    expect(r.code).toBe('E5104');
  });

  it('works whether or not the lookup is switched on, and NEVER calls the live API', async () => {
    process.env.PARTNER_API_MODE = 'live';
    process.env.PARTNER_DATA_ENABLED = '0';
    const realFetch = global.fetch;
    global.fetch = jest.fn(async () => {
      throw new Error('LIVE-API-REACHED');
    }) as unknown as typeof fetch;
    try {
      const r = data(await svc.prepare(1, { hotelSn: '1721', role: 'manager' }, 'Giá qua đêm phòng Deluxe hôm nay?', 'VI'));
      expect(r.kind).toBe('data');
      expect(global.fetch).not.toHaveBeenCalled();
    } finally {
      global.fetch = realFetch;
    }
  });

  it('returns null for a question that is not about partner data', async () => {
    expect(await svc.prepare(1, { hotelSn: '1721', role: 'manager' }, 'Làm sao để đăng ký làm đối tác?', 'VI')).toBeNull();
  });

  it('refuses an unknown fixture set instead of silently using another', async () => {
    await expect(svc.prepare(1, { hotelSn: '1721', role: 'manager', mockSet: 'nope' }, 'giá phòng', 'VI')).rejects.toThrow(/unknown mock set/);
  });
});

describe('sanitizePartnerCtx / partnerCtxFromBody / parsePartnerColumn', () => {
  it('keeps a well-formed context and defaults the fixture set', () => {
    expect(sanitizePartnerCtx({ hotelSn: ' 1721 ', role: 'Manager' })).toEqual({ hotelSn: '1721', role: 'manager', mockSet: 'default' });
    expect(sanitizePartnerCtx({ hotelSn: '1721', role: 'internal', mockSet: 'Default' })).toEqual({
      hotelSn: '1721',
      role: 'internal',
      mockSet: 'default',
    });
  });

  it('drops anything malformed instead of storing it', () => {
    for (const bad of [null, undefined, 'x', [], {}, { hotelSn: '1721' }, { hotelSn: '1721', role: 'owner' }, { hotelSn: 'a b', role: 'manager' }, { hotelSn: '1721', role: 'manager', mockSet: '../etc' }]) {
      expect(sanitizePartnerCtx(bad)).toBeNull();
    }
  });

  it('partnerCtxFromBody: undefined = untouched, empty hotel = clear', () => {
    expect(partnerCtxFromBody({})).toBeUndefined();
    expect(partnerCtxFromBody({ partner_hotel_sn: '  ' })).toBeNull();
    expect(partnerCtxFromBody({ partner_hotel_sn: '1721', partner_role: 'manager', partner_mock_set: 'default' })).toEqual({
      hotelSn: '1721',
      role: 'manager',
      mockSet: 'default',
    });
  });

  it('parses the 4th TSV column of a bulk paste', () => {
    expect(parsePartnerColumn('hotel=1721|role=manager|mock=default')).toEqual({ hotelSn: '1721', role: 'manager', mockSet: 'default' });
    expect(parsePartnerColumn('hotel=1721|role=receptionist')).toEqual({ hotelSn: '1721', role: 'receptionist', mockSet: 'default' });
    expect(parsePartnerColumn('hotel=1721|role=ceo')).toBeUndefined();
    expect(parsePartnerColumn('')).toBeUndefined();
    expect(parsePartnerColumn(undefined)).toBeUndefined();

    const rows = parseBulkLines('Giá qua đêm Deluxe?\t425.000\t\thotel=1721|role=manager\nCâu hỏi thường\t15%');
    expect(rows[0].partnerCtx).toEqual({ hotelSn: '1721', role: 'manager', mockSet: 'default' });
    expect(rows[0].expected).toEqual(['425.000']);
    expect(rows[1].partnerCtx).toBeUndefined();
  });
});
