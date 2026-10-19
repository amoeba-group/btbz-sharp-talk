import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OrderCache } from '../order/entity/order-cache.entity';
import { OrderItem } from '../order/entity/order-item.entity';
import { ProductCache } from '../product/entity/product-cache.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { TenantModule } from '../tenant/tenant.module';
import { CustomerModule } from '../customer/customer.module';
import { SessionModule } from '../session/session.module';
import { Cafe24AdminClient } from './cafe24-admin.client';
import { Cafe24TokenService } from './cafe24-token.service';
import { Cafe24OAuthService } from './cafe24-oauth.service';
import { Cafe24SyncService } from './cafe24-sync.service';
import { Cafe24ProductSyncService } from './cafe24-product-sync.service';
import { Cafe24ConnectionTestService } from './cafe24-connection-test.service';
import { Cafe24CustomerAuthService } from './cafe24-customer-auth.service';
import { ScheduledCafe24SyncService } from './scheduled-cafe24-sync.service';
import { Cafe24OAuthController } from './cafe24-oauth.controller';
import { Cafe24CustomerAuthController } from './cafe24-customer-auth.controller';
import { Cafe24Controller } from './cafe24.controller';

/**
 * Cafe24 commerce integration (Mode A, PLN-260807 P-A1): OAuth + read-only order
 * sync into orders_cache, plus the catalogue pull into products_cache
 * (PLN-260808-Cafe24-Product-Knowledge). RedisService comes from the global infra
 * module; ProductCache and Tenant are registered as repositories only — the
 * catalogue sync writes rows, it does not need ProductModule's services.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([OrderCache, OrderItem, ProductCache, Tenant, IntegrationCredential]),
    TenantModule,
    CustomerModule,
    SessionModule,
  ],
  controllers: [Cafe24OAuthController, Cafe24CustomerAuthController, Cafe24Controller],
  providers: [
    Cafe24AdminClient,
    Cafe24TokenService,
    Cafe24OAuthService,
    Cafe24SyncService,
    Cafe24ProductSyncService,
    Cafe24ConnectionTestService,
    Cafe24CustomerAuthService,
    ScheduledCafe24SyncService,
  ],
  exports: [Cafe24TokenService, Cafe24AdminClient],
})
export class Cafe24Module {}
