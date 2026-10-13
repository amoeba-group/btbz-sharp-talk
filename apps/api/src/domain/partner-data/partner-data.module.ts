import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from '../tenant/entity/tenant.entity';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { AuditModule } from '../audit/audit.module';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { PartnerLookupLog } from './entity/partner-lookup-log.entity';
import { PARTNER_API_CLIENT } from './partner-api.client';
import { HttpGo2JoyClient } from './http-go2joy.client';
import { MockGo2JoyClient } from './mock-go2joy.client';
import { PartnerCredentialService } from './partner-credential.service';
import { PartnerDataController } from './partner-data.controller';
import { PartnerGoldenService } from './partner-golden.service';
import { PartnerDataService } from './partner-data.service';
import { PartnerDataStep } from './partner-data.step';
import { PartnerFlagService, partnerApiMode } from './partner-flag.service';
import { PartnerLookupLogService } from './partner-lookup-log.service';
import { PartnerSettingsService } from './partner-settings.service';
import { PartnerToolsService } from './partner-tools.service';
import { TopicRegistry } from './partner-topics';
import { ToolLoopService } from '../ai-engine/tool-loop.service';

/**
 * Partner data lookup (PLN-261012 SG-30/31/32): the assistant answers a signed-in
 * hotel user's rate / policy / booking / settlement questions from the partner
 * (Go2Joy) API instead of generic help text.
 *
 * Imported by ChatModule (it exports the chat step) and AiCoachModule (golden
 * runs). This module must NOT import ChatModule — Chat depends on it.
 *
 * Off unless PARTNER_DATA_ENABLED is on AND the tenant switched it on. With
 * PARTNER_API_MODE=mock (the default) the built-in fixtures answer; `live` calls
 * the real HTTP API with the tenant's own credentials.
 */
@Module({
  imports: [TypeOrmModule.forFeature([PartnerLookupLog, Tenant, IntegrationCredential]), AuditModule],
  controllers: [PartnerDataController],
  providers: [
    PartnerCredentialService,
    PartnerFlagService,
    PartnerLookupLogService,
    PartnerSettingsService,
    {
      provide: PARTNER_API_CLIENT,
      inject: [PartnerCredentialService, RedisService],
      // Chosen once at boot from PARTNER_API_MODE; anything but `live` is the mock.
      useFactory: (creds: PartnerCredentialService, redis: RedisService) =>
        partnerApiMode() === 'live'
          ? new HttpGo2JoyClient(creds, new TopicRegistry(), redis)
          : new MockGo2JoyClient(),
    },
    PartnerDataService,
    // Tools mode (PLN-261012 SG-33): the generic loop runner and its partner binding. Inert unless a
    // tenant (or PARTNER_DATA_MODE) asks for tools; the step owns it, ChatService never sees it.
    ToolLoopService,
    PartnerToolsService,
    PartnerDataStep,
    PartnerGoldenService,
  ],
  exports: [PartnerDataStep, PartnerDataService, PartnerFlagService, PartnerGoldenService],
})
export class PartnerDataModule {}
