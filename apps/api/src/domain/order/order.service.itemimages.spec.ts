import { OrderService } from './order.service';
import { OrderCache } from './entity/order-cache.entity';
import { OrderItem } from './entity/order-item.entity';

/**
 * Line item → catalogue picture (PLN-260920 P4).
 *
 * The catalogue is keyed on `handle` and an order line carries the platform's
 * product id, so the join needed a new column — and because the scheduled
 * GraphQL sync cannot read product ids without the `read_products` scope, most
 * lines arrive with nothing but a title. Hence two passes, and hence the rule
 * the last test pins: titles match WHOLE or not at all.
 */
describe('OrderService — order detail item pictures', () => {
  const CATALOGUE = [
    { externalId: '111', title: 'Hydrating Face Mask (10pcs)', imageUrl: 'https://cdn/mask.jpg' },
    { externalId: '222', title: 'Ultra Mini Portable Fan', imageUrl: 'https://cdn/fan.jpg' },
    { externalId: '333', title: 'Fan Cover', imageUrl: 'https://cdn/cover.jpg' },
  ];

  /** Stands in for the query builder, applying the same filters SQL would. */
  function productRepo(rows = CATALOGUE) {
    const where: Record<string, unknown> = {};
    const qb = {
      select: () => qb,
      where: (_c: string, p?: Record<string, unknown>) => (Object.assign(where, p), qb),
      andWhere: (_c: string, p?: Record<string, unknown>) => (Object.assign(where, p), qb),
      getMany: async () => {
        const ids = (where.ids as string[]) ?? [];
        const titles = (where.titles as string[]) ?? [];
        return rows.filter(
          (r) =>
            ids.includes(r.externalId) ||
            titles.includes(r.title.trim().replace(/\s+/g, ' ').toLowerCase()),
        );
      },
    };
    return { createQueryBuilder: () => qb };
  }

  /** Only the three collaborators this path touches; the rest stay undefined. */
  function service(repo: unknown) {
    const items = [] as OrderItem[];
    const svc = new OrderService(
      { findOne: jest.fn() } as never,
      { find: jest.fn().mockResolvedValue(items) } as never,
      {} as never,
      {} as never,
      { findOne: jest.fn().mockResolvedValue(null) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      repo as never,
    );
    return svc;
  }

  const line = (over: Partial<OrderItem>) =>
    Object.assign(new OrderItem(), { id: 1, title: 'X', optionText: null, qty: 1, price: 1 }, over);

  /** The private resolver is the unit under test; the route is covered elsewhere. */
  const resolve = (svc: OrderService, tenantId: number | null, items: OrderItem[]) =>
    (svc as unknown as {
      itemImages(t: number | null, i: OrderItem[]): Promise<Map<string, string>>;
    }).itemImages(tenantId, items);

  it('matches on the product id first — the only key a retitled product survives', async () => {
    const svc = service(productRepo());
    const images = await resolve(svc, 1, [line({ id: 10, productId: '222', title: 'Renamed Fan' })]);
    expect(images.get('10')).toBe('https://cdn/fan.jpg');
  });

  it('falls back to the title when the line has no product id (the GraphQL case)', async () => {
    const svc = service(productRepo());
    const images = await resolve(svc, 1, [
      line({ id: 11, productId: null, title: '  hydrating face mask (10PCS) ' }),
    ]);
    // Case and stray whitespace are noise; the product is the same one.
    expect(images.get('11')).toBe('https://cdn/mask.jpg');
  });

  it('never matches a title by substring — "Fan Cover" is not "Ultra Mini Portable Fan"', async () => {
    const svc = service(productRepo());
    const images = await resolve(svc, 1, [line({ id: 12, productId: null, title: 'Fan' })]);
    // A LIKE '%Fan%' would have picked one of two different products at random.
    expect(images.has('12')).toBe(false);
  });

  it('returns nothing to draw when the line matches no catalogue row', async () => {
    const svc = service(productRepo());
    const images = await resolve(svc, 1, [line({ id: 13, productId: '999', title: 'Snowboard' })]);
    expect(images.size).toBe(0);
  });

  it('does not query at all without a tenant', async () => {
    const repo = productRepo();
    const spy = jest.spyOn(repo, 'createQueryBuilder');
    const images = await resolve(service(repo), null, [line({ id: 14 })]);
    expect(images.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
