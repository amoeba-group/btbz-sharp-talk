import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Customer } from '../customer/entity/customer.entity';
import { Session } from '../session/entity/session.entity';
import { TenantAiConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { EmbedService } from './embed.service';
import { EmbedController } from './embed.controller';
import { SessionModule } from '../session/session.module';

/**
 * Embed SDK (PLN-260819). Repositories are registered directly rather than
 * importing the customer module: this path writes exactly one row shape and
 * pulling in the whole customer graph would make the module cycle.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Tenant, Customer, Session, TenantAiConfig]), SessionModule],
  controllers: [EmbedController],
  providers: [EmbedService],
  exports: [EmbedService],
})
export class EmbedModule {}
