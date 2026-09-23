import { OrderService } from './order.service';

/**
 * Track → the carrier's own page (PLN-260923 P2), and the fulfillment rows
 * that feed it carrying their tenant (G8).
 */
describe('OrderService tracking', () => {
  function build(fulfillment: Record<string, unknown> | null) {
    // `id`/`customerId` as strings: TypeORM returns bigint columns that way.
    const order = { id: '42', tenantId: '1', customerId: '7', statusInternal: 'paid', statusUi: 'Confirmed' };
    const saved: Array<Record<string, unknown>> = [];
    const fulfillRepo = {
      findOne: jest.fn().mockResolvedValue(fulfillment),
      create: jest.fn((v: Record<string, unknown>) => ({ ...v })),
      save: jest.fn(async (v: Record<string, unknown>) => {
        saved.push(v);
        return v;
      }),
    };
    const orderRepo = {
      findOne: jest.fn().mockResolvedValue(order),
      save: jest.fn(async (v: unknown) => v),
    };
    const sessionService = {
      requireCustomer: jest.fn().mockResolvedValue({ customerId: '7', tenantId: '1', language: 'en' }),
    };
    const bus = { publish: jest.fn().mockResolvedValue(undefined) };
    const svc = new OrderService(
      orderRepo as never,
      {} as never, // itemRepo
      fulfillRepo as never,
      {} as never, // sessionRepo
      {} as never, // customerRepo
      bus as never,
      {} as never, // redis
      {} as never, // webhookSecretService
      sessionService as never,
      {} as never, // productRepo
    );
    return { svc, order, saved };
  }

  describe('trackingForSession → trackingUrl', () => {
    it('prefers the link the platform gave', async () => {
      const { svc } = build({
        status: 'in_transit',
        carrier: 'UPS',
        trackingNumber: '1Z1',
        trackingUrl: 'https://carrier.example/t/1Z1',
      });
      await expect(svc.trackingForSession('tok', 42)).resolves.toMatchObject({
        trackingUrl: 'https://carrier.example/t/1Z1',
      });
    });

    it('builds one from carrier + number when none was stored', async () => {
      const { svc } = build({ status: 'delivered', carrier: 'UPS', trackingNumber: '1Z999AA10123456785', trackingUrl: null });
      await expect(svc.trackingForSession('tok', 42)).resolves.toMatchObject({
        trackingUrl: 'https://www.ups.com/track?tracknum=1Z999AA10123456785',
      });
    });

    it('is null for an unknown carrier or no fulfillment — the widget keeps its stepper', async () => {
      await expect(
        build({ status: 'shipped', carrier: 'Local Courier', trackingNumber: 'X', trackingUrl: null }).svc.trackingForSession('tok', 42),
      ).resolves.toMatchObject({ trackingUrl: null });
      await expect(build(null).svc.trackingForSession('tok', 42)).resolves.toMatchObject({
        trackingUrl: null,
        status: 'preparing',
      });
    });

    it('never serves a stored non-http link', async () => {
      const { svc } = build({ status: 'shipped', carrier: null, trackingNumber: null, trackingUrl: 'javascript:alert(1)' });
      await expect(svc.trackingForSession('tok', 42)).resolves.toMatchObject({ trackingUrl: null });
    });
  });

  describe('applyFulfillment', () => {
    it('stamps the order tenant and keeps a safe tracking link on a new row', async () => {
      const { svc, order, saved } = build(null);
      await svc.applyFulfillment(order as never, 'shipped', '1Z1', 'UPS', 'https://www.ups.com/track?tracknum=1Z1');
      expect(saved[0]).toMatchObject({
        tenantId: '1',
        orderId: '42',
        trackingUrl: 'https://www.ups.com/track?tracknum=1Z1',
      });
    });

    it('drops an unsafe link and repairs a tenant-less existing row', async () => {
      const existing = { orderId: '42', tenantId: null, status: 'shipped', trackingNumber: '1Z1', carrier: 'UPS', trackingUrl: null };
      const { svc, order, saved } = build(existing);
      await svc.applyFulfillment(order as never, 'delivered', undefined, undefined, 'data:text/html,x');
      expect(saved[0]).toMatchObject({ tenantId: '1', trackingUrl: null, status: 'delivered', trackingNumber: '1Z1' });
    });
  });
});
