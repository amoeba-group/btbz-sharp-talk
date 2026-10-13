import {
  IDENTITY_MAX_AGE_HOURS_MAX,
  IDENTITY_MAX_AGE_HOURS_MIN,
  normalizeIdentityPolicy,
} from './identity-policy';

/**
 * `tenants.identity_policy` (PLN-261012 SG-03/04). NULL must keep meaning "never
 * configured" — the same behaviour every tenant had before the column existed.
 */
describe('normalizeIdentityPolicy', () => {
  it('reads anything that is not an object as "no policy"', () => {
    for (const v of [null, undefined, 0, 'x', [], true]) {
      expect(normalizeIdentityPolicy(v)).toBeNull();
    }
  });

  it('an object that sets nothing collapses to null, not to an empty policy', () => {
    expect(normalizeIdentityPolicy({})).toBeNull();
    expect(normalizeIdentityPolicy({ maxAgeHours: null, refuseV1: false })).toBeNull();
  });

  it('keeps a valid hour count and the v1 refusal', () => {
    expect(normalizeIdentityPolicy({ maxAgeHours: 4 })).toEqual({ maxAgeHours: 4 });
    expect(normalizeIdentityPolicy({ refuseV1: true })).toEqual({ refuseV1: true });
    expect(normalizeIdentityPolicy({ maxAgeHours: 12, refuseV1: true })).toEqual({
      maxAgeHours: 12,
      refuseV1: true,
    });
  });

  it('drops an out-of-range or non-integer hour count instead of trusting it', () => {
    // 0 and 1e9 would switch the expiry off by accident; the field must not be able to.
    for (const bad of [0, -3, 0.5, 2.5, NaN, Infinity, IDENTITY_MAX_AGE_HOURS_MAX + 1, 1e9, 'eight']) {
      expect(normalizeIdentityPolicy({ maxAgeHours: bad })).toBeNull();
    }
  });

  it('accepts both bounds', () => {
    expect(normalizeIdentityPolicy({ maxAgeHours: IDENTITY_MAX_AGE_HOURS_MIN })).toEqual({
      maxAgeHours: IDENTITY_MAX_AGE_HOURS_MIN,
    });
    expect(normalizeIdentityPolicy({ maxAgeHours: IDENTITY_MAX_AGE_HOURS_MAX })).toEqual({
      maxAgeHours: IDENTITY_MAX_AGE_HOURS_MAX,
    });
  });

  it('refuseV1 is true only for the boolean true — a string "false" is not a switch', () => {
    expect(normalizeIdentityPolicy({ refuseV1: 'true' })).toBeNull();
    expect(normalizeIdentityPolicy({ refuseV1: 1 })).toBeNull();
    expect(normalizeIdentityPolicy({ refuseV1: 'false', maxAgeHours: 3 })).toEqual({ maxAgeHours: 3 });
  });

  it('ignores unknown keys', () => {
    expect(normalizeIdentityPolicy({ maxAgeHours: 3, extra: 'x' })).toEqual({ maxAgeHours: 3 });
  });
});
