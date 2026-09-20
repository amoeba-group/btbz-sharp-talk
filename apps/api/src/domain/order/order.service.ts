import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  CJM_STAGE,
  FULFILLMENT_STATUS,
  ORDER_STATUS_INTERNAL,
  deliverySteps,
  fulfillmentStepIndex,
  internalToUiStatus,
} from '@sharptalk/types';
import { buildPagination, normalizePage } from '@sharptalk/common';
import { INTEGRATION_PROVIDER } from '@sharptalk/types';
import { OrderCache } from './entity/order-cache.entity';
import { OrderItem } from './entity/order-item.entity';
import { Fulfillment } from './entity/fulfillment.entity';
import { Session } from '../session/entity/session.entity';
import { SessionService, sessionCacheKey } from '../session/session.service';
import { Customer } from '../customer/entity/customer.entity';
import { OrderMapper } from './order.mapper';
import { Paginated } from '../../global/interceptor/transform.interceptor';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { EventBusService, EVENTS } from '../../infrastructure/infrastructure.module';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { WebhookSecretService } from '../tenant/webhook-secret.service';
import { assertWebhookSecret } from '../../global/util/webhook-secret.util';
import { blindIndex } from '../../global/util/crypto.util';
import { ProductCache } from '../product/entity/product-cache.entity';

/**
 * Title key for catalogue matching: case and whitespace differences are noise,
 * everything else is signal. Nothing is stripped beyond that — a looser
 * normaliser starts matching different products to each other.
 */
function normaliseTitle(title: string | null | undefined): string {
  return String(title ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

const LOOKUP_MAX_ATTEMPTS = 5;
const LOOKUP_WINDOW_SEC = 15 * 60;
const DAYS_WINDOW_MAX = 90;

/** `days` query param → integer 1–90, null when absent, 400 on garbage/out-of-range. */
function parseDaysWindow(days?: string): number | null {
  if (days == null || days === '') return null;
  const n = Number(days);
  if (!Number.isInteger(n) || n < 1 || n > DAYS_WINDOW_MAX) {
    throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
  }
  return n;
}

/**
 * Order read access (FR-019/020/021). Widget endpoints resolve the customer from
 * a session token; order data requires an authenticated (bound) customer (POL-001).
 * Guest lookup verifies identity (order number + email) and binds the session.
 */
@Injectable()
export class OrderService {
  constructor(
    @InjectRepository(OrderCache) private readonly orderRepo: Repository<OrderCache>,
    @InjectRepository(OrderItem) private readonly itemRepo: Repository<OrderItem>,
    @InjectRepository(Fulfillment) private readonly fulfillRepo: Repository<Fulfillment>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    private readonly bus: EventBusService,
    private readonly redis: RedisService,
    private readonly webhookSecretService: WebhookSecretService,
    private readonly sessionService: SessionService,
    // Appended, not slotted in beside the other repositories: the unit specs
    // build this service positionally, and inserting a parameter in the middle
    // silently shifts every double after it.
    @InjectRepository(ProductCache) private readonly productRepo: Repository<ProductCache>,
  ) {}

  /** Guest order lookup (FR-019). Rate-limited per email; binds session on success. */
  async guestLookup(sessionToken: string, orderNumber: string, email: string) {
    const session = await this.loadSession(sessionToken);
    // The session must be bound to a tenant; otherwise a lookup could match and
    // bind a customer from another tenant (SEC-H2). Refuse rather than guess.
    if (session.tenantId == null) {
      throw new BusinessException(ERROR_CODE.TENANT_NOT_FOUND, HttpStatus.BAD_REQUEST);
    }
    await this.enforceLookupLimit(email);

    const order = await this.orderRepo
      .createQueryBuilder('o')
      .innerJoin(Customer, 'c', 'c.id = o.customer_id')
      .where('o.order_number = :orderNumber', { orderNumber })
      // Email is encrypted — match on the deterministic blind index (PRV-M6).
      .andWhere('c.email_hash = :emailHash', { emailHash: blindIndex(email) ?? '__none__' })
      .andWhere('o.tenant_id = :tenantId', { tenantId: session.tenantId })
      .andWhere('c.tenant_id = :tenantId', { tenantId: session.tenantId })
      .getOne();

    if (!order) throw new BusinessException(ERROR_CODE.ORDER_NOT_FOUND, HttpStatus.NOT_FOUND);

    session.customerId = order.customerId;
    await this.sessionRepo.save(session);
    // Identity changed — drop the token→session cache so reads see the binding.
    await this.redis.del(sessionCacheKey(session.sessionToken));

    return OrderMapper.toSummary(order);
  }

  /**
   * List the bound customer's orders (paginated), optionally windowed to the last
   * `days` days. Sorted by the date the order was PLACED — `ordered_at` where the
   * platform sync recorded it (Cafe24), falling back to the cache-insert time for
   * rows that predate the column (Shopify) so a backfilled old order never floats
   * to the top as "new".
   */
  async listForSession(sessionToken: string, page?: string, size?: string, days?: string) {
    const session = await this.sessionService.requireCustomer(sessionToken);
    const customerId = session.customerId as number;
    const { page: p, size: s } = normalizePage(page, size);
    const windowDays = parseDaysWindow(days);

    // The tenant is ALWAYS applied. When the session predates the binding we
    // recover it from the customer row rather than dropping the condition —
    // a missing tenant must narrow the query, never widen it (CLAUDE.md §2).
    const tenantId = session.tenantId ?? (await this.tenantIdOfCustomer(customerId));
    if (tenantId == null) {
      throw new BusinessException(ERROR_CODE.TENANT_NOT_FOUND, HttpStatus.BAD_REQUEST);
    }

    const qb = this.orderRepo
      .createQueryBuilder('o')
      .where('o.customer_id = :customerId', { customerId })
      .andWhere('o.tenant_id = :tenantId', { tenantId });
    if (windowDays != null) {
      qb.andWhere('COALESCE(o.ordered_at, o.created_at) >= DATE_SUB(NOW(), INTERVAL :d DAY)', {
        d: windowDays,
      });
    }
    const [orders, total] = await qb
      .orderBy('COALESCE(o.ordered_at, o.created_at)', 'DESC')
      .skip((p - 1) * s)
      .take(s)
      .getManyAndCount();

    const summaryByOrder = await this.itemSummaries(orders.map((o) => o.id));
    const items = orders.map((o) =>
      OrderMapper.toListItem(o, summaryByOrder.get(String(o.id)) ?? OrderService.EMPTY_ITEM_SUMMARY),
    );
    return new Paginated(items, buildPagination(p, s, total));
  }

  /**
   * order id → item count + first line-item title (PERF-7: the count replaced
   * one COUNT per row; the title keeps that property).
   *
   * The widget's shipment list renders "<first item> + N more" per order. Getting
   * that string from order *detail* would be one extra request per row, so it is
   * aggregated here instead: two fixed queries regardless of how many orders the
   * page holds. GROUP_CONCAT is deliberately avoided — its SEPARATOR must be a
   * string literal, so a title containing the separator would corrupt the split.
   */
  private async itemSummaries(
    orderIds: number[],
  ): Promise<Map<string, { count: number; firstTitle: string | null }>> {
    if (orderIds.length === 0) return new Map();
    const counts = await this.itemRepo
      .createQueryBuilder('i')
      .select('i.order_id', 'oid')
      .addSelect('COUNT(*)', 'cnt')
      .addSelect('MIN(i.id)', 'first_id')
      .where('i.order_id IN (:...ids)', { ids: orderIds })
      .groupBy('i.order_id')
      .getRawMany<{ oid: string; cnt: string; first_id: string }>();

    const firstIds = counts.map((r) => Number(r.first_id)).filter((n) => Number.isFinite(n));
    const firstItems = firstIds.length
      ? await this.itemRepo.find({ where: { id: In(firstIds) } })
      : [];
    const titleById = new Map(firstItems.map((i) => [String(i.id), i.title]));

    return new Map(
      counts.map((r) => [
        String(r.oid),
        { count: Number(r.cnt), firstTitle: titleById.get(String(r.first_id)) ?? null },
      ]),
    );
  }

  /** Orders with no cached items still need a summary object, not a null hole. */
  private static readonly EMPTY_ITEM_SUMMARY = { count: 0, firstTitle: null };

  /** Order detail (items + totals), scoped to the bound customer. */
  async detailForSession(sessionToken: string, orderId: number) {
    const customerId = await this.requireCustomerId(sessionToken);
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order || order.customerId !== customerId) {
      throw new BusinessException(ERROR_CODE.ORDER_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    const items = await this.itemRepo.find({ where: { orderId: order.id }, order: { id: 'ASC' } });
    // Contact block (PLN-260920 P3). The ownership check above already proved
    // this session IS the customer, so what goes out is the shopper's own name
    // and email — the same pair the store's own order page shows them. Decryption
    // is the entity transformer's job; nothing plaintext is stored or logged here.
    const customer =
      order.customerId != null
        ? await this.customerRepo.findOne({ where: { id: order.customerId } })
        : null;
    const images = await this.itemImages(order.tenantId, items);
    return OrderMapper.toDetail(order, items, customer, images);
  }

  /**
   * Line item → catalogue picture (PLN-260920 P4), resolved in two passes.
   *
   *  1. `product_id` against `products_cache.external_id` — exact, and the only
   *     one that survives a retitled product.
   *  2. Normalised title, EXACT equality. The scheduled GraphQL sync cannot read
   *     product ids without the `read_products` scope, so most lines arrive with
   *     nothing but a title; matching them is the difference between pictures on
   *     two lines out of eight and pictures on most of them.
   *
   * Substring/`LIKE` matching is deliberately not used: it is how "fulfil"
   * matched "Unfulfilled" once already. No match → no entry, and the widget
   * draws its placeholder.
   */
  private async itemImages(
    tenantId: number | null,
    items: OrderItem[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    // Lines that came with their own picture need no lookup at all — and with
    // `read_products` granted that is most of them.
    const unresolved = items.filter((i) => !i.imageUrl);
    if (tenantId == null || unresolved.length === 0) return out;

    const ids = [...new Set(unresolved.map((i) => i.productId).filter((v): v is string => !!v))];
    const titles = [...new Set(unresolved.map((i) => normaliseTitle(i.title)).filter(Boolean))];
    if (ids.length === 0 && titles.length === 0) return out;

    const qb = this.productRepo
      .createQueryBuilder('p')
      .select(['p.externalId', 'p.title', 'p.imageUrl'])
      .where('p.tenantId = :tenantId', { tenantId })
      .andWhere('p.imageUrl IS NOT NULL');
    if (ids.length && titles.length) {
      qb.andWhere('(p.externalId IN (:...ids) OR p.title IN (:...titles))', { ids, titles });
    } else if (ids.length) {
      qb.andWhere('p.externalId IN (:...ids)', { ids });
    } else {
      qb.andWhere('p.title IN (:...titles)', { titles });
    }
    const rows = await qb.getMany();

    const byId = new Map<string, string>();
    const byTitle = new Map<string, string>();
    for (const r of rows) {
      if (!r.imageUrl) continue;
      if (r.externalId) byId.set(r.externalId, r.imageUrl);
      const key = normaliseTitle(r.title);
      // First writer wins: two catalogue rows sharing a normalised title cannot
      // be told apart, so picking either is a guess — keep it stable instead.
      if (key && !byTitle.has(key)) byTitle.set(key, r.imageUrl);
    }
    for (const it of unresolved) {
      const hit =
        (it.productId ? byId.get(it.productId) : undefined) ?? byTitle.get(normaliseTitle(it.title));
      if (hit) out.set(String(it.id), hit);
    }
    return out;
  }

  /** Latest fulfillment + delivery stepper for an order (FR-031). */
  async trackingForSession(sessionToken: string, orderId: number) {
    // The shared gate returns the session, which we also need for its language —
    // the stepper labels are customer-facing and must be localized.
    const session = await this.sessionService.requireCustomer(sessionToken);
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order || order.customerId !== session.customerId) {
      throw new BusinessException(ERROR_CODE.ORDER_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    const fulfillment = await this.fulfillRepo.findOne({
      where: { orderId: order.id },
      order: { updatedAt: 'DESC' },
    });
    const status = fulfillment?.status ?? FULFILLMENT_STATUS.PREPARING;
    return {
      status,
      carrier: fulfillment?.carrier ?? null,
      trackingNumber: fulfillment?.trackingNumber ?? null,
      stepIndex: fulfillmentStepIndex(status),
      steps: deliverySteps(session.language),
    };
  }

  /**
   * Recent orders (with their line items) for a bound customer — the factual
   * grounding the chat assistant needs to answer "where is my order?" instead of
   * guessing from the knowledge base. Tenant-scoped on both sides so a session
   * can never read another store's orders.
   */
  async recentForCustomer(
    tenantId: number,
    customerId: number,
    limit = 5,
  ): Promise<Array<{ order: OrderCache; items: OrderItem[] }>> {
    const orders = await this.orderRepo.find({
      where: { tenantId, customerId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    if (!orders.length) return [];
    const items = await this.itemRepo.find({
      where: { orderId: In(orders.map((o) => o.id)) },
      order: { id: 'ASC' },
    });
    const byOrder = new Map<string, OrderItem[]>();
    for (const it of items) {
      const key = String(it.orderId);
      const list = byOrder.get(key);
      if (list) list.push(it);
      else byOrder.set(key, [it]);
    }
    return orders.map((order) => ({ order, items: byOrder.get(String(order.id)) ?? [] }));
  }

  /** Admin view: all orders for the tenant (paginated). */
  async listAll(tenantId: number, page?: string, size?: string) {
    const { page: p, size: s } = normalizePage(page, size);
    const [orders, total] = await this.orderRepo.findAndCount({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      skip: (p - 1) * s,
      take: s,
    });
    const summaryByOrder = await this.itemSummaries(orders.map((o) => o.id));
    const items = orders.map((o) =>
      OrderMapper.toListItem(o, summaryByOrder.get(String(o.id)) ?? OrderService.EMPTY_ITEM_SUMMARY),
    );
    return new Paginated(items, buildPagination(p, s, total));
  }

  /**
   * Fulfillment webhook (FR-021) for the generic provider route
   * (`POST /webhooks/fulfillment`): authenticate the caller against the order's
   * tenant secret, then apply the update. The Shopify fulfillment webhook does NOT
   * go through here — it is HMAC-verified in ShopifyOrderWebhookController and calls
   * `applyFulfillment` directly (its request carries no `X-Webhook-Secret`).
   */
  async handleFulfillmentWebhook(
    orderId: number,
    status: string,
    trackingNumber?: string,
    carrier?: string,
    providedSecret?: string,
  ) {
    const order = await this.orderRepo.findOne({ where: { id: orderId } });
    if (!order) throw new BusinessException(ERROR_CODE.ORDER_NOT_FOUND, HttpStatus.NOT_FOUND);

    // Authenticate the caller against the order's tenant secret (per-tenant if the
    // tenant configured one, else the global env fallback), before any mutation.
    const expected = await this.webhookSecretService.resolve(
      INTEGRATION_PROVIDER.FULFILLMENT,
      order.tenantId,
    );
    assertWebhookSecret(providedSecret, expected);

    return this.applyFulfillment(order, status, trackingNumber, carrier);
  }

  /**
   * Apply a fulfillment update to an already-authenticated order: upsert the
   * fulfillment row, sync order status, emit events + a shipping notification.
   * The CALLER owns authentication — the generic route asserts the per-tenant
   * `X-Webhook-Secret`; the Shopify path is HMAC-verified in its controller. Never
   * expose this on an HTTP route directly.
   */
  async applyFulfillment(
    order: OrderCache,
    status: string,
    trackingNumber?: string,
    carrier?: string,
  ) {
    const orderId = order.id;
    let fulfillment = await this.fulfillRepo.findOne({ where: { orderId } });
    if (fulfillment) {
      fulfillment.status = status;
      fulfillment.trackingNumber = trackingNumber ?? fulfillment.trackingNumber;
      fulfillment.carrier = carrier ?? fulfillment.carrier;
    } else {
      fulfillment = this.fulfillRepo.create({
        orderId,
        status,
        trackingNumber: trackingNumber ?? null,
        carrier: carrier ?? null,
      });
    }
    await this.fulfillRepo.save(fulfillment);

    const internal = this.mapFulfillmentToInternal(status);
    if (internal) {
      order.statusInternal = internal;
      order.statusUi = internalToUiStatus(internal);
      await this.orderRepo.save(order);
    }
    const statusUi = order.statusInternal ? internalToUiStatus(order.statusInternal) : order.statusUi;

    await this.bus.publish(EVENTS.WEBHOOK_FULFILLMENT, {
      orderId,
      status,
      trackingNumber: fulfillment.trackingNumber,
      carrier: fulfillment.carrier,
    });
    await this.bus.publish(EVENTS.NOTIFICATION, {
      tenantId: order.tenantId,
      customerId: order.customerId,
      category: 'shipping',
      title: 'Shipping update',
      body: `Your order ${order.orderNumber} is now ${statusUi ?? status}.`,
      statusBadge: statusUi,
    });
    // Journey breadcrumb (PLN-260807 F3, A-7): the diary timeline's Delivery stage.
    await this.bus.publish(EVENTS.CJM, {
      tenantId: order.tenantId,
      customerId: order.customerId,
      stage: CJM_STAGE.DELIVERY,
      eventType: 'shipment_update',
      payload: { orderNumber: order.orderNumber, status },
    });

    return { received: true };
  }

  // ---- helpers ----
  private mapFulfillmentToInternal(status: string): string | null {
    if (status === FULFILLMENT_STATUS.SHIPPED || status === FULFILLMENT_STATUS.IN_TRANSIT) {
      return ORDER_STATUS_INTERNAL.SHIPPING;
    }
    if (status === FULFILLMENT_STATUS.DELIVERED) return ORDER_STATUS_INTERNAL.DELIVERED;
    return null;
  }

  private async loadSession(token: string): Promise<Session> {
    const session = await this.sessionRepo.findOne({ where: { sessionToken: token } });
    if (!session) throw new BusinessException(ERROR_CODE.SESSION_NOT_FOUND, HttpStatus.NOT_FOUND);
    return session;
  }

  /**
   * Widget-session authorization — single implementation in SessionService.
   * `loadSession` above stays for the paths that MUTATE the session (guest bind),
   * which must not write back a cached copy.
   */
  private requireCustomerId(token: string): Promise<number> {
    return this.sessionService.requireCustomerId(token);
  }

  /** Trusted tenant for a customer — read from the DB, never from the client. */
  private async tenantIdOfCustomer(customerId: number): Promise<number | null> {
    const customer = await this.customerRepo.findOne({ where: { id: customerId } });
    return customer?.tenantId ?? null;
  }

  private async enforceLookupLimit(email: string): Promise<void> {
    const key = `lookup:${email}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.set(key, '1', LOOKUP_WINDOW_SEC);
    if (count > LOOKUP_MAX_ATTEMPTS) {
      throw new BusinessException(ERROR_CODE.GUEST_LOOKUP_LIMIT, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}
