import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FULFILLMENT_STATUS } from '@sharptalk/types';
import { OrderCache } from './entity/order-cache.entity';
import { OrderService } from './order.service';
import { ShopifySyncService } from './shopify-sync.service';
import { ShopifyFulfillmentDto, ShopifyOrderDto } from './shopify-admin.client';
import { TenantService } from '../tenant/tenant.service';

/**
 * Handles Shopify-native order/fulfillment webhooks. The tenant is resolved from
 * the `X-Shopify-Shop-Domain` header; unknown shops and uncached orders are
 * ignored (logged) so a webhook always returns 200 to Shopify.
 */
@Injectable()
export class ShopifyWebhookService {
  private readonly logger = new Logger(ShopifyWebhookService.name);

  constructor(
    @InjectRepository(OrderCache) private readonly orderRepo: Repository<OrderCache>,
    private readonly tenantService: TenantService,
    private readonly syncService: ShopifySyncService,
    private readonly orderService: OrderService,
  ) {}

  /** orders/create + orders/updated → upsert into the cache. */
  async handleOrderUpsert(shopDomain: string | undefined, order: ShopifyOrderDto): Promise<void> {
    const tenant = shopDomain ? await this.tenantService.findByShopDomain(shopDomain) : null;
    if (!tenant) {
      this.logger.warn(`orders webhook for unknown shop "${shopDomain ?? ''}" — ignored`);
      return;
    }
    await this.syncService.upsertOrder(tenant.id, order);
  }

  /** fulfillments/create + fulfillments/update → advance the cached order's status. */
  async handleFulfillment(
    shopDomain: string | undefined,
    payload: ShopifyFulfillmentDto,
  ): Promise<void> {
    const tenant = shopDomain ? await this.tenantService.findByShopDomain(shopDomain) : null;
    if (!tenant) {
      this.logger.warn(`fulfillment webhook for unknown shop "${shopDomain ?? ''}" — ignored`);
      return;
    }
    const shopifyOrderId = payload.order_id != null ? String(payload.order_id) : null;
    if (!shopifyOrderId) return;

    const order = await this.orderRepo.findOne({
      where: { shopifyOrderId, tenantId: tenant.id },
    });
    if (!order) {
      this.logger.warn(`fulfillment for uncached order ${shopifyOrderId} — ignored`);
      return;
    }

    const status = this.mapFulfillmentStatus(payload.shipment_status);
    // The request is already HMAC-verified in ShopifyOrderWebhookController, so skip
    // the generic X-Webhook-Secret gate (which the Shopify payload never carries) and
    // apply the update directly.
    await this.orderService.applyFulfillment(
      order,
      status,
      payload.tracking_number ?? undefined,
      payload.tracking_company ?? undefined,
      payload.tracking_url ?? payload.tracking_urls?.[0] ?? undefined,
    );
  }

  /** Shopify shipment_status → internal fulfillment status. */
  private mapFulfillmentStatus(shipment?: string | null): string {
    if (shipment === 'delivered') return FULFILLMENT_STATUS.DELIVERED;
    if (
      shipment === 'in_transit' ||
      shipment === 'out_for_delivery' ||
      shipment === 'attempted_delivery'
    ) {
      return FULFILLMENT_STATUS.IN_TRANSIT;
    }
    return FULFILLMENT_STATUS.SHIPPED;
  }
}
