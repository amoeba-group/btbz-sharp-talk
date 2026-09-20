import { ShopifySyncService } from './shopify-sync.service';
import { OrderCache } from './entity/order-cache.entity';

/** ShopifySyncService.syncOrders — Admin API orders → cache upsert + status mapping. */
describe('ShopifySyncService.syncOrders', () => {
  const sampleOrders = [
    {
      id: 1001,
      order_number: 1001,
      financial_status: 'paid',
      fulfillment_status: 'fulfilled',
      total_price: '42.00',
      currency: 'USD',
      customer: { id: 5, email: 'a@x.com', first_name: 'A', last_name: 'B' },
    },
    {
      id: 1002,
      order_number: 1002,
      financial_status: 'pending',
      fulfillment_status: null,
      total_price: '10.00',
      currency: 'USD',
      email: 'c@x.com',
      customer: null,
    },
  ];

  function build(orders: unknown[], conn: unknown = { shopDomain: 's.myshopify.com', token: 't' }) {
    const saved: OrderCache[] = [];
    const orderRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((x: Partial<OrderCache>) => ({ ...x }) as OrderCache),
      save: jest.fn((x: OrderCache) => {
        saved.push(x);
        return Promise.resolve(x);
      }),
    };
    const savedItems: Record<string, unknown>[] = [];
    const itemRepo = {
      create: jest.fn((x: Record<string, unknown>) => ({ ...x })),
      delete: jest.fn().mockResolvedValue(undefined),
      save: jest.fn((rows: Record<string, unknown>[]) => {
        savedItems.push(...rows);
        return Promise.resolve(rows);
      }),
    };
    const client = {
      fetchOrders: jest.fn().mockResolvedValue({ orders, nextPageInfo: null }),
    };
    const tenantService = { getShopifyConnection: jest.fn().mockResolvedValue(conn) };
    const customerService = { findOrCreateByEmail: jest.fn().mockResolvedValue({ id: 42 }) };
    const integrationService = {
      upsert: jest.fn().mockResolvedValue(undefined),
      findByName: jest.fn().mockResolvedValue(null),
    };
    const publish = jest.fn(async () => undefined);
    const svc = new ShopifySyncService(
      orderRepo as never,
      itemRepo as never,
      client as never,
      tenantService as never,
      customerService as never,
      integrationService as never,
      { publish } as never,
    );
    return {
      svc,
      saved,
      savedItems,
      orderRepo,
      itemRepo,
      client,
      customerService,
      integrationService,
      publish,
    };
  }

  it('upserts each order with mapped status and links customers', async () => {
    const { svc, saved, customerService, integrationService } = build(sampleOrders);
    const res = await svc.syncOrders(7);

    expect(res).toEqual({
      ok: true,
      synced: 2,
      detail: 'Synced 2 order(s) (initial full sync)',
    });
    expect(saved).toHaveLength(2);

    // Order 1001: fulfilled → shipping; customer resolved by email with full name + shopify id.
    expect(saved[0]).toMatchObject({
      shopifyOrderId: '1001',
      orderNumber: '1001',
      statusInternal: 'shipping',
      total: 42,
      currency: 'USD',
      customerId: 42,
      tenantId: 7,
    });
    expect(customerService.findOrCreateByEmail).toHaveBeenCalledWith(7, 'a@x.com', 'A B', '5');

    // Order 1002: paid=pending & unfulfilled → paid; email falls back to order.email, no customer obj.
    expect(saved[1]).toMatchObject({ shopifyOrderId: '1002', statusInternal: 'paid' });
    expect(customerService.findOrCreateByEmail).toHaveBeenCalledWith(7, 'c@x.com', undefined, undefined);

    expect(integrationService.upsert).toHaveBeenCalledWith(
      'shopify',
      'connected',
      'Synced 2 order(s) (initial full sync)',
    );
  });

  it('maps a paid, unfulfilled order to "paid" (Confirmed)', async () => {
    const { svc, saved } = build([
      { id: 1, order_number: 1, financial_status: 'paid', fulfillment_status: null },
    ]);
    await svc.syncOrders(1);
    expect(saved[0].statusInternal).toBe('paid');
  });

  it('maps a partially fulfilled order to "preparing"', async () => {
    const { svc, saved } = build([
      { id: 2, order_number: 2, financial_status: 'paid', fulfillment_status: 'partial' },
    ]);
    await svc.syncOrders(1);
    expect(saved[0].statusInternal).toBe('preparing');
  });

  it('records an error and syncs nothing when the connection is missing', async () => {
    const { svc, integrationService, client } = build([], null);
    const res = await svc.syncOrders(1);
    expect(res.ok).toBe(false);
    expect(res.synced).toBe(0);
    expect(res.detail).toMatch(/reconnect the store/);
    expect(client.fetchOrders).not.toHaveBeenCalled();
    expect(integrationService.upsert).toHaveBeenCalledWith('shopify', 'error', expect.any(String));
  });

  it('records an error when the Admin API call fails', async () => {
    const { svc, integrationService } = build(sampleOrders);
    // Force the client to throw.
    (svc as unknown as { client: { fetchOrders: jest.Mock } }).client.fetchOrders = jest
      .fn()
      .mockRejectedValue(new Error('Admin API returned 401'));
    const res = await svc.syncOrders(1);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain('401');
    expect(integrationService.upsert).toHaveBeenCalledWith('shopify', 'error', expect.stringContaining('401'));
  });

  describe('order number normalization', () => {
    // Webhooks carry order_number (1002); the GraphQL sync only has name ("#1002").
    // Storing both shapes made the same order flip format, breaking guest lookup
    // (exact match on what the shopper types) and rendering "##1002" in the UI.
    it('strips a leading # so both ingest paths agree', async () => {
      const { svc, saved } = build([
        { id: 3001, name: '#1002', financial_status: 'paid' },
        { id: 3002, order_number: 1003, name: '#1003', financial_status: 'paid' },
      ]);
      await svc.syncOrders(7);
      expect(saved.map((o) => o.orderNumber)).toEqual(['1002', '1003']);
    });

    it('falls back to the Shopify order id when neither is present', async () => {
      const { svc, saved } = build([{ id: 3003, financial_status: 'paid' }]);
      await svc.syncOrders(7);
      expect(saved[0].orderNumber).toBe('3003');
    });
  });

  describe('line items (FR-020)', () => {
    it('caches line items, mapping title/option/qty/price', async () => {
      const { svc, savedItems, itemRepo } = build([
        {
          id: 2001,
          order_number: 2001,
          financial_status: 'paid',
          line_items: [
            {
              product_id: 77,
              variant_id: 88,
              title: 'Ski Wax',
              variant_title: 'Special',
              quantity: 2,
              price: '24.95',
            },
          ],
        },
      ]);
      await svc.syncOrders(7);

      // Replace-on-write: stale rows for the order are cleared first.
      expect(itemRepo.delete).toHaveBeenCalledWith({ orderId: undefined });
      expect(savedItems).toHaveLength(1);
      expect(savedItems[0]).toMatchObject({
        tenantId: 7,
        productId: '77',
        title: 'Ski Wax',
        optionText: 'Special',
        qty: 2,
        price: 24.95,
      });
    });

    it('falls back to `name`, defaults qty, and tolerates a missing price', async () => {
      const { svc, savedItems } = build([
        {
          id: 2002,
          order_number: 2002,
          financial_status: 'paid',
          line_items: [{ name: 'Gift Card', quantity: 0, price: null }],
        },
      ]);
      await svc.syncOrders(7);
      expect(savedItems[0]).toMatchObject({ title: 'Gift Card', qty: 1, price: null });
    });

    it('leaves cached items untouched when the payload carries no line_items', async () => {
      const { svc, itemRepo } = build([
        { id: 2003, order_number: 2003, financial_status: 'paid' },
      ]);
      await svc.syncOrders(7);
      expect(itemRepo.delete).not.toHaveBeenCalled();
      expect(itemRepo.save).not.toHaveBeenCalled();
    });

    it('clears cached items when line_items is an explicit empty array', async () => {
      const { svc, itemRepo } = build([
        { id: 2004, order_number: 2004, financial_status: 'paid', line_items: [] },
      ]);
      await svc.syncOrders(7);
      expect(itemRepo.delete).toHaveBeenCalled();
      expect(itemRepo.save).not.toHaveBeenCalled();
    });

    it('still syncs the order when caching its items fails', async () => {
      const { svc, saved, itemRepo } = build([
        {
          id: 2005,
          order_number: 2005,
          financial_status: 'paid',
          line_items: [{ title: 'X', quantity: 1, price: '1.00' }],
        },
      ]);
      itemRepo.save.mockRejectedValueOnce(new Error('items table locked'));
      const res = await svc.syncOrders(7);
      expect(res.ok).toBe(true);
      expect(res.synced).toBe(1);
      expect(saved).toHaveLength(1);
    });
  });

  describe('customer link', () => {
    // `upsertOrder` is also the webhook entry point, and a webhook forwards whatever
    // Shopify sent. A payload with no customer/email is normal: Shopify redacts
    // protected customer fields until PCD is approved, and an order genuinely may
    // have no customer. So the incomplete case must never erase what the complete
    // case established — the order would stay cached but silently vanish from the
    // shopper's own order list, with nothing logged.
    it('keeps the existing link when a later payload carries no customer/email', async () => {
      const { svc, saved, orderRepo, customerService } = build([]);
      orderRepo.findOne.mockResolvedValue({
        id: 4,
        shopifyOrderId: '6667987910830',
        customerId: 6,
      } as OrderCache);

      await svc.upsertOrder(2, {
        id: 6667987910830,
        order_number: 1001,
        financial_status: 'paid',
      });

      expect(customerService.findOrCreateByEmail).not.toHaveBeenCalled();
      expect(saved[0].customerId).toBe(6);
    });

    it('leaves a genuinely customer-less order unlinked', async () => {
      // Shopify's own answer for #1001: customer null, email null. Upstream truth,
      // not local data loss — it stays NULL rather than being attached to anyone.
      const { svc, saved } = build([]);
      await svc.upsertOrder(2, { id: 6667987910830, order_number: 1001, financial_status: 'paid' });
      expect(saved[0].customerId).toBeNull();
    });

    it('re-links once a later payload restores the customer', async () => {
      const { svc, saved, orderRepo } = build([]);
      orderRepo.findOne.mockResolvedValue({ id: 4, shopifyOrderId: '9', customerId: null } as OrderCache);

      await svc.upsertOrder(2, {
        id: 9,
        order_number: 1003,
        financial_status: 'paid',
        customer: { id: 8984201134254, email: 'back@example.com' },
      });

      expect(saved[0].customerId).toBe(42);
    });

    describe('erased identities (PRV-H2)', () => {
      // Observed in live data: a shopper was erased, then this very sync read their
      // email back out of Shopify and re-linked their order. CustomerService now
      // returns null for a suppressed identity and the order must stay unlinked.
      it('leaves the order unlinked when the identity was erased', async () => {
        const { svc, saved, customerService } = build([]);
        customerService.findOrCreateByEmail.mockResolvedValue(null);

        await svc.upsertOrder(2, {
          id: 6677415297198,
          order_number: 1002,
          financial_status: 'paid',
          email: 'erased@example.com',
        });

        expect(saved[0].customerId).toBeNull();
      });

      it('erasure beats keep-what-we-knew: an existing link is dropped', async () => {
        // The two rules meet here. Normally an incomplete payload keeps the old link;
        // an erased identity must override that and unlink, or the order keeps
        // pointing at the person who asked to be deleted.
        const { svc, saved, orderRepo, customerService } = build([]);
        orderRepo.findOne.mockResolvedValue({
          id: 6,
          shopifyOrderId: '6677415297198',
          customerId: 6,
        } as OrderCache);
        customerService.findOrCreateByEmail.mockResolvedValue(null);

        await svc.upsertOrder(2, {
          id: 6677415297198,
          order_number: 1002,
          financial_status: 'paid',
          email: 'erased@example.com',
        });

        expect(saved[0].customerId).toBeNull();
      });

      it('still caches the order itself — the merchant keeps their books', async () => {
        const { svc, saved, customerService } = build([]);
        customerService.findOrCreateByEmail.mockResolvedValue(null);

        await svc.upsertOrder(2, {
          id: 6677415297198,
          order_number: 1002,
          financial_status: 'paid',
          total_price: '24.95',
          email: 'erased@example.com',
        });

        expect(saved[0]).toMatchObject({ orderNumber: '1002', total: 24.95, tenantId: 2 });
      });
    });
  });

  describe('order_created journey emit (PLN-260807 F3, A-7)', () => {
    it('emits Purchase/order_created for a NEW cached order with a known customer', async () => {
      const { svc, publish } = build([]);
      await svc.upsertOrder(7, {
        id: 5001,
        order_number: 1010,
        financial_status: 'paid',
        customer: { id: 5, email: 'a@x.com' },
      });
      expect(publish).toHaveBeenCalledWith('cjm.event', {
        tenantId: 7,
        customerId: 42,
        stage: 'Purchase',
        eventType: 'order_created',
        payload: { orderNumber: '1010' },
      });
    });

    it('does NOT re-emit when the order row already existed (orders/updated)', async () => {
      const { svc, publish, orderRepo } = build([]);
      orderRepo.findOne.mockResolvedValue({
        id: 4,
        shopifyOrderId: '5001',
        customerId: 42,
      } as OrderCache);
      await svc.upsertOrder(7, {
        id: 5001,
        order_number: 1010,
        financial_status: 'paid',
        customer: { id: 5, email: 'a@x.com' },
      });
      expect(publish).not.toHaveBeenCalled();
    });

    it('does NOT re-emit for a prefetched existing row (sync page path)', async () => {
      const { svc, publish } = build([]);
      await svc.upsertOrder(
        7,
        { id: 5001, order_number: 1010, financial_status: 'paid', customer: { id: 5, email: 'a@x.com' } },
        { id: 4, shopifyOrderId: '5001', customerId: 42 } as OrderCache,
      );
      expect(publish).not.toHaveBeenCalled();
    });

    it('does NOT emit when the new order has no resolvable customer', async () => {
      const { svc, publish } = build([]);
      await svc.upsertOrder(7, { id: 5002, order_number: 1011, financial_status: 'paid' });
      expect(publish).not.toHaveBeenCalled();
    });
  });

  describe('syncOrdersForCustomer (login-time backfill)', () => {
    it('pulls the customer-filtered pages and upserts them', async () => {
      const { svc, saved, client } = build(sampleOrders);
      const n = await svc.syncOrdersForCustomer(7, '555');
      expect(n).toBe(2);
      expect(saved).toHaveLength(2);
      expect(client.fetchOrders).toHaveBeenCalledWith(
        's.myshopify.com',
        't',
        expect.objectContaining({ customerId: '555' }),
      );
    });

    it('suppresses a repeat backfill for the same customer within the TTL', async () => {
      const { svc, client } = build(sampleOrders);
      await svc.syncOrdersForCustomer(7, '556');
      const again = await svc.syncOrdersForCustomer(7, '556');
      expect(again).toBe(0);
      expect(client.fetchOrders).toHaveBeenCalledTimes(1);
    });

    it('returns 0 without calling the Admin API when the store is not connected', async () => {
      const { svc, client } = build(sampleOrders, null);
      expect(await svc.syncOrdersForCustomer(7, '557')).toBe(0);
      expect(client.fetchOrders).not.toHaveBeenCalled();
    });
  });
});

/**
 * Money breakdown (PLN-260920 P2). The cache used to hold only the total, so
 * the widget could not draw "Discount / Subtotal · N items / Shipping". These
 * numbers are readable with `read_orders` alone — the point of the test is the
 * three rules around them: strings parse, 0 survives, and silence does not
 * overwrite what we already knew.
 */
describe('ShopifySyncService — order money breakdown', () => {
  function buildOne(prefetched?: Partial<OrderCache>) {
    const saved: OrderCache[] = [];
    const orderRepo = {
      findOne: jest.fn().mockResolvedValue(prefetched ? { ...prefetched } : null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((x: Partial<OrderCache>) => ({ ...x }) as OrderCache),
      save: jest.fn((x: OrderCache) => {
        saved.push(x);
        return Promise.resolve(x);
      }),
    };
    const itemRepo = {
      create: jest.fn((x: Record<string, unknown>) => ({ ...x })),
      delete: jest.fn().mockResolvedValue(undefined),
      save: jest.fn(async (rows: unknown[]) => rows),
    };
    const svc = new ShopifySyncService(
      orderRepo as never,
      itemRepo as never,
      { fetchOrders: jest.fn() } as never,
      { getShopifyConnection: jest.fn() } as never,
      { findOrCreateByEmail: jest.fn().mockResolvedValue({ id: 42 }) } as never,
      { upsert: jest.fn(), findByName: jest.fn() } as never,
      { publish: jest.fn(async () => undefined) } as never,
    );
    return { svc, saved };
  }

  it('maps string amounts and counts the summed quantity, not the row count', async () => {
    const { svc, saved } = buildOne();

    await svc.upsertOrder(1, {
      id: 1005,
      order_number: 1005,
      total_price: '55.00',
      subtotal_price: '59.99',
      total_discounts: '4.99',
      total_shipping_price_set: { shop_money: { amount: '0.00' } },
      line_items: [
        { title: 'Mask', quantity: 2, price: '4.99' },
        { title: 'Fan', quantity: 1, price: '4.99' },
      ],
    } as never);

    expect(saved[0]).toMatchObject({ subtotal: 59.99, discountTotal: 4.99, itemQty: 3 });
    // Free shipping: 0 is an answer, and must not be flattened to null.
    expect(saved[0].shippingTotal).toBe(0);
  });

  it('a minimal follow-up webhook does not wipe a breakdown we already have', async () => {
    const { svc, saved } = buildOne({
      id: 9,
      subtotal: 59.99,
      discountTotal: 4.99,
      shippingTotal: 0,
      itemQty: 3,
      currency: 'USD',
    });

    // orders/updated carrying nothing but a status change.
    await svc.upsertOrder(1, { id: 1005, financial_status: 'refunded' } as never);

    expect(saved[0]).toMatchObject({ subtotal: 59.99, discountTotal: 4.99, itemQty: 3 });
    expect(saved[0].shippingTotal).toBe(0);
  });
});
