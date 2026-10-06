import { CLAIMS_IAT_WINDOW_SEC, EmbedService } from './embed.service';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/**
 * identify v2 — signed partner claims (PLN-261001 v1.1 H1 / REQ-261006).
 *
 * The property under test: the hotel and role the console will show are
 * exactly what the host's server signed. Unsigned claims are never adopted,
 * a v1 hash never carries claims, and a stale signature is not a signature.
 */
const SECRET = 'shtk_testsecret';
const USER = 'staff-42';
const NOW = Math.floor(Date.now() / 1000);

function build() {
  const tenant = { id: 4, embedSecret: SECRET };
  const session = {
    id: 5,
    sessionToken: 'tok',
    tenantId: 4,
    customerId: null as number | null,
    identityLevel: 'guest',
    identityClaims: null as unknown,
  };
  const customers: Record<string, unknown>[] = [];
  const customerUpdates: Array<{ where: unknown; set: Record<string, unknown> }> = [];
  const tenantRepo = { findOne: jest.fn(async () => tenant) };
  const customerRepo = {
    findOne: jest.fn(async ({ where }: { where: { externalCustomerId: string } }) =>
      customers.find((c) => c.externalCustomerId === where.externalCustomerId) ?? null,
    ),
    create: (v: Record<string, unknown>) => ({ ...v }),
    save: jest.fn(async (c: Record<string, unknown>) => {
      const row = { id: 100, ...c };
      customers.push(row);
      return row;
    }),
    update: jest.fn(async (where: unknown, set: Record<string, unknown>) => {
      customerUpdates.push({ where, set });
      return { affected: 1 };
    }),
  };
  const sessionRepo = {
    findOne: jest.fn(async () => session),
    save: jest.fn(async (s: typeof session) => s),
  };
  const redis = { del: jest.fn(async () => undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new EmbedService(tenantRepo as any, customerRepo as any, sessionRepo as any, redis as any);
  return { service, session, customerUpdates };
}

const claims = (over: Partial<{ hotelSn: string; role: string; iat: number }> = {}) => ({
  hotelSn: '1721',
  role: 'receptionist' as const,
  iat: NOW,
  hotelName: 'A In Hotel Del Luna',
  hotelCode: 'HCM_001_001721-TC-000',
  ...over,
});

describe('EmbedService.identify v2', () => {
  it('signs the exact canonical bytes the host must produce (Q7)', () => {
    expect(EmbedService.canonicalV2('u1', '1721', 'manager', 1700000000)).toBe(
      'u1|1721|manager|1700000000',
    );
  });

  it('binds the session AND records the signed claims when the v2 signature verifies', async () => {
    const h = build();
    const c = claims();
    const hash = EmbedService.signV2(SECRET, USER, c.hotelSn, c.role, c.iat);

    const session = await h.service.identify({ sessionToken: 'tok', userId: USER, hash, claims: c });

    expect(session.identityLevel).toBe('verified');
    expect(session.identityClaims).toMatchObject({
      hotelSn: '1721',
      role: 'receptionist',
      hotelName: 'A In Hotel Del Luna',
      hotelCode: 'HCM_001_001721-TC-000',
      signed: true,
    });
    expect(typeof (session.identityClaims as { verifiedAt: string }).verifiedAt).toBe('string');
    // The Customers screen reads the last-known claims from the customer row.
    expect(h.customerUpdates[0]?.set).toMatchObject({ lastClaims: { hotelSn: '1721' } });
  });

  it('refuses claims carried with a v1 signature — never "unsigned but displayed" (Q8)', async () => {
    const h = build();
    const v1 = EmbedService.sign(SECRET, USER);

    await expect(
      h.service.identify({ sessionToken: 'tok', userId: USER, hash: v1, claims: claims() }),
    ).rejects.toMatchObject({ errorCode: ERROR_CODE.EMBED_IDENTITY_INVALID.code });
    expect(h.session.identityClaims).toBeNull();
  });

  it('refuses a v2 signature whose hotel was swapped after signing', async () => {
    const h = build();
    const c = claims();
    const hash = EmbedService.signV2(SECRET, USER, c.hotelSn, c.role, c.iat);

    await expect(
      h.service.identify({
        sessionToken: 'tok',
        userId: USER,
        hash,
        claims: { ...c, hotelSn: '999' },
      }),
    ).rejects.toMatchObject({ errorCode: ERROR_CODE.EMBED_IDENTITY_INVALID.code });
  });

  it('refuses a signature older than the iat window (replay guard)', async () => {
    const h = build();
    const c = claims({ iat: NOW - CLAIMS_IAT_WINDOW_SEC - 60 });
    const hash = EmbedService.signV2(SECRET, USER, c.hotelSn, c.role, c.iat);

    await expect(
      h.service.identify({ sessionToken: 'tok', userId: USER, hash, claims: c }),
    ).rejects.toMatchObject({ errorCode: ERROR_CODE.EMBED_IDENTITY_INVALID.code });
  });

  it('a v1 identify still works and leaves the session without claims', async () => {
    const h = build();

    const session = await h.service.identify({
      sessionToken: 'tok',
      userId: USER,
      hash: EmbedService.sign(SECRET, USER),
    });

    expect(session.identityLevel).toBe('verified');
    expect(session.identityClaims).toBeNull();
    expect(h.customerUpdates).toHaveLength(0);
  });
});
