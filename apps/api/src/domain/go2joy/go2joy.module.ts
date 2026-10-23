import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from '../company/entity/company.entity';
import { ProductCache } from '../product/entity/product-cache.entity';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { HotelSyncService } from './hotel-sync.service';
import { ScheduledHotelSyncService } from './scheduled-hotel-sync.service';

/**
 * Go2Joy Partner API — hotel profile + room types (PLN-261023). Repositories
 * only, so the company and embed modules can depend on it without a cycle.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Company, ProductCache, IntegrationCredential])],
  providers: [HotelSyncService, ScheduledHotelSyncService],
  exports: [HotelSyncService],
})
export class Go2joyModule {}
