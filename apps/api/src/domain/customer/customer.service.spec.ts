import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';

process.env.CRED_ENC_KEY = randomBytes(32).toString('base64');

import { CustomerService } from './customer.service';
import { Customer } from './entity/customer.entity';
import { OrderCache } from '../order/entity/order-cache.entity';
import { ErasureSuppressionService } from '../privacy/erasure-suppression.service';

/**
 * Regression for FIX-Customer-Duplicate-ShopifyId-20260803: the app-proxy
 * identity path creates an email-less row keyed by shopify_customer_id; the
 * order-sync path looks up by email hash only and used to create a DUPLICATE
 * row for the same Shopify customer — leaving sessions bound to one row and
 * orders linked to the other, so the widget listed no orders.
 */
describe('CustomerService.findOrCreateByEmail (duplicate prevention)', () => {
  let svc: CustomerService;
  let rows: Customer[];
  let customerRepo: Repository<Customer>;

  function makeRepo(): Repository<Customer> {
    return {
      findOne: jest.fn(async ({ where }: { where: Partial<Customer> }) => {
        return (
          rows.find((r) =>
            Object.entries(where).every(([k, v]) => (r as never)[k] === v),
          ) ?? null
        );
      }),
      create: jest.fn((e: Partial<Customer>) => Object.assign(new Customer(), e)),
      save: jest.fn(async (e: Customer) => {
        if (!rows.includes(e)) {
          e.id = rows.length + 1;
          rows.push(e);
        }
        return e;
      }),
    } as unknown as Repository<Customer>;
  }

  beforeEach(() => {
    rows = [];
    customerRepo = makeRepo();
    // Suppression stub: these tests cover dedup, not erasure — nothing suppressed.
    svc = new CustomerService(
      customerRepo,
      {} as Repository<OrderCache>,
      {
        isSuppressed: async () => false,
      } as unknown as ErasureSuppressionService,
      { write: jest.fn(async () => undefined) } as never,
    );
  });

  it('adopts the email-less proxy-created row instead of creating a duplicate', async () => {
    // Step 1: app-proxy identity created a row with the Shopify id but no email.
    const proxyRow = Object.assign(new Customer(), {
      id: 1,
      tenantId: 1,
      shopifyCustomerId: '7817610756176',
      email: null,
      emailHash: null,
      name: null,
    });
    rows.push(proxyRow);

    // Step 2: order sync arrives with the email for the same Shopify customer.
    const result = await svc.findOrCreateByEmail(
      1,
      'customer@example.com',
      'Test User',
      '7817610756176',
    );

    expect(result.id).toBe(1); // same row adopted, no duplicate
    expect(result.email).toBe('customer@example.com');
    expect(result.name).toBe('Test User');
    expect(rows).toHaveLength(1);
  });

  it('still creates a fresh row when neither email nor shopify id matches', async () => {
    const result = await svc.findOrCreateByEmail(1, 'new@example.com', 'New', '999');
    expect(result.email).toBe('new@example.com');
    expect(rows).toHaveLength(1);
  });

  it('email match still wins and backfills the shopify id', async () => {
    const emailRow = Object.assign(new Customer(), {
      id: 1,
      tenantId: 1,
      shopifyCustomerId: null,
      email: 'known@example.com',
      emailHash: null,
      name: null,
    });
    emailRow.syncEmailHash();
    rows.push(emailRow);

    const result = await svc.findOrCreateByEmail(1, 'known@example.com', undefined, '777');
    expect(result.id).toBe(1);
    expect(result.shopifyCustomerId).toBe('777');
    expect(rows).toHaveLength(1);
  });
});

/**
 * PLN-260808 P-A2: Cafe24 sign-in creates an identifier row (session-bound, no
 * orders); order sync created an email row (orders, no identifier). linkCafe24Customer
 * must MERGE the order row into the session row so "my orders" resolves — never leave
 * the session bound to a row that holds none of the shopper's orders.
 */
describe('CustomerService.linkCafe24Customer (identity↔orders merge)', () => {
  let svc: CustomerService;
  let rows: Customer[];
  let orderUpdate: jest.Mock;

  function makeRepo(): Repository<Customer> {
    return {
      findOne: jest.fn(async ({ where }: { where: Partial<Customer> }) => {
        return (
          rows.find((r) => Object.entries(where).every(([k, v]) => (r as never)[k] === v)) ?? null
        );
      }),
      create: jest.fn((e: Partial<Customer>) => Object.assign(new Customer(), e)),
      save: jest.fn(async (e: Customer) => {
        e.syncEmailHash();
        if (!rows.includes(e)) {
          e.id = rows.length + 1;
          rows.push(e);
        }
        return e;
      }),
      remove: jest.fn(async (e: Customer) => {
        rows = rows.filter((r) => r !== e);
        return e;
      }),
    } as unknown as Repository<Customer>;
  }

  beforeEach(() => {
    rows = [];
    orderUpdate = jest.fn(async () => ({ affected: 1 }));
    const orderRepo = { update: orderUpdate } as unknown as Repository<OrderCache>;
    svc = new CustomerService(makeRepo(), orderRepo, {
      isSuppressed: async () => false,
    } as unknown as ErasureSuppressionService);
  });

  it('merges the order-synced email row into the session-bound identifier row', async () => {
    const emailRow = Object.assign(new Customer(), {
      id: 12,
      tenantId: 3,
      email: 'shopper@example.com',
      name: '홍길동',
      cafe24UserIdentifier: null,
    });
    emailRow.syncEmailHash();
    const idRow = Object.assign(new Customer(), {
      id: 15,
      tenantId: 3,
      email: null,
      emailHash: null,
      name: null,
      cafe24UserIdentifier: 'UID-C7b8',
    });
    rows.push(emailRow, idRow);

    const result = await svc.linkCafe24Customer(3, 'shopper@example.com', undefined, 'UID-C7b8');

    // Session row (15) wins, gains the email + name; orders repointed 12 → 15; dup gone.
    expect(result?.id).toBe(15);
    expect(result?.email).toBe('shopper@example.com');
    expect(result?.name).toBe('홍길동');
    expect(orderUpdate).toHaveBeenCalledWith(
      { tenantId: 3, customerId: 12 },
      { customerId: 15 },
    );
    expect(rows.map((r) => r.id)).toEqual([15]);
  });

  it('just stamps email/name when only the identifier row exists (no prior orders)', async () => {
    const idRow = Object.assign(new Customer(), {
      id: 15,
      tenantId: 3,
      email: null,
      emailHash: null,
      name: null,
      cafe24UserIdentifier: 'UID-X',
    });
    rows.push(idRow);

    const result = await svc.linkCafe24Customer(3, 'new@example.com', 'New Buyer', 'UID-X');
    expect(result?.id).toBe(15);
    expect(result?.email).toBe('new@example.com');
    expect(orderUpdate).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
  });

  /**
   * PLN-260808-Cafe24-MemberId-RecentOrders: the token response names the member's
   * login id — adopt stamps it on the session row and retro-links orders that were
   * synced before the member ever signed in (member_id kept, customer unresolved).
   */
  describe('adoptCafe24MemberId', () => {
    it('stamps the member id and retro-links unresolved orders', async () => {
      const target = Object.assign(new Customer(), {
        id: 15,
        tenantId: 3,
        email: null,
        emailHash: null,
        cafe24UserIdentifier: 'UID-X',
        cafe24MemberId: null,
      });
      rows.push(target);

      await svc.adoptCafe24MemberId(3, 15, 'anhthutest1');

      expect(target.cafe24MemberId).toBe('anhthutest1');
      expect(orderUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 3, memberId: 'anhthutest1' }),
        { customerId: 15 },
      );
    });

    it('converges on the session row when another row already holds the member id', async () => {
      const holder = Object.assign(new Customer(), {
        id: 12,
        tenantId: 3,
        email: 'shopper@example.com',
        name: '홍길동',
        cafe24UserIdentifier: null,
        cafe24MemberId: 'anhthutest1',
      });
      holder.syncEmailHash();
      const target = Object.assign(new Customer(), {
        id: 15,
        tenantId: 3,
        email: null,
        emailHash: null,
        name: null,
        cafe24UserIdentifier: 'UID-X',
        cafe24MemberId: null,
      });
      rows.push(holder, target);

      await svc.adoptCafe24MemberId(3, 15, 'anhthutest1');

      // Holder's orders repointed to the session row; duplicate dropped; contact kept.
      expect(orderUpdate).toHaveBeenCalledWith(
        { tenantId: 3, customerId: 12 },
        { customerId: 15 },
      );
      expect(rows.map((r) => r.id)).toEqual([15]);
      expect(target.cafe24MemberId).toBe('anhthutest1');
      expect(target.email).toBe('shopper@example.com');
    });
  });
});
