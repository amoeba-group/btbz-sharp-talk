import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entity/user.entity';
import { JobLabel } from './entity/job-label.entity';
import { UserJobLabel } from './entity/user-job-label.entity';
import { Invitation } from './entity/invitation.entity';
import { Unit } from './entity/unit.entity';
import { TenantAiConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { JobLabelController } from './job-label.controller';
import { UnitController } from './unit.controller';
import { AdminTenantUserController } from './admin-tenant-user.controller';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenant/tenant.module';
import { RoutingCategoryModule } from '../routing-category/routing-category.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, JobLabel, UserJobLabel, Invitation, Unit, TenantAiConfig]),
    AuditModule,
    AuthModule, // MfaService (mfa-reset endpoints)
    TenantModule,
    RoutingCategoryModule, // scope regions = the tenant's routing categories (PLN-261024)
  ],
  controllers: [UserController, JobLabelController, UnitController, AdminTenantUserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
