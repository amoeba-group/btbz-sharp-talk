import { PrivacyService } from './privacy.service';

/**
 * Per-customer export / erase and the retention scrub (PLN-261012 SG-70).
 *
 * The widget DSAR path resolves a customer from a verified session; the
 * operator tool and the retention job address one by id. These pin down that
 * the shared worker behaves the same for all three — and that the two new
 * callers differ only where they must (audit actor; suppression).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function build() {
  const claims = { hotelSn: '1721', role: 'manager', hotelName: 'A In Hotel', signed: true };
  const customer: Row = {
    id: 42,
    tenantId: 7,
    email: 'lan@example.vn',
    name: 'Lan',
    phone: '0900',
    shopifyCustomerId: 'gid://shopify/Customer/1',
    externalCustomerId: 'ext-42',
    cafe24UserIdentifier: 'c24-uid',
    cafe24MemberId: 'c24-member',
    emailHash: 'h',
    tier: 'vip',
    lastClaims: claims,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  const customerRepo = {
    findOne: jest.fn(async () => customer),
    save: jest.fn(async (c: Row) => c),
  };
  const sessionRepo = {
    find: jest.fn(async () => []),
    update: jest.fn(async () => ({ affected: 0 })),
  };
  const sink = () => ({
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    update: jest.fn(async () => ({ affected: 0 })),
    delete: jest.fn(async () => ({ affected: 0 })),
    save: jest.fn(async (e: unknown) => e),
  });
  const audits: Row[] = [];
  const audit = { write: jest.fn(async (a: Row) => audits.push(a)) };
  const suppression = { record: jest.fn(async () => undefined) };
  const adminClient = { requestCustomerErasure: jest.fn(async () => ({ accepted: true, userErrors: [] })) };
  const tenantService = { getShopifyConnection: jest.fn(async () => ({ shopDomain: 's', token: 't' })) };
  const svc = new PrivacyService(
    customerRepo as never,
    sessionRepo as never,
    sink() as never, sink() as never, sink() as never, // order, orderItem, fulfillment
    sink() as never, sink() as never, sink() as never, // conversation, message, notification
    sink() as never, sink() as never, sink() as never, // pref, review, inquiry
    sink() as never, sink() as never, sink() as never, // cjm, affiliate, subscription
    sink() as never, sink() as never, sink() as never, // restock, deviceToken, campaign
    sink() as never, sink() as never, sink() as never, sink() as never, // tenant, productSave, nudge, diary
    {} as never, // sessionService
    audit as never,
    { del: jest.fn(async () => undefined) } as never,
    suppression as never,
    tenantService as never,
    adminClient as never,
  );
  return { svc, customer, customerRepo, audits, suppression, adminClient };
}

describe('PrivacyService.exportCustomer (SG-70)', () => {
  it('includes the external id and the last signed claims — they are personal data we hold', async () => {
    const h = build();
    const out = await h.svc.exportCustomer(42);
    expect(out.customer).toMatchObject({
      id: 42,
      externalCustomerId: 'ext-42',
      lastClaims: { hotelSn: '1721', role: 'manager' },
    });
  });

  it('keeps the system actor for the widget path and names the operator for the console one', async () => {
    const h = build();
    await h.svc.exportCustomer(42);
    expect(h.audits[0]).toMatchObject({ actorType: 'system', actorId: 0, action: 'dsar.export' });
    expect(h.audits[0].metadata).toEqual({ kind: 'export', customerId: 42 });

    await h.svc.exportCustomer(42, { userId: 99, reference: 'TICKET-1' });
    expect(h.audits[1]).toMatchObject({ actorType: 'user', actorId: 99, action: 'dsar.export' });
    expect(h.audits[1].metadata).toEqual({ kind: 'export', customerId: 42, via: 'operator', reference: 'TICKET-1' });
  });
});

describe('PrivacyService.eraseCustomer (SG-70)', () => {
  it('clears the external and Cafe24 identifiers that used to survive an "anonymised" row', async () => {
    const h = build();
    await h.svc.eraseCustomer(42);
    const saved = h.customerRepo.save.mock.calls[0][0];
    expect(saved).toMatchObject({
      email: null,
      phone: null,
      shopifyCustomerId: null,
      externalCustomerId: null,
      cafe24UserIdentifier: null,
      cafe24MemberId: null,
      lastClaims: null,
    });
    expect(JSON.stringify(saved)).not.toContain('ext-42');
  });

  it('records the suppression and goes upstream, like the widget DSAR', async () => {
    const h = build();
    await h.svc.eraseCustomer(42);
    expect(h.suppression.record).toHaveBeenCalledTimes(1);
    expect(h.adminClient.requestCustomerErasure).toHaveBeenCalledTimes(1);
  });

  it('names the operator and the reference in the audit row', async () => {
    const h = build();
    await h.svc.eraseCustomer(42, { userId: 99, reference: 'TICKET-9' });
    const row = h.audits.find((a) => a.action === 'dsar.delete');
    expect(row).toMatchObject({ actorType: 'user', actorId: 99, target: '42' });
    expect(row?.metadata).toEqual({ kind: 'erasure', via: 'operator', reference: 'TICKET-9' });
  });
});

describe('PrivacyService.anonymizeInactiveCustomer — retention scrub (SG-70)', () => {
  it('scrubs the same columns as an erasure', async () => {
    const h = build();
    await h.svc.anonymizeInactiveCustomer(h.customer as never);
    expect(h.customerRepo.save.mock.calls[0][0]).toMatchObject({
      email: null,
      name: '[redacted]',
      phone: null,
      externalCustomerId: null,
      lastClaims: null,
    });
  });

  it('does NOT suppress the identity or go upstream: aging out is not an objection', async () => {
    const h = build();
    await h.svc.anonymizeInactiveCustomer(h.customer as never);
    // A suppression record would forbid the person from ever coming back —
    // wrong for someone whose data merely passed its retention window.
    expect(h.suppression.record).not.toHaveBeenCalled();
    expect(h.adminClient.requestCustomerErasure).not.toHaveBeenCalled();
  });
});
