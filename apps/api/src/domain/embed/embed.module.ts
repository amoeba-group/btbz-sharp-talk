import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Customer } from '../customer/entity/customer.entity';
import { Session } from '../session/entity/session.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { EmbedService } from './embed.service';
import { EmbedController } from './embed.controller';
import { SessionModule } from '../session/session.module';
import { PilotModule } from '../pilot/pilot.module';

/**
 * Embed SDK (PLN-260819). Repositories are registered directly rather than
 * importing the customer module: this path writes exactly one row shape and
 * pulling in the whole customer graph would make the module cycle.
 */
@Module({
  // Conversation: logout ends the session's AI-owned open thread (entity only —
  // importing ChatModule would pull the whole chat graph into this one).
  // PilotModule: identify answers with the pilot verdict (PLN-261012 SG-40).
  imports: [TypeOrmModule.forFeature([Tenant, Customer, Session, Conversation]), SessionModule, PilotModule],
  controllers: [EmbedController],
  providers: [EmbedService],
  exports: [EmbedService],
})
export class EmbedModule {}
