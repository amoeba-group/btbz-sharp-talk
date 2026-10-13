import { PrivacyService } from './privacy.service';
import { sessionCacheKey } from '../session/session.service';

/**
 * Erasure and identify v2 claims (PLN-261012 SG-05 / REQ D-07).
 *
 * identify v2 leaves the signed hotel, its name and the user's role on the
 * session row (`identity_claims`) and a summary on the customer
 * (`customers.last_claims`). The erasure unbound the customer from the session
 * but left both behind — personal context surviving a request to delete it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function build() {
  const claims = { hotelSn: '1721', role: 'receptionist', hotelName: 'A In Hotel Del Luna', signed: true };
  const customer: Row = {
    id: 42,
    tenantId: 7,
    email: 'lan@example.vn',
    name: 'Lan',
    phone: '0900',
    shopifyCustomerId: 'gid://shopify/Customer/1',
    emailHash: 'h',
    tier: 'vip',
    lastClaims: claims,
  };
  const sessions: Row[] = [
    { id: 1, sessionToken: 'tok-a', customerId: 42, identityClaims: claims },
    { id: 2, sessionToken: 'tok-b', customerId: 42, identityClaims: { ...claims, hotelSn: '2204' } },
  ];

  const customerRepo = {
    findOne: jest.fn(async () => customer),
    save: jest.fn(async (c: Row) => c),
  };
  const sessionRepo = {
    find: jest.fn(async () => sessions),
    update: jest.fn(async () => ({ affected: sessions.length })),
  };
  const sink = () => ({
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    update: jest.fn(async () => ({ affected: 0 })),
    delete: jest.fn(async () => ({ affected: 0 })),
    save: jest.fn(async (e: unknown) => e),
  });
  const redis = { del: jest.fn(async () => undefined) };
  const audit = { write: jest.fn(async () => ({})) };

  const svc = new PrivacyService(
    customerRepo as never,
    sessionRepo as never,
    sink() as never, // order
    sink() as never, // orderItem
    sink() as never, // fulfillment
    sink() as never, // conversation
    sink() as never, // message
    sink() as never, // notification
    sink() as never, // pref
    sink() as never, // review
    sink() as never, // inquiry
    sink() as never, // cjm
    sink() as never, // affiliate
    sink() as never, // subscription
    sink() as never, // restock
    sink() as never, // deviceToken
    sink() as never, // campaign
    sink() as never, // tenant
    sink() as never, // productSave
    sink() as never, // nudge
    sink() as never, // diary
    {} as never, // sessionService
    audit as never,
    redis as never,
    { record: jest.fn(async () => undefined) } as never, // suppression
    { getShopifyConnection: jest.fn(async () => null) } as never,
    { requestCustomerErasure: jest.fn() } as never,
  );
  return { svc, customer, sessions, sessionRepo, customerRepo, redis };
}

describe('PrivacyService erasure clears identify v2 claims (SG-05)', () => {
  it('clears sessions.identity_claims together with the customer binding', async () => {
    const h = build();

    await h.svc.handleCustomerRedact('lan@example.vn', 'gid://shopify/Customer/1');

    expect(h.sessionRepo.update).toHaveBeenCalledWith(
      { customerId: 42 },
      expect.objectContaining({ customerId: null, identityClaims: null }),
    );
  });

  it('puts the identity LEVEL back to guest too — an unbound session must not stay "verified" (S1 follow-up)', async () => {
    const h = build();

    await h.svc.handleCustomerRedact('lan@example.vn', 'gid://shopify/Customer/1');

    // Without this the session had no customer but still read as verified: it
    // passed the guest gate and was served the partner scenario menu.
    expect(h.sessionRepo.update).toHaveBeenCalledWith(
      { customerId: 42 },
      { customerId: null, identityClaims: null, identityLevel: 'guest' },
    );
  });

  it('clears customers.last_claims on the anonymised customer row it keeps', async () => {
    const h = build();

    await h.svc.handleCustomerRedact('lan@example.vn', 'gid://shopify/Customer/1');

    const saved = h.customerRepo.save.mock.calls[0][0];
    expect(saved).toMatchObject({ id: 42, email: null, phone: null, lastClaims: null });
    // Nothing of the hotel or the role is left on the row that stays.
    expect(JSON.stringify(saved)).not.toContain('1721');
  });

  it("drops every bound session's token->session cache entry, so no stale claims are served", async () => {
    const h = build();

    await h.svc.handleCustomerRedact('lan@example.vn', 'gid://shopify/Customer/1');

    expect(h.redis.del).toHaveBeenCalledWith(sessionCacheKey('tok-a'));
    expect(h.redis.del).toHaveBeenCalledWith(sessionCacheKey('tok-b'));
  });
});
