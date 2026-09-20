import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CJM_STAGE, ORDER_STATUS_INTERNAL, internalToUiStatus } from '@sharptalk/types';
import { OrderCache } from './entity/order-cache.entity';
import { OrderItem } from './entity/order-item.entity';
import { ShopifyAdminClient, ShopifyOrderDto } from './shopify-admin.client';
import { TenantService } from '../tenant/tenant.service';
import { CustomerService } from '../customer/customer.service';
import { IntegrationService } from '../integration/integration.service';
import { EventBusService, EVENTS } from '../../infrastructure/infrastructure.module';

/**
 * Shopify money → number. Amounts arrive as strings ("55.00"), sometimes as
 * numbers, and sometimes not at all. `null` means "the payload said nothing",
 * which callers must not confuse with 0 (PLN-260920 P2).
 */
function money(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const SHOPIFY = 'shopify';
/** Overlap subtracted from the last_sync_at cursor — upserts are idempotent, so
 *  re-pulling a few minutes protects against clock skew and error-stamped cursors. */
const CURSOR_LOOKBACK_MS = 10 * 60_000;
/** Page cap per run (50 orders each) — bounds a single sync's work. */
const MAX_PAGES = 10;
/** Per-customer login backfill: page cap and re-run suppression window. */
const CUSTOMER_BACKFILL_MAX_PAGES = 2;
const CUSTOMER_BACKFILL_TTL_MS = 10 * 60_000;

/** Shopify topic → our webhook path (under /api/v1/webhooks/shopify/). */
const WEBHOOK_TOPICS: Array<{ topic: string; path: string }> = [
  { topic: 'orders/create', path: 'orders/create' },
  { topic: 'orders/updated', path: 'orders/updated' },
  { topic: 'fulfillments/create', path: 'fulfillments/create' },
  { topic: 'fulfillments/update', path: 'fulfillments/update' },
];

export interface ShopifySyncResult {
  ok: boolean;
  synced: number;
  detail: string;
}

export interface ShopifyWebhookRegisterResult {
  ok: boolean;
  registered: number;
  existing: number;
  failed: number;
  detail: string;
}

/**
 * Pulls orders (and their customers) from the Shopify Admin API into the local
 * cache (orders_cache / customers). On-demand; records the result in
 * integration_status. Fail-safe: any error → 'error', partial rows are kept.
 */
@Injectable()
export class ShopifySyncService {
  private readonly logger = new Logger(ShopifySyncService.name);

  constructor(
    @InjectRepository(OrderCache) private readonly orderRepo: Repository<OrderCache>,
    @InjectRepository(OrderItem) private readonly itemRepo: Repository<OrderItem>,
    private readonly client: ShopifyAdminClient,
    private readonly tenantService: TenantService,
    private readonly customerService: CustomerService,
    private readonly integrationService: IntegrationService,
    private readonly bus: EventBusService,
  ) {}

  async syncOrders(tenantId: number): Promise<ShopifySyncResult> {
    const conn = await this.tenantService.getShopifyConnection(tenantId);
    if (!conn) {
      return this.record(
        false,
        0,
        'Shopify shop domain or a valid access token is missing — reconnect the store',
      );
    }

    // Incremental cursor (PERF-5): last_sync_at minus a lookback overlap.
    const status = await this.integrationService.findByName(SHOPIFY);
    const since = status?.lastSyncAt
      ? new Date(status.lastSyncAt.getTime() - CURSOR_LOOKBACK_MS).toISOString()
      : undefined;

    let synced = 0;
    let pages = 0;
    let pageInfo: string | null = null;
    try {
      do {
        const page = await this.client.fetchOrders(conn.shopDomain, conn.token, {
          updatedAtMin: pageInfo ? undefined : since,
          pageInfo: pageInfo ?? undefined,
        });
        synced += await this.upsertPage(tenantId, page.orders);
        pageInfo = page.nextPageInfo;
        pages++;
      } while (pageInfo && pages < MAX_PAGES);
    } catch (e) {
      if (synced === 0) return this.record(false, 0, `Sync failed: ${(e as Error).message}`);
      // Partial progress is kept; report it but flag the interruption.
      return this.record(true, synced, `Synced ${synced} order(s), interrupted: ${(e as Error).message}`);
    }
    const detail = since
      ? `Synced ${synced} order(s) updated since ${since}`
      : `Synced ${synced} order(s) (initial full sync${pageInfo ? ', more pages remain' : ''})`;
    return this.record(true, synced, detail);
  }

  /**
   * Pull one customer's orders into the cache (login-time backfill). The full
   * sync + webhooks only cover orders placed after the store connected, so a
   * customer signing in for the first time would otherwise see an empty "my
   * orders". Bounded (2 pages = 100 orders) and suppressed per customer for
   * 10 min — identity resolves on every storefront page load.
   */
  async syncOrdersForCustomer(tenantId: number, shopifyCustomerId: string): Promise<number> {
    const key = `${tenantId}:${shopifyCustomerId}`;
    const now = Date.now();
    const last = this.customerBackfillAt.get(key);
    if (last && now - last < CUSTOMER_BACKFILL_TTL_MS) return 0;
    if (this.customerBackfillAt.size > 5_000) this.customerBackfillAt.clear(); // cheap bound
    this.customerBackfillAt.set(key, now);

    const conn = await this.tenantService.getShopifyConnection(tenantId);
    if (!conn) return 0;
    let synced = 0;
    let pages = 0;
    let pageInfo: string | null = null;
    do {
      const page = await this.client.fetchOrders(conn.shopDomain, conn.token, {
        customerId: pageInfo ? undefined : shopifyCustomerId,
        pageInfo: pageInfo ?? undefined,
      });
      synced += await this.upsertPage(tenantId, page.orders);
      pageInfo = page.nextPageInfo;
      pages++;
    } while (pageInfo && pages < CUSTOMER_BACKFILL_MAX_PAGES);
    if (synced > 0) this.logger.log(`Backfilled ${synced} order(s) for customer ${key}`);
    return synced;
  }

  /** Last backfill instant per `${tenantId}:${shopifyCustomerId}` (see TTL above). */
  private readonly customerBackfillAt = new Map<string, number>();

  /** Upsert one page with the existing rows prefetched in a single IN() query. */
  private async upsertPage(tenantId: number, orders: ShopifyOrderDto[]): Promise<number> {
    if (!orders.length) return 0;
    const ids = orders.map((o) => String(o.id));
    const existing = await this.orderRepo.find({ where: { shopifyOrderId: In(ids) } });
    const byShopifyId = new Map(existing.map((r) => [r.shopifyOrderId, r]));
    let synced = 0;
    for (const order of orders) {
      try {
        await this.upsertOrder(tenantId, order, byShopifyId.get(String(order.id)));
        synced++;
      } catch (e) {
        this.logger.warn(`Skipped order ${order.id}: ${(e as Error).message}`);
      }
    }
    return synced;
  }

  /**
   * Subscribe the store to our order/fulfillment webhooks (uses the stored token).
   * Idempotent — a topic already subscribed counts as 'existing', not a failure.
   * Note: HMAC verification needs SHOPIFY_WEBHOOK_SECRET = the app's API secret key.
   */
  async registerWebhooks(tenantId: number): Promise<ShopifyWebhookRegisterResult> {
    const conn = await this.tenantService.getShopifyConnection(tenantId);
    if (!conn) {
      return {
        ok: false,
        registered: 0,
        existing: 0,
        failed: 0,
        detail: 'Shopify credential missing or invalid — reconnect the store',
      };
    }
    const base = (process.env.SHOPIFY_APP_URL ?? '').replace(/\/+$/, '');
    if (!base) {
      return {
        ok: false,
        registered: 0,
        existing: 0,
        failed: 0,
        detail: 'SHOPIFY_APP_URL is not set (needed for the webhook address)',
      };
    }

    let registered = 0;
    let existing = 0;
    let failed = 0;
    for (const { topic, path } of WEBHOOK_TOPICS) {
      const address = `${base}/api/v1/webhooks/shopify/${path}`;
      try {
        const r = await this.client.createWebhook(conn.shopDomain, conn.token, topic, address);
        if (r === 'created') registered++;
        else existing++;
      } catch (e) {
        failed++;
        this.logger.warn(`Register webhook ${topic} failed: ${(e as Error).message}`);
      }
    }
    return {
      ok: failed === 0,
      registered,
      existing,
      failed,
      detail: `Registered ${registered}, already present ${existing}, failed ${failed}`,
    };
  }

  /** Map a Shopify order → orders_cache (+ linked customer). Public: reused by webhooks. */
  async upsertOrder(tenantId: number, o: ShopifyOrderDto, prefetched?: OrderCache): Promise<OrderCache> {
    let customerId: number | null = null;
    // Erased identities come back null. Shopify still holds the address after we
    // scrub it, so this is the poll that used to undo an erasure minutes later.
    let identityErased = false;
    const email = o.customer?.email ?? o.email ?? null;
    if (email) {
      const name =
        [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(' ') || undefined;
      const shopifyCustomerId = o.customer?.id != null ? String(o.customer.id) : undefined;
      const customer = await this.customerService.findOrCreateByEmail(
        tenantId,
        email,
        name,
        shopifyCustomerId,
      );
      if (customer) customerId = customer.id;
      else identityErased = true;
    }

    const internal = this.mapStatus(o.financial_status, o.fulfillment_status);
    const shopifyOrderId = String(o.id);
    // Store the bare number. Webhooks carry `order_number` (1002) while the
    // GraphQL sync only has `name` ("#1002"), so the same order flipped format
    // depending on which path touched it last — that broke guest lookup (an exact
    // string match against what the shopper types) and made the UI, which adds its
    // own '#', render "##1002".
    const orderNumber = (
      o.order_number != null ? String(o.order_number) : o.name ?? shopifyOrderId
    ).replace(/^#/, '');
    const total = money(o.total_price);
    // Breakdown (PLN-260920 P2). `null` when the payload is silent — a minimal
    // orders/updated webhook must not overwrite a known subtotal with nothing,
    // so the assignment below keeps the cached value in that case. Zero is a
    // real answer though (free shipping), which is why this is not `|| null`.
    const subtotal = money(o.subtotal_price);
    const discountTotal = money(o.total_discounts);
    const shippingTotal = money(o.total_shipping_price_set?.shop_money?.amount);
    // Summed QUANTITY, not the number of rows: "Subtotal · 3 items" counts what
    // the shopper bought. Only when the payload actually carries the lines.
    const itemQty = Array.isArray(o.line_items)
      ? o.line_items.reduce((n, li) => n + (li.quantity != null && li.quantity > 0 ? li.quantity : 1), 0)
      : null;

    let row =
      prefetched ??
      (await this.orderRepo.findOne({
        where: { tenantId, provider: SHOPIFY, shopifyOrderId },
      }));
    const isNew = !row;
    if (!row) {
      row = this.orderRepo.create({ provider: SHOPIFY, shopifyOrderId });
    }
    row.tenantId = tenantId;
    // Never downgrade a known link to NULL. A later payload can legitimately carry
    // no customer/email — Shopify redacts protected customer fields until PCD is
    // approved, and an orders/updated webhook can arrive minimal — and blindly
    // assigning `customerId` then unlinked an order the shopper had been seeing,
    // silently: the order stays in the cache but drops out of "my orders" forever,
    // with nothing logged. Resolved wins, otherwise keep what we already knew.
    // Erasure overrides the keep-what-we-knew rule below: the order stays cached for
    // the merchant's books but must not point at the person who asked to be deleted.
    row.customerId = identityErased ? null : customerId ?? row.customerId ?? null;
    row.orderNumber = orderNumber;
    row.statusInternal = internal;
    row.statusUi = internalToUiStatus(internal);
    row.total = total;
    row.subtotal = subtotal ?? row.subtotal ?? null;
    row.discountTotal = discountTotal ?? row.discountTotal ?? null;
    row.shippingTotal = shippingTotal ?? row.shippingTotal ?? null;
    row.itemQty = itemQty ?? row.itemQty ?? null;
    row.currency = o.currency ?? row.currency ?? 'USD';
    // Order-placed time when the payload names it; otherwise keep what we had —
    // the widget's recent-orders window falls back to the cache-insert time.
    if (o.created_at) {
      const placed = new Date(o.created_at);
      if (!Number.isNaN(placed.getTime())) row.orderedAt = placed;
    }
    const saved = await this.orderRepo.save(row);
    await this.syncLineItems(tenantId, saved.id, o);

    // Journey breadcrumb (PLN-260807 F3, A-7): only a genuinely NEW cached order
    // with a known customer — orders/updated webhooks and re-sync passes hit the
    // same upsert, and re-emitting would fake repeat purchases on the timeline.
    // Fire-and-forget: a bus hiccup must never fail the webhook/sync path.
    if (isNew && saved.customerId != null) {
      void this.bus
        .publish(EVENTS.CJM, {
          tenantId,
          customerId: saved.customerId,
          stage: CJM_STAGE.PURCHASE,
          eventType: 'order_created',
          payload: { orderNumber: saved.orderNumber },
        })
        .catch((e) => this.logger.warn(`order_created CJM emit failed: ${(e as Error).message}`));
    }
    return saved;
  }

  /**
   * Mirror the order's line items into order_items so the widget can show WHAT
   * was bought (FR-020), not just the total. Replace-on-write keeps the cache in
   * step with edits/refunds that change the cart. `line_items` absent (a payload
   * that simply doesn't carry them) leaves existing rows untouched; an explicit
   * empty array clears them. Never fatal: a failure here must not lose the order.
   */
  private async syncLineItems(
    tenantId: number,
    orderId: number,
    o: ShopifyOrderDto,
  ): Promise<void> {
    if (o.line_items == null) return;
    try {
      const rows = o.line_items
        .map((li) => {
          const priceRaw = li.price;
          const price =
            priceRaw != null && priceRaw !== '' && !Number.isNaN(Number(priceRaw))
              ? Number(priceRaw)
              : null;
          return this.itemRepo.create({
            tenantId,
            orderId,
            productId: li.product_id != null ? String(li.product_id) : null,
            // Shopify webhooks use `title`; some payloads only carry `name`.
            title: (li.title ?? li.name ?? '').slice(0, 255) || 'Item',
            optionText: li.variant_title ? String(li.variant_title).slice(0, 255) : null,
            imageUrl: li.image_url ? String(li.image_url).slice(0, 1024) : null,
            qty: li.quantity != null && li.quantity > 0 ? li.quantity : 1,
            price,
          });
        });
      await this.itemRepo.delete({ orderId });
      if (rows.length) await this.itemRepo.save(rows);
    } catch (e) {
      this.logger.warn(`Line items for order ${orderId} not cached: ${(e as Error).message}`);
    }
  }

  /**
   * Shopify order rollup → internal status (POL-014 progression).
   * fulfilled → shipping (In Transit); partially fulfilled → preparing;
   * otherwise (paid/unfulfilled or pending) → paid (Confirmed). Delivered is only
   * reached via fulfillment webhooks (shipment_status=delivered).
   */
  private mapStatus(_financial?: string | null, fulfillment?: string | null): string {
    if (fulfillment === 'fulfilled') return ORDER_STATUS_INTERNAL.SHIPPING;
    if (fulfillment === 'partial') return ORDER_STATUS_INTERNAL.PREPARING;
    return ORDER_STATUS_INTERNAL.PAID;
  }

  private async record(ok: boolean, synced: number, detail: string): Promise<ShopifySyncResult> {
    await this.integrationService.upsert(SHOPIFY, ok ? 'connected' : 'error', detail.slice(0, 255));
    return { ok, synced, detail };
  }
}
