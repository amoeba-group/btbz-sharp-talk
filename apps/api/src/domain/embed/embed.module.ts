import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Customer } from '../customer/entity/customer.entity';
import { Session } from '../session/entity/session.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { EmbedService } from './embed.service';
import { EmbedController } from './embed.controller';
import { SessionModule } from '../session/session.module';
import { AuditModule } from '../audit/audit.module';
import { IssueModule } from '../issue/issue.module';

/**
 * Embed SDK (PLN-260819). Repositories are registered directly rather than
 * importing the customer module: this path writes exactly one row shape and
 * pulling in the whole customer graph would make the module cycle.
 */
@Module({
  // Conversation: logout ends the session's AI-owned open thread (entity only —
  // importing ChatModule would pull the whole chat graph into this one).
  // AuditModule: identity events (PLN-261012 SG-50). IssueModule: logout closes the
  // issue of the thread it ends — it imports only entities + Audit + Moderation, so
  // there is no cycle back to this module.
  imports: [
    TypeOrmModule.forFeature([Tenant, Customer, Session, Conversation]),
    SessionModule,
    AuditModule,
    IssueModule,
  ],
  controllers: [EmbedController],
  providers: [EmbedService],
  exports: [EmbedService],
})
export class EmbedModule {}
