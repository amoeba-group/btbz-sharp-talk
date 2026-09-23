import { ShopifyWebhookService } from './shopify-webhook.service';

/** ShopifyWebhookService — tenant resolution + fulfillment status mapping. */
describe('ShopifyWebhookService', () => {
  function build(opts: { tenant?: unknown; order?: unknown } = {}) {
    const orderRepo = { findOne: jest.fn().mockResolvedValue(opts.order ?? null) };
    const tenantService = {
      findByShopDomain: jest.fn().mockResolvedValue(opts.tenant ?? null),
    };
    const syncService = { upsertOrder: jest.fn().mockResolvedValue(undefined) };
    const orderService = {
      applyFulfillment: jest.fn().mockResolvedValue(undefined),
      handleFulfillmentWebhook: jest.fn().mockResolvedValue(undefined),
    };
    const svc = new ShopifyWebhookService(
      orderRepo as never,
      tenantService as never,
      syncService as never,
      orderService as never,
    );
    return { svc, syncService, orderService, orderRepo };
  }

  it('ignores an order webhook for an unknown shop', async () => {
    const { svc, syncService } = build({ tenant: null });
    await svc.handleOrderUpsert('nope.myshopify.com', { id: 1 });
    expect(syncService.upsertOrder).not.toHaveBeenCalled();
  });

  it('upserts an order for a known shop', async () => {
    const { svc, syncService } = build({ tenant: { id: 7 } });
    await svc.handleOrderUpsert('ivyusa.myshopify.com', { id: 1, order_number: 5 });
    expect(syncService.upsertOrder).toHaveBeenCalledWith(7, { id: 1, order_number: 5 });
  });

  it('advances a cached order to the mapped fulfillment status', async () => {
    const cases: Array<[string | null, string]> = [
      ['delivered', 'delivered'],
      ['in_transit', 'in_transit'],
      ['out_for_delivery', 'in_transit'],
      [null, 'shipped'],
    ];
    for (const [shipment, expected] of cases) {
      const order = { id: 42 };
      const { svc, orderService } = build({ tenant: { id: 7 }, order });
      await svc.handleFulfillment('ivyusa.myshopify.com', {
        order_id: 900001,
        shipment_status: shipment,
        tracking_number: 'TN1',
        tracking_company: 'UPS',
      });
      // Applies via the already-HMAC-verified path (passes the order entity), never
      // through the generic X-Webhook-Secret-gated handleFulfillmentWebhook.
      expect(orderService.applyFulfillment).toHaveBeenCalledWith(order, expected, 'TN1', 'UPS', undefined);
      expect(orderService.handleFulfillmentWebhook).not.toHaveBeenCalled();
    }
  });

  it('passes the carrier tracking link through, falling back to tracking_urls[0] (PLN-260923 P2)', async () => {
    const order = { id: 42 };
    const direct = build({ tenant: { id: 7 }, order });
    await direct.svc.handleFulfillment('ivyusa.myshopify.com', {
      order_id: 900001,
      tracking_number: 'TN1',
      tracking_company: 'UPS',
      tracking_url: 'https://www.ups.com/track?tracknum=TN1',
      tracking_urls: ['https://other.example/1'],
    });
    expect(direct.orderService.applyFulfillment).toHaveBeenCalledWith(
      order, 'shipped', 'TN1', 'UPS', 'https://www.ups.com/track?tracknum=TN1',
    );

    const listOnly = build({ tenant: { id: 7 }, order });
    await listOnly.svc.handleFulfillment('ivyusa.myshopify.com', {
      order_id: 900001,
      tracking_urls: ['https://parcel.example/2'],
    });
    expect(listOnly.orderService.applyFulfillment).toHaveBeenCalledWith(
      order, 'shipped', undefined, undefined, 'https://parcel.example/2',
    );
  });

  it('ignores a fulfillment for an uncached order', async () => {
    const { svc, orderService } = build({ tenant: { id: 7 }, order: null });
    await svc.handleFulfillment('ivyusa.myshopify.com', { order_id: 900001, shipment_status: 'delivered' });
    expect(orderService.applyFulfillment).not.toHaveBeenCalled();
  });
});
