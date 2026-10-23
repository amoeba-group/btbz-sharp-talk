import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductCache } from './entity/product-cache.entity';
import { ProductSave } from '../save/entity/product-save.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { KbDocument } from '../knowledge/entity/kb-document.entity';
import { Company } from '../company/entity/company.entity';
import { ProductService } from './product.service';
import { ProductSyncService } from './product-sync.service';
import { ProductAdminController, ProductController } from './product.controller';
import { SessionModule } from '../session/session.module';

@Module({
  // Tenant is registered for the repository only (storefront origin lookup) —
  // no TenantModule import needed for that. ProductSave likewise: repository-only,
  // the recommendation signal (A-10) reads the customer's saves by handle.
  // IntegrationCredential is read to tell a Shopify storefront from a Cafe24 mall,
  // whose catalogue arrives through Cafe24ProductSyncService instead.
  imports: [
    TypeOrmModule.forFeature([ProductCache, ProductSave, Tenant, IntegrationCredential, KbDocument, Company]),
    SessionModule,
  ],
  controllers: [ProductController, ProductAdminController],
  providers: [ProductService, ProductSyncService],
  exports: [ProductService, ProductSyncService],
})
export class ProductModule {}
