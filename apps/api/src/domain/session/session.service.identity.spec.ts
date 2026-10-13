import { Repository } from 'typeorm';
import { SessionService } from './session.service';
import { SessionMapper } from './session.mapper';
import { effectiveIdentity } from './identity.util';
import { Session } from './entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { EventBusService } from '../../infrastructure/infrastructure.module';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import type { PrivacyNoticeInfo } from './session.service';

/**
 * Where the session layer applies the signed-identity max age (PLN-261012 SG-03):
 * the explicit E5096 on a rejected call, the widget response flags, and the policy read.
 */
const HOUR = 3_600_000;

const claims = (ageMs: number) => ({
  hotelSn: '1721',
  role: 'receptionist',
  signed: true,
  verifiedAt: new Date(Date.now() - ageMs).toISOString(),
});

function build(session: Partial<Session>, tenant: Partial<Tenant> = {}) {
  const row = { id: 11, sessionToken: 'tok', tenantId: 1, language: 'VI', identityLevel: 'guest', customerId: null, identityClaims: null, ...session } as Session;
  const tenantFind = jest.fn(async () => ({ id: 1, identityPolicy: null, ...tenant }) as unknown as Tenant);
  const svc = new SessionService(
    { findOne: jest.fn(async () => row) } as unknown as Repository<Session>,
    { findOne: tenantFind } as unknown as Repository<Tenant>,
    { findOne: jest.fn(async () => null) } as never,
    { publish: jest.fn() } as unknown as EventBusService,
    { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as unknown as RedisService,
  );
  return { svc, row, tenantFind };
}

describe('SessionService.identityOf', () => {
  it('a session without signed claims costs no tenant read — Shopify / v1 / guests are untouched', async () => {
    const h = build({ identityLevel: 'verified', customerId: 4 });

    const id = await h.svc.identityOf(h.row);

    expect(id).toMatchObject({ level: 'verified', customerId: 4, expired: false });
    expect(h.tenantFind).not.toHaveBeenCalled();
  });

  it('signed claims inside the default 8 h: in force', async () => {
    const h = build({ identityLevel: 'verified', customerId: 4, identityClaims: claims(2 * HOUR) as never });

    expect((await h.svc.identityOf(h.row)).expired).toBe(false);
  });

  it('signed claims past 8 h: expired, read as a guest', async () => {
    const h = build({ identityLevel: 'verified', customerId: 4, identityClaims: claims(9 * HOUR) as never });

    const id = await h.svc.identityOf(h.row);

    expect(id).toMatchObject({ level: 'guest', customerId: null, claims: null, expired: true });
  });

  it('the tenant policy decides: 3 h-old claims are fine for a 4 h tenant, expired for a 2 h one', async () => {
    const four = build({ identityLevel: 'verified', customerId: 4, identityClaims: claims(3 * HOUR) as never }, { identityPolicy: { maxAgeHours: 4 } });
    const two = build({ identityLevel: 'verified', customerId: 4, identityClaims: claims(3 * HOUR) as never }, { identityPolicy: { maxAgeHours: 2 } });

    expect((await four.svc.identityOf(four.row)).expired).toBe(false);
    expect((await two.svc.identityOf(two.row)).expired).toBe(true);
  });

  it('reads the policy through a cache: ten calls, one tenant read', async () => {
    const h = build({ identityLevel: 'verified', customerId: 4, identityClaims: claims(HOUR) as never });

    for (let i = 0; i < 10; i++) await h.svc.identityOf(h.row);

    expect(h.tenantFind).toHaveBeenCalledTimes(1);
  });

  it('a tenant read that fails is not fatal: the platform default applies (expiry stays ON)', async () => {
    const h = build({ identityLevel: 'verified', customerId: 4, identityClaims: claims(9 * HOUR) as never });
    h.tenantFind.mockRejectedValueOnce(new Error('db down'));

    expect((await h.svc.identityOf(h.row)).expired).toBe(true);
  });
});

describe('SessionService.requireCustomer — the E5096 rejection', () => {
  const lapsed = () => build({ identityLevel: 'verified', customerId: 4, identityClaims: claims(9 * HOUR) as never });

  it('rejects lapsed claims with the explicit IDENTITY_EXPIRED code (401), not a generic one', async () => {
    const h = lapsed();

    await expect(h.svc.requireCustomerId('tok')).rejects.toMatchObject({
      errorCode: ERROR_CODE.IDENTITY_EXPIRED.code,
      status: 401,
    });
  });

  it('…also on the verified-only gate (DSAR export / erase)', async () => {
    const h = lapsed();

    await expect(h.svc.requireCustomerId('tok', { verified: true })).rejects.toMatchObject({
      errorCode: ERROR_CODE.IDENTITY_EXPIRED.code,
    });
  });

  it('claims in force pass untouched', async () => {
    const h = build({ identityLevel: 'verified', customerId: 4, identityClaims: claims(HOUR) as never });

    await expect(h.svc.requireCustomerId('tok', { verified: true })).resolves.toBe(4);
  });

  it('a platform login is unaffected, however old the session', async () => {
    const h = build({ identityLevel: 'verified', customerId: 9 });

    await expect(h.svc.requireCustomerId('tok', { verified: true })).resolves.toBe(9);
    expect(h.tenantFind).not.toHaveBeenCalled();
  });

  it('a guest still gets the ordinary 401, not E5096', async () => {
    const h = build({});

    await expect(h.svc.requireCustomerId('tok')).rejects.toMatchObject({ errorCode: ERROR_CODE.UNAUTHORIZED.code });
  });
});

describe('SessionMapper.toResponse — identity flags', () => {
  const notice: PrivacyNoticeInfo = {
    privacyPolicyUrl: null,
    consentNoticeVersion: 'v1',
    widgetLoginMode: 'redirect',
    widgetCopy: { displayName: 'Shop', firstVisit: {}, loginGreeting: {} },
  } as never;
  const session = (over: Partial<Session> = {}) =>
    ({ sessionToken: 'tok', language: 'VI', consentState: 'granted', customerId: 4, identityLevel: 'verified', ...over }) as Session;

  it('without an identity view the response is exactly what it always was', () => {
    const res = SessionMapper.toResponse(session({ identityClaims: claims(HOUR) as never }), notice);

    expect(res.authenticated).toBe(true);
    expect(res).not.toHaveProperty('identityExpired');
    expect(res).not.toHaveProperty('identityExpiresAt');
  });

  it('claims in force: authenticated, with the moment they lapse (the widget arms its timer on it)', () => {
    const s = session({ identityClaims: claims(HOUR) as never });
    const res = SessionMapper.toResponse(s, notice, null, effectiveIdentity(s));

    expect(res.authenticated).toBe(true);
    expect(res.identityExpiresAt).toBe(new Date(Date.parse(s.identityClaims!.verifiedAt) + 8 * HOUR).toISOString());
    expect(res).not.toHaveProperty('identityExpired');
  });

  it('claims lapsed: NOT authenticated, flagged expired — the widget shows a guest and tells the host', () => {
    const s = session({ identityClaims: claims(9 * HOUR) as never });
    const res = SessionMapper.toResponse(s, notice, null, effectiveIdentity(s));

    expect(res.authenticated).toBe(false);
    expect(res.identityExpired).toBe(true);
    expect(res.identityExpiresAt).toBeDefined();
  });

  it('a platform login or a guest gets neither key', () => {
    const shopify = session();
    const guest = session({ customerId: null, identityLevel: 'guest' });

    for (const s of [shopify, guest]) {
      const res = SessionMapper.toResponse(s, notice, null, effectiveIdentity(s));
      expect(res).not.toHaveProperty('identityExpired');
      expect(res).not.toHaveProperty('identityExpiresAt');
    }
    expect(SessionMapper.toResponse(shopify, notice, null, effectiveIdentity(shopify)).authenticated).toBe(true);
  });
});
