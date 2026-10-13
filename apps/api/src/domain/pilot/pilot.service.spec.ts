import { SESSION_IDENTITY } from '@sharptalk/types';
import type { IdentityClaims, PilotAccess } from '@sharptalk/types';
import { PILOT_CACHE_TTL_SEC, PilotService } from './pilot.service';
import { PILOT_NOTICE } from './pilot.messages';

/**
 * The runtime half of the pilot allowlist (PLN-261012 SG-40): which sessions the
 * list refuses, that a change is live without re-identifying, and that the
 * Redis snapshot behaves. Repositories and Redis are in-memory fakes.
 */

const HOURS = 3_600_000;

interface Fixture {
  pilotAccess: PilotAccess | null;
  /** Rows of tenant_pilot_hotels. */
  hotels: Array<{ hotelSn: string; active: number }>;
  identityPolicy?: { maxAgeHours?: number } | null;
}

function harness(initial: Partial<Fixture> = {}) {
  const fixture: Fixture = {
    pilotAccess: { enabled: true, guestAllowed: true, nonPilot: 'hide', notice: {} },
    hotels: [{ hotelSn: '1721', active: 1 }, { hotelSn: '2204', active: 1 }],
    ...initial,
  };
  const store = new Map<string, string>();
  const redis = {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    del: jest.fn(async (k: string) => void store.delete(k)),
  };
  const tenantRepo = {
    findOne: jest.fn(async () => ({
      id: 1,
      pilotAccess: fixture.pilotAccess,
      identityPolicy: fixture.identityPolicy,
    })),
  };
  const hotelRepo = {
    find: jest.fn(async () => fixture.hotels.filter((h) => h.active === 1).map((h) => ({ hotelSn: h.hotelSn }))),
  };
  const svc = new PilotService(tenantRepo as never, hotelRepo as never, redis as never);
  return { svc, fixture, store, redis, tenantRepo, hotelRepo };
}

const claims = (over: Partial<IdentityClaims> = {}): IdentityClaims => ({
  hotelSn: '1721',
  role: 'manager',
  signed: true,
  verifiedAt: new Date().toISOString(),
  ...over,
});

function session(over: Record<string, unknown> = {}) {
  return {
    id: 5,
    tenantId: 1,
    channel: null,
    language: 'VI',
    identityLevel: SESSION_IDENTITY.VERIFIED,
    identityClaims: claims(),
    ...over,
  } as never;
}

const guest = (over: Record<string, unknown> = {}) =>
  session({ identityLevel: SESSION_IDENTITY.GUEST, identityClaims: null, ...over });

describe('PilotService.denialFor — the enforcement matrix', () => {
  it('serves a signed hotel that is on the list', async () => {
    const { svc } = harness();
    expect(await svc.denialFor(session())).toBeNull();
  });

  it('refuses a signed hotel that is NOT on the list, with a soft notice', async () => {
    const { svc } = harness();
    const denial = await svc.denialFor(session({ identityClaims: claims({ hotelSn: '3307' }) }));
    expect(denial).toMatchObject({ reason: 'pilot_denied' });
    expect(denial?.body).toBe(PILOT_NOTICE.VI);
  });

  it('serves a guest while guestAllowed, refuses one when it is off', async () => {
    const open = harness();
    expect(await open.svc.denialFor(guest())).toBeNull();
    const closed = harness({ pilotAccess: { enabled: true, guestAllowed: false, nonPilot: 'hide', notice: {} } });
    expect(await closed.svc.denialFor(guest())).toMatchObject({ reason: 'pilot_denied' });
  });

  it('treats a v1 identity (a user, but no hotel) as a guest', async () => {
    const v1 = session({ identityLevel: SESSION_IDENTITY.VERIFIED, identityClaims: null });
    const open = harness();
    expect(await open.svc.denialFor(v1)).toBeNull();
    const closed = harness({ pilotAccess: { enabled: true, guestAllowed: false, nonPilot: 'hide', notice: {} } });
    expect(await closed.svc.denialFor(v1)).toMatchObject({ reason: 'pilot_denied' });
  });

  it('treats unsigned claims as a guest — an unsigned hotelSn must never match the list', async () => {
    // 1721 IS on the list; the claim just is not signed, so it must not count.
    const unsigned = session({ identityClaims: claims({ signed: false }) });
    const closed = harness({ pilotAccess: { enabled: true, guestAllowed: false, nonPilot: 'hide', notice: {} } });
    expect(await closed.svc.denialFor(unsigned)).toMatchObject({ reason: 'pilot_denied' });
    const open = harness();
    expect(await open.svc.denialFor(unsigned)).toBeNull(); // served — as a guest
  });

  it('treats an expired identity as a guest (tenant identity policy maxAgeHours)', async () => {
    const stale = session({ identityClaims: claims({ verifiedAt: new Date(Date.now() - 3 * HOURS).toISOString() }) });
    // On the list, but the signature is older than the policy allows → guest → refused (guests off).
    const closed = harness({
      pilotAccess: { enabled: true, guestAllowed: false, nonPilot: 'hide', notice: {} },
      identityPolicy: { maxAgeHours: 2 },
    });
    expect(await closed.svc.denialFor(stale)).toMatchObject({ reason: 'pilot_denied' });
    // The same claim within the policy window is trusted again.
    const fresh = harness({
      pilotAccess: { enabled: true, guestAllowed: false, nonPilot: 'hide', notice: {} },
      identityPolicy: { maxAgeHours: 6 },
    });
    expect(await fresh.svc.denialFor(stale)).toBeNull();
  });

  it('ages claims with the PLATFORM default when the tenant set no policy (same as every other gate — SG-03)', async () => {
    // 9 h old, no tenant policy: effectiveIdentity() lapses it after the 8 h default,
    // so the pilot must judge this visitor as a guest, not trust a hotel the rest
    // of the system already treats as signed out.
    const stale = session({ identityClaims: claims({ verifiedAt: new Date(Date.now() - 9 * HOURS).toISOString() }) });
    const closed = harness({ pilotAccess: { enabled: true, guestAllowed: false, nonPilot: 'hide', notice: {} } });
    expect(await closed.svc.denialFor(stale)).toMatchObject({ reason: 'pilot_denied' });
    const recent = session({ identityClaims: claims({ verifiedAt: new Date(Date.now() - 1 * HOURS).toISOString() }) });
    expect(await closed.svc.denialFor(recent)).toBeNull();
  });

  it('with the feature off — configured or not — nothing is refused and no list is read', async () => {
    for (const pilotAccess of [null, { enabled: false, guestAllowed: false, nonPilot: 'hide' as const, notice: {} }]) {
      const { svc, hotelRepo } = harness({ pilotAccess, hotels: [] });
      expect(await svc.denialFor(session({ identityClaims: claims({ hotelSn: '3307' }) }))).toBeNull();
      expect(await svc.denialFor(guest())).toBeNull();
      expect(hotelRepo.find).not.toHaveBeenCalled();
    }
  });

  it('is outside the rule for preview and messenger sessions (channel set)', async () => {
    const { svc, tenantRepo } = harness({
      pilotAccess: { enabled: true, guestAllowed: false, nonPilot: 'hide', notice: {} },
      hotels: [],
    });
    expect(await svc.denialFor(guest({ channel: 'preview' }))).toBeNull();
    expect(await svc.denialFor(guest({ channel: 'zalo' }))).toBeNull();
    expect(tenantRepo.findOne).not.toHaveBeenCalled();
  });

  it('a paused hotel is not served', async () => {
    const { svc } = harness({ hotels: [{ hotelSn: '1721', active: 0 }, { hotelSn: '2204', active: 1 }] });
    expect(await svc.denialFor(session())).toMatchObject({ reason: 'pilot_denied' });
  });

  it('uses the tenant notice for the session language, the built-in line for a language left blank', async () => {
    const { svc } = harness({
      pilotAccess: { enabled: true, guestAllowed: true, nonPilot: 'notice', notice: { VI: 'Chưa áp dụng cho khách sạn của bạn (pilot).' } },
    });
    const off = session({ identityClaims: claims({ hotelSn: '3307' }) });
    expect((await svc.denialFor(off))?.body).toBe('Chưa áp dụng cho khách sạn của bạn (pilot).');
    const english = session({ identityClaims: claims({ hotelSn: '3307' }), language: 'EN' });
    expect((await svc.denialFor(english))?.body).toBe(PILOT_NOTICE.EN);
    const japanese = session({ identityClaims: claims({ hotelSn: '3307' }), language: 'JA' });
    expect((await svc.denialFor(japanese))?.body).toBe(PILOT_NOTICE.JA);
  });

  it('fails closed: a database error is not "allowed"', async () => {
    const { svc, tenantRepo } = harness();
    tenantRepo.findOne.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.denialFor(session())).rejects.toThrow('db down');
  });
});

describe('PilotService — Redis snapshot', () => {
  it('reads the tenant and the list once, then serves from Redis for the TTL', async () => {
    const { svc, tenantRepo, hotelRepo, redis } = harness();
    await svc.denialFor(session());
    await svc.denialFor(session());
    await svc.denialFor(guest());
    expect(tenantRepo.findOne).toHaveBeenCalledTimes(1);
    expect(hotelRepo.find).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith('pilot:snap:1', expect.any(String), PILOT_CACHE_TTL_SEC);
    expect(PILOT_CACHE_TTL_SEC).toBe(60);
  });

  it('a hotel added to the list is served by the very next turn — no re-identify needed', async () => {
    const { svc, fixture } = harness();
    const s = session({ identityClaims: claims({ hotelSn: '3307' }) }); // the SAME session object throughout
    expect(await svc.denialFor(s)).not.toBeNull();

    fixture.hotels.push({ hotelSn: '3307', active: 1 });
    // Still the cached answer until the change invalidates it...
    expect(await svc.denialFor(s)).not.toBeNull();
    await svc.invalidate(1);
    // ...and then served, with the session untouched.
    expect(await svc.denialFor(s)).toBeNull();
  });

  it('a hotel removed from the list stops being served on the next turn after invalidation', async () => {
    const { svc, fixture } = harness();
    expect(await svc.denialFor(session())).toBeNull();
    fixture.hotels = fixture.hotels.filter((h) => h.hotelSn !== '1721');
    await svc.invalidate(1);
    expect(await svc.denialFor(session())).not.toBeNull();
  });

  it('switching the feature on or off is picked up after invalidation', async () => {
    const { svc, fixture } = harness({ pilotAccess: null });
    const off = session({ identityClaims: claims({ hotelSn: '3307' }) });
    expect(await svc.denialFor(off)).toBeNull();
    fixture.pilotAccess = { enabled: true, guestAllowed: true, nonPilot: 'hide', notice: {} };
    await svc.invalidate(1);
    expect(await svc.denialFor(off)).not.toBeNull();
  });

  it('invalidate deletes exactly the tenant key', async () => {
    const { svc, redis, store } = harness();
    await svc.snapshot(1);
    expect(store.has('pilot:snap:1')).toBe(true);
    await svc.invalidate(1);
    expect(redis.del).toHaveBeenCalledWith('pilot:snap:1');
    expect(store.has('pilot:snap:1')).toBe(false);
  });

  it('tenants never share a snapshot', async () => {
    const { svc, store } = harness();
    await svc.snapshot(1);
    await svc.snapshot(2);
    expect([...store.keys()].sort()).toEqual(['pilot:snap:1', 'pilot:snap:2']);
  });

  it('a corrupt cache entry is treated as a miss and rewritten', async () => {
    const { svc, store, tenantRepo } = harness();
    store.set('pilot:snap:1', '{not json');
    expect(await svc.denialFor(session())).toBeNull();
    expect(tenantRepo.findOne).toHaveBeenCalledTimes(1);
    expect(JSON.parse(store.get('pilot:snap:1') as string).hotels).toEqual(['1721', '2204']);
  });

  it('works without Redis — every call just reads the database', async () => {
    const { tenantRepo } = harness();
    const noRedis = { get: async () => null, set: async () => undefined, del: async () => undefined };
    const svc = new PilotService(tenantRepo as never, { find: async () => [{ hotelSn: '1721' }] } as never, noRedis as never);
    expect(await svc.denialFor(session())).toBeNull();
    expect(await svc.denialFor(session({ identityClaims: claims({ hotelSn: '3307' }) }))).not.toBeNull();
  });
});

describe('PilotService.statusFor / hintFor — what the widget is told', () => {
  it('eligible null when the tenant has no pilot list', async () => {
    const { svc } = harness({ pilotAccess: null });
    expect(await svc.statusFor(session())).toEqual({ eligible: null });
    expect(await svc.statusFor(guest())).toEqual({ eligible: null });
  });

  it('eligible true for a listed hotel and for an allowed guest', async () => {
    const { svc } = harness();
    expect(await svc.statusFor(session())).toEqual({ eligible: true });
    expect(await svc.statusFor(guest())).toEqual({ eligible: true });
  });

  it('eligible false carries the mode and the notice, hide by default', async () => {
    const { svc } = harness();
    const status = await svc.statusFor(session({ identityClaims: claims({ hotelSn: '3307' }) }));
    expect(status).toEqual({ eligible: false, mode: 'hide', notice: PILOT_NOTICE.VI });
  });

  it('carries mode notice and the tenant wording when the tenant chose to show a note', async () => {
    const { svc } = harness({
      pilotAccess: { enabled: true, guestAllowed: false, nonPilot: 'notice', notice: { VI: 'Chưa áp dụng.' } },
    });
    expect(await svc.statusFor(guest())).toEqual({ eligible: false, mode: 'notice', notice: 'Chưa áp dụng.' });
  });

  it('the widget verdict and the server gate are the same decision', async () => {
    const { svc } = harness();
    for (const s of [session(), session({ identityClaims: claims({ hotelSn: '3307' }) }), guest()]) {
      const status = await svc.statusFor(s);
      const denial = await svc.denialFor(s);
      expect(status.eligible === false).toBe(denial !== null);
    }
  });

  it('hintFor never throws: a failure reads as "no pilot list" so the page still loads', async () => {
    const { svc, tenantRepo } = harness();
    tenantRepo.findOne.mockRejectedValueOnce(new Error('db down'));
    expect(await svc.hintFor(session())).toEqual({ eligible: null });
  });
});
