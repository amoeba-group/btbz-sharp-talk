import {
  IDENTITY_MAX_AGE_HOURS_DEFAULT,
  IdentityPolicyCache,
  effectiveIdentity,
  platformMaxAgeMs,
  resolveMaxAgeMs,
} from './identity.util';

/**
 * Signed identity as a decision-maker sees it (PLN-261012 SG-03, REQ D-04).
 *
 * The property: claims older than the max age read as a guest, everywhere, from ONE
 * function — and nothing else is ever aged (v1, platform logins, guests).
 */
const HOUR = 3_600_000;
const NOW = Date.parse('2026-10-13T08:00:00.000Z');

const claims = (verifiedAtMs: number | string | undefined, over: Record<string, unknown> = {}) =>
  ({
    hotelSn: '1721',
    role: 'receptionist',
    hotelName: 'A In Hotel Del Luna',
    signed: true,
    verifiedAt: typeof verifiedAtMs === 'number' ? new Date(verifiedAtMs).toISOString() : verifiedAtMs,
    ...over,
  }) as never;

const session = (verifiedAtMs: number | string | undefined, over: Record<string, unknown> = {}) => ({
  identityLevel: 'verified',
  customerId: 100,
  identityClaims: claims(verifiedAtMs),
  ...over,
});

describe('platformMaxAgeMs (IDENTITY_MAX_AGE_HOURS)', () => {
  it('defaults to 8 hours', () => {
    expect(platformMaxAgeMs(undefined)).toBe(IDENTITY_MAX_AGE_HOURS_DEFAULT * HOUR);
    expect(platformMaxAgeMs('')).toBe(8 * HOUR);
    expect(platformMaxAgeMs('   ')).toBe(8 * HOUR);
  });

  it('honours an operator value', () => {
    expect(platformMaxAgeMs('4')).toBe(4 * HOUR);
    expect(platformMaxAgeMs('0.5')).toBe(HOUR / 2);
  });

  it('0 is the emergency kill switch: expiry off platform-wide', () => {
    expect(platformMaxAgeMs('0')).toBeNull();
  });

  it('a typo never switches a security control off: garbage falls back to the default', () => {
    for (const bad of ['abc', '-3', 'NaN', '8h', 'Infinity']) {
      expect(platformMaxAgeMs(bad)).toBe(8 * HOUR);
    }
  });

  it('reads the real env var when no value is passed', () => {
    const before = process.env.IDENTITY_MAX_AGE_HOURS;
    try {
      process.env.IDENTITY_MAX_AGE_HOURS = '3';
      expect(platformMaxAgeMs()).toBe(3 * HOUR);
      delete process.env.IDENTITY_MAX_AGE_HOURS;
      expect(platformMaxAgeMs()).toBe(8 * HOUR);
    } finally {
      if (before === undefined) delete process.env.IDENTITY_MAX_AGE_HOURS;
      else process.env.IDENTITY_MAX_AGE_HOURS = before;
    }
  });
});

describe('resolveMaxAgeMs (tenant override → platform default)', () => {
  it('a tenant with no policy gets the platform default', () => {
    expect(resolveMaxAgeMs(null, '8')).toBe(8 * HOUR);
    expect(resolveMaxAgeMs(undefined, '5')).toBe(5 * HOUR);
    expect(resolveMaxAgeMs({}, '5')).toBe(5 * HOUR);
  });

  it('the tenant override wins, even over a platform kill switch', () => {
    expect(resolveMaxAgeMs({ maxAgeHours: 2 }, '8')).toBe(2 * HOUR);
    expect(resolveMaxAgeMs({ maxAgeHours: 2 }, '0')).toBe(2 * HOUR);
  });

  it('an invalid stored override is ignored rather than trusted (0, huge, fractional)', () => {
    for (const maxAgeHours of [0, 100000, 2.5, -1]) {
      expect(resolveMaxAgeMs({ maxAgeHours }, '8')).toBe(8 * HOUR);
    }
  });
});

describe('effectiveIdentity', () => {
  it('claims inside the max age stay in force', () => {
    const id = effectiveIdentity(session(NOW - 7 * HOUR), null, NOW, '8');

    expect(id).toMatchObject({ level: 'verified', customerId: 100, expired: false });
    expect(id.claims).toMatchObject({ hotelSn: '1721', role: 'receptionist' });
    expect(id.expiresAt).toBe(new Date(NOW + HOUR).toISOString());
  });

  it('claims past the max age read as a guest: no claims, no customer, level guest', () => {
    const id = effectiveIdentity(session(NOW - 9 * HOUR), null, NOW, '8');

    expect(id).toMatchObject({ level: 'guest', claims: null, customerId: null, expired: true });
    expect(id.expiresAt).toBe(new Date(NOW - HOUR).toISOString());
  });

  describe('the boundary: strictly older than the max age is expired', () => {
    it('exactly at the max age is still valid', () => {
      expect(effectiveIdentity(session(NOW - 8 * HOUR), null, NOW, '8').expired).toBe(false);
    });
    it('one millisecond past it is expired', () => {
      expect(effectiveIdentity(session(NOW - 8 * HOUR - 1), null, NOW, '8').expired).toBe(true);
    });
    it('one millisecond before it is valid', () => {
      expect(effectiveIdentity(session(NOW - 8 * HOUR + 1), null, NOW, '8').expired).toBe(false);
    });
  });

  it('a verifiedAt in the future (clock skew between instances) is not aged', () => {
    expect(effectiveIdentity(session(NOW + 5 * 60_000), null, NOW, '8').expired).toBe(false);
  });

  it('fails closed on a signed claim whose verifiedAt cannot be read', () => {
    for (const bad of ['x', '', undefined, 'not-a-date']) {
      const id = effectiveIdentity(session(bad), null, NOW, '8');
      expect(id).toMatchObject({ level: 'guest', claims: null, customerId: null, expired: true, expiresAt: null });
    }
  });

  it('the tenant policy changes the limit for that tenant only', () => {
    const s = session(NOW - 3 * HOUR);
    expect(effectiveIdentity(s, { maxAgeHours: 2 }, NOW, '8').expired).toBe(true);
    expect(effectiveIdentity(s, { maxAgeHours: 4 }, NOW, '8').expired).toBe(false);
    expect(effectiveIdentity(s, null, NOW, '8').expired).toBe(false);
  });

  it('IDENTITY_MAX_AGE_HOURS=0 switches expiry off: ancient claims stay in force', () => {
    const id = effectiveIdentity(session(NOW - 400 * HOUR), null, NOW, '0');
    expect(id).toMatchObject({ level: 'verified', expired: false, expiresAt: null });
  });

  describe('what is NEVER aged', () => {
    it('a v1 identity (verified, no claims) is reported as stored', () => {
      const id = effectiveIdentity({ identityLevel: 'verified', customerId: 7, identityClaims: null }, null, NOW, '8');
      expect(id).toMatchObject({ level: 'verified', customerId: 7, claims: null, expired: false, expiresAt: null });
    });

    it('a platform login (Shopify / Cafe24: verified, no claims) is reported as stored', () => {
      const id = effectiveIdentity({ identityLevel: 'verified', customerId: 9, identityClaims: null }, null, NOW + 999 * HOUR, '8');
      expect(id.expired).toBe(false);
      expect(id.level).toBe('verified');
    });

    it('a guest stays a guest', () => {
      const id = effectiveIdentity({ identityLevel: 'guest', customerId: null, identityClaims: null }, null, NOW, '8');
      expect(id).toMatchObject({ level: 'guest', customerId: null, expired: false });
    });

    it('claims that were never signed are not aged (nothing vouched for them in the first place)', () => {
      const unsigned = { identityLevel: 'verified', customerId: 1, identityClaims: claims(NOW - 100 * HOUR, { signed: false }) };
      expect(effectiveIdentity(unsigned, null, NOW, '8').expired).toBe(false);
    });

    it('a missing identityLevel reads as guest rather than throwing', () => {
      expect(effectiveIdentity({ identityClaims: null }, null, NOW, '8').level).toBe('guest');
    });
  });

  it('numeric-string customer ids (bigint columns) come back as numbers', () => {
    const id = effectiveIdentity(session(NOW, { customerId: '100' }), null, NOW, '8');
    expect(id.customerId).toBe(100);
  });

  it('returns the very claims object it was given while in force (callers compare by reference)', () => {
    const s = session(NOW - HOUR);
    expect(effectiveIdentity(s, null, NOW, '8').claims).toBe(s.identityClaims);
  });
});

describe('IdentityPolicyCache', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(NOW));
  afterEach(() => jest.useRealTimers());

  it('reads a tenant once inside the window, then again after it', async () => {
    const load = jest.fn(async () => ({ maxAgeHours: 4 }));
    const cache = new IdentityPolicyCache(load, 15_000);

    expect(await cache.get(1)).toEqual({ maxAgeHours: 4 });
    expect(await cache.get(1)).toEqual({ maxAgeHours: 4 });
    expect(load).toHaveBeenCalledTimes(1);

    jest.setSystemTime(NOW + 16_000);
    await cache.get(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps tenants apart', async () => {
    const cache = new IdentityPolicyCache(async (id) => (id === 1 ? { maxAgeHours: 4 } : { refuseV1: true }));
    expect(await cache.get(1)).toEqual({ maxAgeHours: 4 });
    expect(await cache.get(2)).toEqual({ refuseV1: true });
  });

  it('normalises what it loads — a junk column reads as "no policy"', async () => {
    const cache = new IdentityPolicyCache(async () => ({ maxAgeHours: 0, refuseV1: 'yes' }));
    expect(await cache.get(1)).toBeNull();
  });

  it('a failed read is NOT cached and reads as no policy (platform default applies)', async () => {
    const load = jest.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce({ maxAgeHours: 4 });
    const cache = new IdentityPolicyCache(load);

    expect(await cache.get(1)).toBeNull();
    expect(await cache.get(1)).toEqual({ maxAgeHours: 4 });
  });

  it('invalidate() forgets one tenant', async () => {
    const load = jest.fn(async () => ({ maxAgeHours: 4 }));
    const cache = new IdentityPolicyCache(load);
    await cache.get(1);
    cache.invalidate(1);
    await cache.get(1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a missing tenant id is no policy and costs no read', async () => {
    const load = jest.fn();
    const cache = new IdentityPolicyCache(load);
    expect(await cache.get(null)).toBeNull();
    expect(await cache.get(undefined)).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
});
