import { OrderService } from './order.service';

/**
 * `reviewItemsForSession` — the widget's Review chip (PLN-260923 P3).
 */
describe('OrderService.reviewItemsForSession', () => {
  function build(opts: {
    session?: { customerId: string | null; tenantId: string | null };
    orders?: Array<Record<string, unknown>>;
    items?: Array<Record<string, unknown>>;
    reviews?: Array<Record<string, unknown>>;
  }) {
    const wheres: Array<{ clause: string; params: unknown }> = [];
    const qb: Record<string, unknown> = {
      where: jest.fn((clause: string, params: unknown) => (wheres.push({ clause, params }), qb)),
      andWhere: jest.fn((clause: string, params: unknown) => (wheres.push({ clause, params }), qb)),
      orderBy: jest.fn(() => qb),
      take: jest.fn(() => qb),
      getMany: jest.fn().mockResolvedValue(opts.orders ?? []),
    };
    const itemRepo = { find: jest.fn().mockResolvedValue(opts.items ?? []) };
    const reviewRepo = { find: jest.fn().mockResolvedValue(opts.reviews ?? []) };
    const productRepo = {
      createQueryBuilder: jest.fn(() => {
        const p: Record<string, unknown> = {
          select: jest.fn(() => p),
          where: jest.fn(() => p),
          andWhere: jest.fn(() => p),
          getMany: jest.fn().mockResolvedValue([]),
        };
        return p;
      }),
    };
    const svc = new OrderService(
      { createQueryBuilder: jest.fn(() => qb) } as never,
      itemRepo as never,
      {} as never, // fulfillRepo
      {} as never, // sessionRepo
      { findOne: jest.fn().mockResolvedValue({ tenantId: '9' }) } as never, // customerRepo
      {} as never, // bus
      {} as never, // redis
      {} as never, // webhookSecretService
      {
        requireCustomer: jest
          .fn()
          .mockResolvedValue(opts.session ?? { customerId: '7', tenantId: '1' }),
      } as never,
      productRepo as never,
      reviewRepo as never,
    );
    return { svc, wheres, itemRepo, reviewRepo };
  }

  // String ids, as TypeORM returns bigint columns.
  const order = (id: string, n: string) => ({
    id,
    orderNumber: n,
    currency: 'USD',
    orderedAt: new Date('2026-09-20T00:00:00Z'),
    createdAt: new Date('2026-09-20T00:00:00Z'),
  });
  const item = (id: string, orderId: string, extra: Record<string, unknown> = {}) => ({
    id,
    orderId,
    title: `Item ${id}`,
    optionText: null,
    price: 10,
    imageUrl: 'https://cdn/i.jpg',
    productUrl: null,
    ...extra,
  });

  it('scopes by tenant AND customer and asks for delivered orders only', async () => {
    const { svc, wheres } = build({});
    await svc.reviewItemsForSession('tok');
    const text = wheres.map((w) => w.clause).join(' ');
    expect(text).toContain('o.customer_id = :customerId');
    expect(text).toContain('o.tenant_id = :tenantId');
    // Either delivered signal counts — the sync can walk a delivered order back to "shipping".
    expect(text).toContain('o.status_internal = :orderDelivered');
    expect(text).toContain('f.status = :shipDelivered');
    expect(wheres.find((w) => w.clause.includes('tenant_id'))?.params).toEqual({ tenantId: '1' });
  });

  it('recovers the tenant from the customer when the session predates binding', async () => {
    const { svc, wheres } = build({ session: { customerId: '7', tenantId: null } });
    await svc.reviewItemsForSession('tok');
    expect(wheres.find((w) => w.clause.includes('tenant_id'))?.params).toEqual({ tenantId: '9' });
  });

  it('returns nothing (and skips the item query) when no order is delivered', async () => {
    const { svc, itemRepo } = build({ orders: [] });
    await expect(svc.reviewItemsForSession('tok')).resolves.toEqual([]);
    expect(itemRepo.find).not.toHaveBeenCalled();
  });

  it('lists lines newest order first, with productUrl and the reviewed flag', async () => {
    const { svc, reviewRepo } = build({
      orders: [order('2', '1002'), order('1', '1001')],
      items: [
        item('11', '1'),
        item('21', '2', { productUrl: 'https://s.example/products/a' }),
        item('22', '2'),
      ],
      reviews: [{ orderItemId: '22' }],
    });
    const out = await svc.reviewItemsForSession('tok');
    expect(out.map((r) => r.orderItemId)).toEqual(['21', '22', '11']);
    expect(out[0]).toMatchObject({ orderNumber: '1002', productUrl: 'https://s.example/products/a', reviewed: false });
    expect(out[1]).toMatchObject({ reviewed: true, productUrl: null });
    // Only this customer's reviews count.
    expect(reviewRepo.find.mock.calls[0][0].where.customerId).toBe('7');
  });
});
