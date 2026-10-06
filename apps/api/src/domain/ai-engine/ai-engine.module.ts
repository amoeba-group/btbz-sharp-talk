import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiEngine } from './entity/ai-engine.entity';
import { TenantAiSetting } from './entity/tenant-ai-setting.entity';
import { TenantAiConfig } from './entity/tenant-ai-config.entity';
import { TenantAiConfigRevision } from './entity/tenant-ai-config-revision.entity';
import { AiAgent } from './entity/ai-agent.entity';
import { Session } from '../session/entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { SessionModule } from '../session/session.module';
import { AuditModule } from '../audit/audit.module';
import { AiEngineService } from './ai-engine.service';
import { TenantAiEngineService } from './tenant-ai-engine.service';
import { AiSettingService } from './ai-setting.service';
import { AiConfigService } from './ai-config.service';
import { AiConfigRevisionService } from './ai-config-revision.service';
import { AiAgentService } from './ai-agent.service';
import { HandoffRouterService } from './handoff-router.service';
import { AiEngineController } from './ai-engine.controller';
import { TenantAiEngineController } from './tenant-ai-engine.controller';
import { AiSettingController } from './ai-setting.controller';
import { AiConfigController } from './ai-config.controller';
import { AiAgentController } from './ai-agent.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AiEngine,
      TenantAiSetting,
      TenantAiConfig,
      TenantAiConfigRevision,
      AiAgent,
      Session,
      Tenant,
    ]),
    SessionModule,
    // Guest-policy flips are audited (PLN-261001 v1.1 B8).
    AuditModule,
  ],
  controllers: [
    AiEngineController,
    TenantAiEngineController,
    AiSettingController,
    AiConfigController,
    AiAgentController,
  ],
  providers: [
    AiEngineService,
    TenantAiEngineService,
    AiSettingService,
    AiConfigService,
    AiConfigRevisionService,
    AiAgentService,
    HandoffRouterService,
  ],
  exports: [
    AiEngineService,
    TenantAiEngineService,
    AiSettingService,
    AiConfigService,
    AiConfigRevisionService,
    AiAgentService,
    HandoffRouterService,
  ],
})
export class AiEngineModule {}
