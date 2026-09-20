import { ShopifyAdminClient } from './shopify-admin.client';

/**
 * Line-item selection tiers (PLN-260920 §7 follow-up).
 *
 * `read_products` is declared by the app now, but a store keeps the grant it
 * installed under until it re-authorises — and asking for a field the token
 * cannot read fails the WHOLE query, not just that field. So the client walks
 * rich → basic → none, and only on a scope denial. The cost of getting this
 * wrong is not cosmetic: dropping straight to `none` would stop caching line
 * items at every store that has not re-authorised yet.
 */
describe('ShopifyAdminClient — line item tier negotiation', () => {
  const ACCESS_DENIED = new Error('Access denied for lineItems field');
  const page = {
    data: {
      orders: {
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            legacyResourceId: '1005',
            name: '#1005',
            lineItems: {
              nodes: [
                {
                  title: 'Ultra Mini Portable Fan',
                  quantity: 2,
                  originalUnitPriceSet: { shopMoney: { amount: '4.99' } },
                  variant: {
                    title: 'Burgundy / 6-8',
                    image: { url: 'https://cdn/variant.jpg' },
                    product: {
                      legacyResourceId: '222',
                      featuredImage: { url: 'https://cdn/product.jpg' },
                    },
                  },
                },
              ],
            },
          },
        ],
      },
    },
  };

  /** Stubs the GraphQL call and records the query text each attempt sent. */
  function client(behaviour: (attempt: number, query: string) => unknown) {
    const c = new ShopifyAdminClient();
    const queries: string[] = [];
    (c as unknown as { gql: unknown }).gql = jest.fn(
      async (_shop: string, _token: string, query: string) => {
        queries.push(query);
        const out = behaviour(queries.length, query);
        if (out instanceof Error) throw out;
        return out;
      },
    );
    return { c, queries };
  }

  it('asks for the variant and its picture first, and maps them', async () => {
    const { c, queries } = client(() => page);

    const { orders } = await c.fetchOrders('s.myshopify.com', 't');

    expect(queries[0]).toContain('variant {');
    const li = orders[0].line_items?.[0];
    expect(li).toMatchObject({
      product_id: '222',
      variant_title: 'Burgundy / 6-8',
      image_url: 'https://cdn/variant.jpg', // variant beats the product image
    });
  });

  it('falls back to the basic selection when the token cannot read products', async () => {
    const basicPage = {
      data: {
        orders: {
          pageInfo: {},
          nodes: [
            {
              legacyResourceId: '1005',
              lineItems: {
                nodes: [{ title: 'Ski Wax', quantity: 1, originalUnitPriceSet: { shopMoney: { amount: '24.95' } } }],
              },
            },
          ],
        },
      },
    };
    const { c, queries } = client((attempt) => (attempt === 1 ? ACCESS_DENIED : basicPage));

    const { orders } = await c.fetchOrders('s.myshopify.com', 't');

    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('variant {');
    expect(queries[1]).toContain('lineItems'); // still caching what was bought
    expect(queries[1]).not.toContain('variant {');
    expect(orders[0].line_items?.[0]).toMatchObject({ title: 'Ski Wax', image_url: null });
  });

  it('drops line items entirely only when even the basic selection is denied', async () => {
    const bare = { data: { orders: { pageInfo: {}, nodes: [{ legacyResourceId: '1005' }] } } };
    const { c, queries } = client((attempt) => (attempt <= 2 ? ACCESS_DENIED : bare));

    const { orders } = await c.fetchOrders('s.myshopify.com', 't');

    expect(queries).toHaveLength(3);
    expect(queries[2]).not.toContain('lineItems');
    // undefined, not [] — the upsert must leave cached items alone.
    expect(orders[0].line_items).toBeUndefined();
  });

  it('does not retry a failure that is not about scope', async () => {
    const boom = new Error('502 Bad Gateway');
    const { c, queries } = client(() => boom);

    await expect(c.fetchOrders('s.myshopify.com', 't')).rejects.toThrow('502');
    expect(queries).toHaveLength(1);
  });

  it('treats Shopify\'s "Default Title" placeholder as no option text', async () => {
    const noOptions = JSON.parse(JSON.stringify(page));
    noOptions.data.orders.nodes[0].lineItems.nodes[0].variant = {
      title: 'Default Title',
      image: null,
      product: { legacyResourceId: '222', featuredImage: { url: 'https://cdn/product.jpg' } },
    };
    const { c } = client(() => noOptions);

    const { orders } = await c.fetchOrders('s.myshopify.com', 't');

    expect(orders[0].line_items?.[0]).toMatchObject({
      variant_title: null,
      image_url: 'https://cdn/product.jpg', // no variant picture → product's
    });
  });
});
