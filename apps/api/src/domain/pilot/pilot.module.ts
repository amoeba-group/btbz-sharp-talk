import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenant/entity/tenant.entity';
import { AuditModule } from '../audit/audit.module';
import { TenantPilotHotel } from './entity/tenant-pilot-hotel.entity';
import { PilotService } from './pilot.service';
import { PilotAdminService } from './pilot-admin.service';
import { PilotController } from './pilot.controller';

/**
 * Pilot allowlist by hotel (PLN-261012 SG-40). Repositories are registered
 * directly (Tenant for the switch, TenantPilotHotel for the list) rather than
 * importing the tenant module: Chat, Session and Embed all depend on this module
 * and TenantModule already depends on Embed, so going through it would close a
 * cycle. `PilotService` — the part the request path calls — is exported.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Tenant, TenantPilotHotel]), AuditModule],
  controllers: [PilotController],
  providers: [PilotService, PilotAdminService],
  exports: [PilotService],
})
export class PilotModule {}
