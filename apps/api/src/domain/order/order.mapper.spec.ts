import { OrderMapper } from './order.mapper';
import { OrderCache } from './entity/order-cache.entity';
import { OrderItem } from './entity/order-item.entity';

/**
 * Contract pin for the widget (FIX-Widget-OrderDetail-Shape-20260803): the
 * detail payload is FLAT — order fields at the top level, `items` inline with
 * string ids the widget echoes back for reviews. A nested `order` wrapper (or
 * id-less items) breaks OrderDetailView rendering / the review button.
 */
describe('OrderMapper.toDetail (widget contract)', () => {
  it('returns flat order fields with inline items carrying string ids', () => {
    const order = Object.assign(new OrderCache(), {
      id: 4,
      orderNumber: '#1001',
      statusInternal: 'paid',
      statusUi: null,
      total: 42.5,
      currency: 'USD',
      createdAt: new Date('2026-07-30T19:49:28Z'),
    });
    const item = Object.assign(new OrderItem(), {
      id: 11,
      title: 'Ampoule',
      optionText: null,
      qty: 2,
      price: 21.25,
    });

    const detail = OrderMapper.toDetail(order, [item]);

    expect(detail).not.toHaveProperty('order'); // flat — no nested wrapper
    expect(detail.orderNumber).toBe('#1001');
    expect(typeof detail.statusUi).toBe('string'); // derived from statusInternal
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0]).toMatchObject({ id: '11', title: 'Ampoule', qty: 2 });
  });
});

/**
 * The widget's shipment cards read "<first item> + N more" (PLN-260817 W-2).
 * Before this, the list payload carried only `itemCount`, so the widget had to
 * choose between a detail fetch per row or showing no product name at all.
 */
describe('OrderMapper.toListItem (item summary)', () => {
  const order = () =>
    Object.assign(new OrderCache(), {
      id: 9,
      orderNumber: 'IVY-39891',
      statusInternal: 'paid',
      statusUi: null,
      total: 55,
      currency: 'USD',
      createdAt: new Date('2026-08-17T00:00:00Z'),
      orderedAt: null,
    });

  it('carries the first line item title alongside the count', () => {
    const row = OrderMapper.toListItem(order(), { count: 3, firstTitle: 'Vitamin C Serum Set' });
    expect(row).toMatchObject({ itemCount: 3, firstItemTitle: 'Vitamin C Serum Set' });
  });

  it('an order with no cached items yields a null title, not a crash', () => {
    const row = OrderMapper.toListItem(order(), { count: 0, firstTitle: null });
    expect(row.itemCount).toBe(0);
    expect(row.firstItemTitle).toBeNull();
  });
});

/**
 * Order detail gained a money breakdown, the shopper's own contact pair and a
 * per-line picture (PLN-260920 P2/P3/P4). All of it is additive and nullable:
 * an order cached before those columns existed must still map, and a missing
 * subtotal must travel as null — the widget hides that row, and a 0 would be a
 * claim the sync never made.
 */
describe('OrderMapper.toDetail — money, contact, images (PLN-260920)', () => {
  const base = () =>
    Object.assign(new OrderCache(), {
      id: 7,
      orderNumber: '1005',
      statusInternal: 'paid',
      statusUi: null,
      total: 55,
      currency: 'USD',
      createdAt: new Date('2026-09-20T00:00:00Z'),
    });
  const line = (over: Partial<OrderItem> = {}) =>
    Object.assign(new OrderItem(), { id: 11, title: 'Face Mask', optionText: null, qty: 3, price: 4.99 }, over);

  it('carries the breakdown through when the sync knows it', () => {
    const order = Object.assign(base(), {
      subtotal: 55,
      discountTotal: 4.99,
      shippingTotal: 0,
      itemQty: 3,
    });

    const detail = OrderMapper.toDetail(order, [line()]);

    expect(detail).toMatchObject({ subtotal: 55, discountTotal: 4.99, itemQty: 3 });
    // Free shipping is a real answer, not a missing one.
    expect(detail.shippingTotal).toBe(0);
  });

  it('keeps unknown money as null rather than zero', () => {
    const detail = OrderMapper.toDetail(base(), [line()]);
    expect(detail.subtotal).toBeNull();
    expect(detail.discountTotal).toBeNull();
    expect(detail.shippingTotal).toBeNull();
    expect(detail.itemQty).toBeNull();
  });

  it('includes the bound customer as the contact, and null when there is none', () => {
    const withContact = OrderMapper.toDetail(base(), [line()], {
      name: 'Hyein Kim',
      email: 'hykim4@example.com',
    });
    expect(withContact).toMatchObject({ contactName: 'Hyein Kim', contactEmail: 'hykim4@example.com' });

    const without = OrderMapper.toDetail(base(), [line()], null);
    expect(without.contactName).toBeNull();
    expect(without.contactEmail).toBeNull();
  });

  it('attaches a picture only to the line it was resolved for', () => {
    const images = new Map([['11', 'https://cdn.example/a.jpg']]);
    const detail = OrderMapper.toDetail(base(), [line(), line({ id: 12, title: 'Fan' })], null, images);

    expect(detail.items[0].imageUrl).toBe('https://cdn.example/a.jpg');
    expect(detail.items[1].imageUrl).toBeNull(); // unmatched → placeholder, not a wrong picture
  });
});
