import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionModule } from '../session/session.module';
import { OrderCache } from './entity/order-cache.entity';
import { OrderItem } from './entity/order-item.entity';
import { Fulfillment } from './entity/fulfillment.entity';
import { Session } from '../session/entity/session.entity';
import { Customer } from '../customer/entity/customer.entity';
import { ProductCache } from '../product/entity/product-cache.entity';
import { Review } from '../review/entity/review.entity';
import { OrderService } from './order.service';
import { AdminOrderController, OrderController } from './order.controller';
import { WebhookController } from './webhook.controller';
import { ShopifyAdminClient } from './shopify-admin.client';
import { ShopifySyncService } from './shopify-sync.service';
import { ShopifySyncController } from './shopify-sync.controller';
import { ShopifyWebhookService } from './shopify-webhook.service';
import { ShopifyOrderWebhookController } from './shopify-order-webhook.controller';
import { ScheduledShopifySyncService } from './scheduled-shopify-sync.service';
import { TenantModule } from '../tenant/tenant.module';
import { CustomerModule } from '../customer/customer.module';
import { IntegrationModule } from '../integration/integration.module';

@Module({
  imports: [
    SessionModule,
    TypeOrmModule.forFeature([OrderCache, OrderItem, Fulfillment, Session, Customer, ProductCache, Review]),
    TenantModule,
    CustomerModule,
    IntegrationModule,
  ],
  controllers: [
    OrderController,
    AdminOrderController,
    WebhookController,
    ShopifySyncController,
    ShopifyOrderWebhookController,
  ],
  providers: [
    OrderService,
    ShopifyAdminClient,
    ShopifySyncService,
    ShopifyWebhookService,
    ScheduledShopifySyncService,
  ],
  exports: [OrderService, ShopifySyncService],
})
export class OrderModule {}
