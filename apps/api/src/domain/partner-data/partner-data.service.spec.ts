import type { IdentityRole } from '@sharptalk/types';
import { MockGo2JoyClient } from './mock-go2joy.client';
import { PartnerDataService } from './partner-data.service';
import type { PartnerApiClient, PartnerEnvelope } from './partner-api.client';
import { partnerCtxOf } from './partner-ctx';
import type { PartnerCtx } from './partner-ctx';
import { partnerError } from './partner-data.constants';
import { PartnerLookupLogService } from './partner-lookup-log.service';
import { DEFAULT_MOCK_SET } from './fixtures/mock-set-default';

/**
 * PartnerDataService.resolve(ctx, topic, params) — the single door to partner
 * data (PLN-261012 SG-31). These pin the safety properties, each of which has a
 * mutation check in the TCR (remove it and a test here must go red).
 */
describe('PartnerDataService.resolve', () => {
  const NOW = Date.parse('2026-10-13T02:00:00.000Z');
  const ctxFor = (hotelSn: string, role: IdentityRole = 'manager'): PartnerCtx =>
    partnerCtxOf({
      tenantId: 1,
      identityClaims: { hotelSn, role, signed: true, verifiedAt: new Date().toISOString() },
    });

  const build = (client: PartnerApiClient = new MockGo2JoyClient(DEFAULT_MOCK_SET, () => NOW)) => {
    const record = jest.fn(async (_entry: unknown) => undefined);
    const logs = { record } as unknown as PartnerLookupLogService;
    const get = jest.spyOn(client, 'get');
    return { svc: new PartnerDataService(client, logs), get, record, client };
  };

  const logged = (record: jest.Mock, i = 0) => record.mock.calls[i][0] as Record<string, unknown>;

  describe('a hotel identifier in the arguments is rejected (E5104) — and nothing is requested', () => {
    it.each([
      { hotelSn: '2204' },
      { hotel_id: '2204' },
      { hotelId: 2204 },
      { 'Hotel-SN': '2204' },
      { propertyId: '9999' },
      { tenant_id: 3 },
      { type: 'refund', hotelSn: '2204' },
    ])('rejects %j', async (params) => {
      const { svc, get, record } = build();
      const res = await svc.resolve(ctxFor('1721'), 'policies', params);
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('E5104');
      expect(res.error.reason).toBe('hotel_param');
      expect(res.status).toBe('rejected');
      expect(get).not.toHaveBeenCalled();
      // logged by KEY, never by value
      const row = logged(record);
      expect(row.status).toBe('rejected');
      expect(row.errorCode).toBe('E5104');
      expect(row.rejectedKeys).toBeDefined();
      expect(JSON.stringify(row)).not.toMatch(/2204|9999/);
    });

    it('rejects it on every topic', async () => {
      for (const topic of ['policies', 'rates', 'bookings', 'settlement']) {
        const { svc, get } = build();
        const res = await svc.resolve(ctxFor('1721'), topic, { hotelSn: '2204' });
        expect(res.ok).toBe(false);
        expect(get).not.toHaveBeenCalled();
      }
    });
  });

  describe('topic allow-list and role allow-list', () => {
    it('refuses an unknown topic (E5103) without a request', async () => {
      const { svc, get } = build();
      const res = await svc.resolve(ctxFor('1721'), 'guests', {});
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('E5103');
      expect(get).not.toHaveBeenCalled();
    });

    it('denies a receptionist the settlement topic (E5101) before any request', async () => {
      const { svc, get, record } = build();
      const res = await svc.resolve(ctxFor('1721', 'receptionist'), 'settlement', {});
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('E5101');
      expect(res.status).toBe('denied');
      expect(get).not.toHaveBeenCalled();
      expect(logged(record)).toMatchObject({ status: 'denied', errorCode: 'E5101', role: 'receptionist', hotelSn: '1721' });
    });

    it('lets a manager and an internal user read settlement', async () => {
      for (const role of ['manager', 'internal'] as const) {
        const { svc } = build();
        const res = await svc.resolve(ctxFor('1721', role), 'settlement', { period: '2026-09' });
        expect(res.ok).toBe(true);
      }
    });

    it('lets a receptionist read rates, policies and bookings', async () => {
      const { svc } = build();
      expect((await svc.resolve(ctxFor('1721', 'receptionist'), 'rates', { rateType: 'overnight' })).ok).toBe(true);
      expect((await svc.resolve(ctxFor('1721', 'receptionist'), 'policies', {})).ok).toBe(true);
      expect((await svc.resolve(ctxFor('1721', 'receptionist'), 'bookings', { bookingCode: 'G2J2610170001' })).ok).toBe(true);
    });
  });

  describe('cross-hotel isolation', () => {
    it('hotel 2204 asking for hotel 1721\'s booking code finds nothing — an empty view, no data', async () => {
      const { svc } = build();
      const res = await svc.resolve(ctxFor('2204'), 'bookings', { bookingCode: 'G2J2610170001' });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.view.items).toEqual([]);
      expect(res.evidence.itemCount).toBe(0);
      expect(svc.render(res.view, 'EN').lines[0]).toMatch(/no booking data was found/);
    });

    it('no topic for hotel 1721 or 2204 ever carries the decoy hotel\'s data', async () => {
      const { svc } = build();
      for (const hotel of ['1721', '2204']) {
        const all = await Promise.all([
          svc.resolve(ctxFor(hotel), 'policies', {}),
          svc.resolve(ctxFor(hotel), 'rates', {}),
          svc.resolve(ctxFor(hotel), 'bookings', { checkInFrom: '2026-10-01', checkInTo: '2026-10-31' }),
          svc.resolve(ctxFor(hotel), 'settlement', {}),
        ]);
        expect(JSON.stringify(all)).not.toMatch(/DECOY|777777|999999/);
      }
    });

    it('drops a reply whose echoed hotel is not the context\'s (E5105)', async () => {
      const inner = new MockGo2JoyClient(DEFAULT_MOCK_SET, () => NOW);
      // A buggy / hostile upstream: answers as hotel 2204 whoever asked.
      const wrong: PartnerApiClient = {
        mode: 'mock',
        get: async (ctx, topic, query): Promise<PartnerEnvelope | null> => {
          const env = await inner.get(partnerCtxOf({ tenantId: 1, identityClaims: { hotelSn: '2204', role: 'manager', signed: true, verifiedAt: new Date().toISOString() } }), topic, query);
          return env;
        },
      };
      const { svc, record } = build(wrong);
      const res = await svc.resolve(ctxFor('1721'), 'policies', {});
      expect(res.ok).toBe(false);
      if (res.ok) return;
      expect(res.error.code).toBe('E5105');
      expect(res.error.reason).toBe('hotel_echo_mismatch');
      expect(logged(record)).toMatchObject({ status: 'error', errorCode: 'E5105' });
    });
  });

  describe('replies are validated, not trusted', () => {
    const upstream = (data: unknown, over: Partial<PartnerEnvelope> = {}): PartnerApiClient => ({
      mode: 'mock',
      get: async (ctx, topic) => ({ apiVersion: '0', hotelSn: ctx.hotelSn, topic, generatedAt: '2026-10-13T09:00:00+07:00', data, ...over }),
    });

    it('drops a reply whose money does not add up (E5105)', async () => {
      const { svc } = build(
        upstream({
          currency: 'VND',
          rates: [
            {
              roomType: 'DELUXE',
              rateType: 'overnight',
              date: '2026-10-17',
              breakdown: { baseVnd: 450000, extraVnd: 0, directDiscountVnd: 0, flashSaleVnd: 0, couponVnd: 0, finalVnd: 400000 },
            },
          ],
        }),
      );
      const res = await svc.resolve(ctxFor('1721'), 'rates', {});
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.reason).toBe('breakdown_invariant');
    });

    it('drops a reply with a malformed generatedAt or wrong topic', async () => {
      const bad = build(upstream({ policies: [] }, { generatedAt: 'yesterday' }));
      const res = await bad.svc.resolve(ctxFor('1721'), 'policies', {});
      expect(res.ok).toBe(false);
      const wrongTopic = build(upstream({ policies: [] }, { topic: 'rates' }));
      const res2 = await wrongTopic.svc.resolve(ctxFor('1721'), 'policies', {});
      expect(res2.ok).toBe(false);
    });

    it('never lets guest PII from a careless upstream into the view', async () => {
      const { svc } = build();
      const res = await svc.resolve(ctxFor('1721'), 'bookings', { bookingCode: 'G2J2610170001' });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const text = JSON.stringify(res.view) + svc.render(res.view, 'VI').lines.join('\n');
      expect(text).not.toMatch(/Nguyen|0901234567|VIP/);
    });
  });

  describe('success', () => {
    it('returns the view, evidence with a snapshot hash, and logs it', async () => {
      const { svc, record } = build();
      const res = await svc.resolve(ctxFor('1721'), 'rates', { roomType: 'DELUXE', rateType: 'overnight', date: '2026-10-17' }, {
        conversationId: 11,
        messageId: 22,
        sessionId: 33,
      });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.evidence).toMatchObject({
        topic: 'rates',
        hotelSn: '1721',
        role: 'manager',
        source: 'mock',
        apiVersion: '0',
        itemCount: 1,
        params: { date: '2026-10-17', rateType: 'overnight', roomType: 'DELUXE' },
      });
      expect(res.evidence.snapshotHash).toMatch(/^[0-9a-f]{64}$/);
      expect(res.evidence.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const lines = svc.render(res.view, 'VI').lines.join('\n');
      expect(lines).toContain('final 475.000 ₫');
      expect(logged(record)).toMatchObject({
        status: 'ok',
        topic: 'rates',
        hotelSn: '1721',
        role: 'manager',
        conversationId: 11,
        messageId: 22,
        sessionId: 33,
        source: 'mock',
        snapshotHash: res.evidence.snapshotHash,
      });
    });

    it('the snapshot hash follows the DATA: same data, same hash; different hotel data, different hash', async () => {
      const { svc } = build();
      const a = await svc.resolve(ctxFor('1721'), 'settlement', {});
      const b = await svc.resolve(ctxFor('1721'), 'settlement', {});
      const c = await svc.resolve(ctxFor('2204'), 'settlement', {});
      if (!a.ok || !b.ok || !c.ok) throw new Error('expected success');
      expect(a.evidence.snapshotHash).toBe(b.evidence.snapshotHash);
      expect(a.evidence.snapshotHash).not.toBe(c.evidence.snapshotHash);
    });
  });

  describe('it never throws', () => {
    it('turns an upstream PartnerError into a classified result', async () => {
      const down: PartnerApiClient = { mode: 'live', get: async () => { throw partnerError.unavailable('upstream_timeout'); } };
      const { svc, record } = build(down);
      const res = await svc.resolve(ctxFor('1721'), 'policies', {});
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.error.code).toBe('E5100');
        expect(res.status).toBe('error');
      }
      expect(logged(record)).toMatchObject({ status: 'error', errorCode: 'E5100', reason: 'upstream_timeout', source: 'live' });
    });

    it('turns an unexpected exception into E5100 and does not rethrow it', async () => {
      const broken: PartnerApiClient = { mode: 'mock', get: async () => { throw new TypeError('boom'); } };
      const { svc } = build(broken);
      const res = await svc.resolve(ctxFor('1721'), 'policies', {});
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('E5100');
    });

    it('is unaffected by a database that cannot take the log row (the real log service swallows it)', async () => {
      const client = new MockGo2JoyClient(DEFAULT_MOCK_SET, () => NOW);
      const dead = new PartnerLookupLogService({
        create: (x: unknown) => x,
        save: async () => {
          throw new Error('db down');
        },
      } as never);
      const svc = new PartnerDataService(client, dead);
      expect((await svc.resolve(ctxFor('1721'), 'policies', {})).ok).toBe(true);
      const denied = await svc.resolve(ctxFor('1721', 'receptionist'), 'settlement', {});
      expect(denied.ok).toBe(false); // still a classified result, not an exception
    });
  });
});
