import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from './entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Customer } from '../customer/entity/customer.entity';
import { AiAgent } from '../ai-engine/entity/ai-agent.entity';
import { SessionService } from './session.service';
import { SessionController } from './session.controller';
import { RoutingCategoryModule } from '../routing-category/routing-category.module';

@Module({
  // Customer is registered for the repository only (display name lookup) — no
  // CustomerModule import, which would create a Session ↔ Customer cycle.
  // AiAgent likewise (agent-code → id pinning) — AiEngineModule imports THIS
  // module, so importing it back would be a cycle.
  imports: [TypeOrmModule.forFeature([Session, Tenant, Customer, AiAgent]), RoutingCategoryModule],
  controllers: [SessionController],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
