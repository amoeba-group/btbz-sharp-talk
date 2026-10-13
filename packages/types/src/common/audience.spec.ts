import { AUDIENCE, AUDIENCE_RANK, audienceOf } from './audience';
import { SESSION_IDENTITY } from './enum.types';

/**
 * Who an answer is for (PLN-261012 SG-10 / SG-06). `audienceOf` is the only place
 * that turns an identity into a tier, and everything fail-closed hangs on it: a
 * wrong `manager` here shows settlement and bank-account topics to a receptionist.
 */
describe('audienceOf', () => {
  const verified = (claims: { signed?: boolean; role?: string } | null) => ({
    level: SESSION_IDENTITY.VERIFIED,
    claims,
  });

  it('a visitor who never signed in is public', () => {
    expect(audienceOf({ level: SESSION_IDENTITY.GUEST, claims: null })).toBe(AUDIENCE.PUBLIC);
  });

  it('claims that lapsed (effectiveIdentity reports a guest with no claims) are public', () => {
    // SG-03: past the max age effectiveIdentity() returns level guest + claims null.
    expect(audienceOf({ level: SESSION_IDENTITY.GUEST, claims: null })).toBe(AUDIENCE.PUBLIC);
  });

  it('a guest-level identity never reads above public, whatever claims ride along', () => {
    expect(audienceOf({ level: SESSION_IDENTITY.GUEST, claims: { signed: true, role: 'manager' } })).toBe(AUDIENCE.PUBLIC);
  });

  it.each([
    ['manager', AUDIENCE.MANAGER],
    ['internal', AUDIENCE.MANAGER],
    ['receptionist', AUDIENCE.PARTNER],
  ])('verified + signed role %s is %s', (role, expected) => {
    expect(audienceOf(verified({ signed: true, role }))).toBe(expected);
  });

  it('verified with no claims (a v1 identify, a Shopify or Cafe24 login) is partner — fail closed', () => {
    expect(audienceOf(verified(null))).toBe(AUDIENCE.PARTNER);
  });

  it('UNSIGNED claims never raise the tier: their role is not covered by the signature', () => {
    expect(audienceOf(verified({ signed: false, role: 'manager' }))).toBe(AUDIENCE.PARTNER);
    expect(audienceOf(verified({ role: 'manager' }))).toBe(AUDIENCE.PARTNER);
  });

  it.each(['admin', 'owner', 'MANAGER', 'Manager', ' manager', '', 'manager|1'])(
    'an unrecognised role %j is partner, not manager',
    (role) => {
      expect(audienceOf(verified({ signed: true, role }))).toBe(AUDIENCE.PARTNER);
    },
  );

  it('nothing at all is public', () => {
    expect(audienceOf(null)).toBe(AUDIENCE.PUBLIC);
    expect(audienceOf(undefined)).toBe(AUDIENCE.PUBLIC);
    expect(audienceOf({})).toBe(AUDIENCE.PUBLIC);
  });
});

describe('AUDIENCE / AUDIENCE_RANK', () => {
  it('has exactly the three tiers, spelled as stored in kb_categories.min_audience', () => {
    expect(AUDIENCE).toEqual({ PUBLIC: 'public', PARTNER: 'partner', MANAGER: 'manager' });
  });

  it('orders them public < partner < manager', () => {
    expect(AUDIENCE_RANK).toEqual({ public: 0, partner: 1, manager: 2 });
    expect(AUDIENCE_RANK.public).toBeLessThan(AUDIENCE_RANK.partner);
    expect(AUDIENCE_RANK.partner).toBeLessThan(AUDIENCE_RANK.manager);
  });
});
