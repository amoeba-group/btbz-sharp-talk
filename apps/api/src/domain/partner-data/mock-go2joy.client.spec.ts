import type { IdentityRole } from '@sharptalk/types';
import { partnerCtxOf } from './partner-ctx';
import { MockGo2JoyClient } from './mock-go2joy.client';
import { DEFAULT_MOCK_SET } from './fixtures/mock-set-default';

/**
 * The mock behaves the way the real API is REQUIRED to (PLN-261012 SG-31):
 * the hotel is the context's and nothing else, another hotel's data is
 * unreachable, and the reply echoes the hotel it was computed for.
 */
describe('MockGo2JoyClient', () => {
  const NOW = Date.parse('2026-10-13T02:00:00.000Z');
  const client = new MockGo2JoyClient(DEFAULT_MOCK_SET, () => NOW);
  const ctxFor = (hotelSn: string, role: IdentityRole = 'manager') =>
    partnerCtxOf({
      tenantId: 1,
      identityClaims: { hotelSn, role, signed: true, verifiedAt: new Date().toISOString() },
    });

  it('echoes the hotel of the context', async () => {
    for (const hotel of ['1721', '2204']) {
      const env = await client.get(ctxFor(hotel), 'policies', {});
      expect(env?.hotelSn).toBe(hotel);
      expect(env?.topic).toBe('policies');
    }
  });

  describe('cross-hotel isolation (decoy hotel 9999)', () => {
    const everything = async (hotel: string) => {
      const ctx = ctxFor(hotel);
      const replies = await Promise.all([
        client.get(ctx, 'policies', {}),
        client.get(ctx, 'rates', {}),
        client.get(ctx, 'bookings', { checkInFrom: '2026-10-01', checkInTo: '2026-10-31' }),
        client.get(ctx, 'settlement', {}),
      ]);
      return JSON.stringify(replies);
    };

    it('never returns the decoy hotel\'s data to hotel 1721 or 2204', async () => {
      for (const hotel of ['1721', '2204']) {
        const text = await everything(hotel);
        expect(text).not.toMatch(/DECOY|777777|999999|9999/);
      }
    });

    it('returns the decoy data only to the decoy hotel itself', async () => {
      expect(await everything('9999')).toContain('DECOY');
    });

    it('treats another hotel\'s booking code exactly like one that does not exist', async () => {
      // 1721 asks for 2204's code, and for the decoy's code, and for a made-up one.
      expect(await client.get(ctxFor('1721'), 'bookings', { bookingCode: 'BX2610170009' })).toBeNull();
      expect(await client.get(ctxFor('1721'), 'bookings', { bookingCode: 'DECOY2610170001' })).toBeNull();
      expect(await client.get(ctxFor('1721'), 'bookings', { bookingCode: 'NOPE000000' })).toBeNull();
      // ...while each hotel does find its own.
      expect((await client.get(ctxFor('2204'), 'bookings', { bookingCode: 'BX2610170009' }))?.data).toBeTruthy();
      expect((await client.get(ctxFor('1721'), 'bookings', { bookingCode: 'G2J2610170001' }))?.data).toBeTruthy();
    });

    it('treats an unknown hotel as not found', async () => {
      expect(await client.get(ctxFor('424242'), 'policies', {})).toBeNull();
    });
  });

  it('computes the weekend surcharge itself (Saturday 2026-10-17 vs Wednesday 2026-10-14)', async () => {
    const ctx = ctxFor('1721');
    const sat = await client.get(ctx, 'rates', { roomType: 'DELUXE', rateType: 'overnight', date: '2026-10-17' });
    const wed = await client.get(ctx, 'rates', { roomType: 'DELUXE', rateType: 'overnight', date: '2026-10-14' });
    const rate = (e: typeof sat) => (e!.data as { rates: Array<{ breakdown: { extraVnd: number; finalVnd: number } }> }).rates[0].breakdown;
    expect(rate(sat).extraVnd).toBe(50000);
    expect(rate(wed).extraVnd).toBe(0);
    expect(rate(sat).finalVnd - rate(wed).finalVnd).toBe(50000);
  });

  it('filters bookings by range / status and pages them', async () => {
    const ctx = ctxFor('1721');
    const range = await client.get(ctx, 'bookings', { checkInFrom: '2026-10-15', checkInTo: '2026-10-17' });
    expect((range!.data as { bookings: unknown[] }).bookings).toHaveLength(2);
    const cancelled = await client.get(ctx, 'bookings', { checkInFrom: '2026-10-01', checkInTo: '2026-10-31', status: 'cancelled' });
    expect((cancelled!.data as { bookings: Array<{ bookingCode: string }> }).bookings.map((b) => b.bookingCode)).toEqual(['2610140000123456']);
    const paged = await client.get(ctx, 'bookings', { checkInFrom: '2026-10-01', checkInTo: '2026-10-31', size: 1, page: 2 });
    expect((paged!.data as { bookings: Array<{ bookingCode: string }>; page: { total: number } }).page.total).toBe(3);
    expect((paged!.data as { bookings: unknown[] }).bookings).toHaveLength(1);
  });

  it('serves settlement newest first and filters by period', async () => {
    const ctx = ctxFor('1721');
    const all = await client.get(ctx, 'settlement', {});
    expect((all!.data as { settlements: Array<{ period: string }> }).settlements.map((s) => s.period)).toEqual(['2026-09', '2026-08']);
    const one = await client.get(ctx, 'settlement', { period: '2026-08' });
    expect((one!.data as { settlements: unknown[] }).settlements).toHaveLength(1);
  });

  it('hands out copies: mutating a reply cannot change the fixture', async () => {
    const ctx = ctxFor('1721');
    const first = await client.get(ctx, 'policies', {});
    (first!.data as { policies: unknown[] }).policies.length = 0;
    const second = await client.get(ctx, 'policies', {});
    expect((second!.data as { policies: unknown[] }).policies.length).toBe(3);
  });
});
