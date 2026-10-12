import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entity/user.entity';
import { JobLabel } from './entity/job-label.entity';
import { UserJobLabel } from './entity/user-job-label.entity';
import { Invitation } from './entity/invitation.entity';
import { AgentProfile } from '../agent/entity/agent-profile.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { JobLabelController } from './job-label.controller';
import { AdminTenantUserController } from './admin-tenant-user.controller';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [
    // AgentProfile: read-only, for the presence column of the Users list.
    TypeOrmModule.forFeature([User, JobLabel, UserJobLabel, Invitation, AgentProfile]),
    AuditModule,
    AuthModule, // MfaService (mfa-reset endpoints)
    TenantModule,
  ],
  controllers: [UserController, JobLabelController, AdminTenantUserController],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}
