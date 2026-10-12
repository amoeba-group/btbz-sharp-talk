import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from './entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Customer } from '../customer/entity/customer.entity';
import { AiAgent } from '../ai-engine/entity/ai-agent.entity';
import { TenantAiConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { SessionService } from './session.service';
import { SessionController } from './session.controller';

@Module({
  // Customer is registered for the repository only (display name lookup) — no
  // CustomerModule import, which would create a Session ↔ Customer cycle.
  // AiAgent likewise (agent-code → id pinning) — AiEngineModule imports THIS
  // module, so importing it back would be a cycle. TenantAiConfig the same
  // way, for the guest guidance the session response carries (PLN-261001 v1.1).
  imports: [TypeOrmModule.forFeature([Session, Tenant, Customer, AiAgent, TenantAiConfig])],
  controllers: [SessionController],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
