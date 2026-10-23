import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoutingCategory } from './entity/routing-category.entity';
import { TenantAiConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { Unit } from '../user/entity/unit.entity';
import { JobLabel } from '../user/entity/job-label.entity';
import { Company } from '../company/entity/company.entity';
import { AuditModule } from '../audit/audit.module';
import { RoutingCategoryService } from './routing-category.service';
import { RoutingCategoryController } from './routing-category.controller';

/**
 * Routing categories (PLN-261024). Repositories only — no UserModule /
 * CompanyModule import, so both can depend on this one for validation without a cycle.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RoutingCategory, TenantAiConfig, Unit, JobLabel, Company]), AuditModule],
  controllers: [RoutingCategoryController],
  providers: [RoutingCategoryService],
  exports: [RoutingCategoryService],
})
export class RoutingCategoryModule {}
