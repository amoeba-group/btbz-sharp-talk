import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../company/entity/company.entity';
import { ProductCache } from '../product/entity/product-cache.entity';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { TenantAiConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { HotelSyncService } from './hotel-sync.service';
import { ScheduledHotelSyncService } from './scheduled-hotel-sync.service';
import { ProvinceRegionSyncService } from './province-region-sync.service';

/**
 * Go2Joy Partner API — hotel profile + room types and the province → region
 * map (PLN-261023). Repositories only, so the company and embed modules can
 * depend on it without a cycle.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Company, ProductCache, IntegrationCredential, TenantAiConfig])],
  providers: [HotelSyncService, ProvinceRegionSyncService, ScheduledHotelSyncService],
  exports: [HotelSyncService, ProvinceRegionSyncService],
})
export class Go2joyModule {}
