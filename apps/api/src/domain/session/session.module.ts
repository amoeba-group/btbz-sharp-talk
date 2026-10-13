import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from './entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Customer } from '../customer/entity/customer.entity';
import { AiAgent } from '../ai-engine/entity/ai-agent.entity';
import { TenantAiConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { SessionService } from './session.service';
import { SessionController } from './session.controller';
import { PilotModule } from '../pilot/pilot.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  // Customer is registered for the repository only (display name lookup) — no
  // CustomerModule import, which would create a Session ↔ Customer cycle.
  // AiAgent likewise (agent-code → id pinning) — AiEngineModule imports THIS
  // module, so importing it back would be a cycle. TenantAiConfig the same
  // way, for the guest guidance the session response carries (PLN-261001 v1.1).
  // PilotModule: the pilot verdict the session response carries (PLN-261012 SG-40).
  // AuditModule only imports TypeORM entities, so unlike AiEngineModule it
  // cannot cycle back here — consent evidence rows (PLN-261012 SG-70).
  imports: [
    TypeOrmModule.forFeature([Session, Tenant, Customer, AiAgent, TenantAiConfig]),
    PilotModule,
    AuditModule,
  ],
  controllers: [SessionController],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
