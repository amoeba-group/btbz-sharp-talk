import { audienceOf } from '@sharptalk/types';
import { effectiveIdentity } from './identity.util';

/**
 * `audienceOf(effectiveIdentity(session))` — the one line every access-tier decision starts
 * from (PLN-261012 SG-10). Run through the REAL effectiveIdentity so the SG-03 aging and the
 * tier mapping are proved together, not each against a hand-made identity.
 */
describe('audienceOf(effectiveIdentity(session))', () => {
  const HOUR = 3_600_000;
  const NOW = Date.parse('2026-10-13T12:00:00.000Z');
  const session = (over: Record<string, unknown> = {}) => ({
    identityLevel: 'verified',
    customerId: 100,
    identityClaims: {
      hotelSn: '1721',
      role: 'manager',
      signed: true,
      verifiedAt: new Date(NOW - HOUR).toISOString(),
    },
    ...over,
  });
  const tier = (s: ReturnType<typeof session>, policy?: { maxAgeHours: number }) =>
    audienceOf(effectiveIdentity(s as never, policy ?? null, NOW, ''));

  it('a guest is public', () => {
    expect(tier(session({ identityLevel: 'guest', customerId: null, identityClaims: null }))).toBe('public');
  });

  it('a manager with fresh claims is manager; a receptionist is partner; internal is manager', () => {
    expect(tier(session())).toBe('manager');
    expect(tier(session({ identityClaims: { ...session().identityClaims, role: 'receptionist' } }))).toBe('partner');
    expect(tier(session({ identityClaims: { ...session().identityClaims, role: 'internal' } }))).toBe('manager');
  });

  it('a v1-verified user (verified, no claims) is partner — never manager', () => {
    expect(tier(session({ identityClaims: null }))).toBe('partner');
  });

  it('claims past the max age read as public, however senior the role', () => {
    const old = session({ identityClaims: { ...session().identityClaims, verifiedAt: new Date(NOW - 9 * HOUR).toISOString() } });
    expect(tier(old)).toBe('public');
  });

  it('the boundary: exactly at the limit is still valid, one millisecond past is not', () => {
    const at = session({ identityClaims: { ...session().identityClaims, verifiedAt: new Date(NOW - 8 * HOUR).toISOString() } });
    const past = session({ identityClaims: { ...session().identityClaims, verifiedAt: new Date(NOW - 8 * HOUR - 1).toISOString() } });
    expect(tier(at)).toBe('manager');
    expect(tier(past)).toBe('public');
  });

  it('the tenant policy moves the limit, and so the tier', () => {
    const nineHours = session({ identityClaims: { ...session().identityClaims, verifiedAt: new Date(NOW - 9 * HOUR).toISOString() } });
    expect(tier(nineHours, { maxAgeHours: 12 })).toBe('manager');
    expect(tier(session(), { maxAgeHours: 1 })).toBe('manager');
    const twoHours = session({ identityClaims: { ...session().identityClaims, verifiedAt: new Date(NOW - 2 * HOUR).toISOString() } });
    expect(tier(twoHours, { maxAgeHours: 1 })).toBe('public');
  });

  it('claims whose date cannot be read are lapsed, so public (fail closed)', () => {
    expect(tier(session({ identityClaims: { ...session().identityClaims, verifiedAt: 'not a date' } }))).toBe('public');
  });
});
