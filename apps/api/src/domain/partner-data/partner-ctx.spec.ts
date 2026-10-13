import type { IdentityClaims } from '@sharptalk/types';
import { PartnerError } from './partner-data.constants';
import { partnerClaimsMaxAgeMs, partnerCtxOf } from './partner-ctx';

/**
 * The only way to get a PartnerCtx is a session whose identity claims were
 * SIGNED and are still fresh (PLN-261012 SG-31). Nothing else can name a hotel.
 */
describe('partnerCtxOf', () => {
  const NOW = Date.parse('2026-10-13T09:00:00.000Z');
  const claims = (over: Partial<IdentityClaims> = {}): IdentityClaims => ({
    hotelSn: '1721',
    role: 'manager',
    signed: true,
    verifiedAt: new Date(NOW - 60_000).toISOString(),
    ...over,
  });
  const session = (c: IdentityClaims | null, tenantId: number | null = 7) => ({ tenantId, identityClaims: c });

  const refused = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(PartnerError);
      expect((e as PartnerError).code).toBe('E5102');
      return (e as PartnerError).reason;
    }
    throw new Error('expected the claims to be refused');
  };

  afterEach(() => {
    delete process.env.PARTNER_CLAIMS_MAX_AGE_SEC;
  });

  it('builds a context from signed, fresh claims — hotel and role from the claims only', () => {
    const ctx = partnerCtxOf(session(claims()), NOW);
    expect(ctx.tenantId).toBe(7);
    expect(ctx.hotelSn).toBe('1721');
    expect(ctx.role).toBe('manager');
    expect(ctx.verifiedAtMs).toBe(NOW - 60_000);
  });

  it('refuses a session with no claims at all (a guest / identify v1)', () => {
    expect(refused(() => partnerCtxOf(session(null), NOW))).toBe('claims_unsigned');
  });

  it('refuses UNSIGNED claims, however complete they look', () => {
    expect(refused(() => partnerCtxOf(session(claims({ signed: false })), NOW))).toBe('claims_unsigned');
  });

  it('refuses claims older than the maximum age (default 8 h)', () => {
    const old = claims({ verifiedAt: new Date(NOW - 8 * 3600_000 - 1000).toISOString() });
    expect(refused(() => partnerCtxOf(session(old), NOW))).toBe('claims_expired');
    const justInside = claims({ verifiedAt: new Date(NOW - 8 * 3600_000 + 1000).toISOString() });
    expect(partnerCtxOf(session(justInside), NOW).hotelSn).toBe('1721');
  });

  it('honours PARTNER_CLAIMS_MAX_AGE_SEC', () => {
    process.env.PARTNER_CLAIMS_MAX_AGE_SEC = '60';
    expect(partnerClaimsMaxAgeMs()).toBe(60_000);
    expect(refused(() => partnerCtxOf(session(claims({ verifiedAt: new Date(NOW - 120_000).toISOString() })), NOW))).toBe(
      'claims_expired',
    );
  });

  it('refuses a verifiedAt in the future or one that cannot be parsed', () => {
    expect(refused(() => partnerCtxOf(session(claims({ verifiedAt: new Date(NOW + 10 * 60_000).toISOString() })), NOW))).toBe(
      'claims_from_future',
    );
    expect(refused(() => partnerCtxOf(session(claims({ verifiedAt: 'yesterday' })), NOW))).toBe(
      'claims_verified_at_invalid',
    );
  });

  it('refuses a malformed hotel, an unknown role, and a session without a tenant', () => {
    expect(refused(() => partnerCtxOf(session(claims({ hotelSn: '17 21; DROP' })), NOW))).toBe('claims_hotel_invalid');
    expect(refused(() => partnerCtxOf(session(claims({ hotelSn: '' })), NOW))).toBe('claims_hotel_invalid');
    expect(refused(() => partnerCtxOf(session(claims({ role: 'owner' as never })), NOW))).toBe('claims_role_invalid');
    expect(refused(() => partnerCtxOf(session(claims(), null), NOW))).toBe('session_without_tenant');
  });
});
