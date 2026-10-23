import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RoutingCategory } from './entity/routing-category.entity';
import { TenantAiConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { Unit } from '../user/entity/unit.entity';
import { JobLabel } from '../user/entity/job-label.entity';
import { AuditModule } from '../audit/audit.module';
import { RoutingCategoryService } from './routing-category.service';
import { RoutingCategoryController } from './routing-category.controller';

/**
 * Consult (routing) categories (PLN-261024). Repositories only — no UserModule
 * / ChatModule / SessionModule import, so they can depend on this one without a cycle.
 */
@Module({
  imports: [TypeOrmModule.forFeature([RoutingCategory, TenantAiConfig, Unit, JobLabel]), AuditModule],
  controllers: [RoutingCategoryController],
  providers: [RoutingCategoryService],
  exports: [RoutingCategoryService],
})
export class RoutingCategoryModule {}
