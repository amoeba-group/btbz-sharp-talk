import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './entity/tenant.entity';
import { IntegrationCredential } from './entity/integration-credential.entity';
import { User } from '../user/entity/user.entity';
import { ContentFilterRule } from '../moderation/entity/content-filter-rule.entity';
import { JobLabel } from '../user/entity/job-label.entity';
import { UsageType } from '../knowledge/entity/usage-type.entity';
import { TenantService } from './tenant.service';
import { MobileAppConfigService } from './mobile-app-config.service';
import { AiAgent } from '../ai-engine/entity/ai-agent.entity';
import { EcommerceIntegrationService } from './ecommerce-integration.service';
import { WebhookSecretService } from './webhook-secret.service';
import { WidgetLogoService } from './widget-logo.service';
import { WidgetDesignService } from './widget-design.service';
import { WidgetDesignController } from './widget-design.controller';
import { WidgetLiveService } from './widget-live.service';
import { SettingsSnapshotService } from './settings-snapshot.service';
import { SettingsSnapshotController } from './settings-snapshot.controller';
import { WidgetDesignRow } from './entity/widget-design.entity';
import { WidgetDesignRevision } from './entity/widget-design-revision.entity';
import { TenantController } from './tenant.controller';
import { WidgetBrandingController } from './widget-branding.controller';
import { IntegrationModule } from '../integration/integration.module';
import { AuditModule } from '../audit/audit.module';
import { EmbedModule } from '../embed/embed.module';
import { TenantAssetModule } from '../tenant-asset/tenant-asset.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tenant,
      IntegrationCredential,
      User,
      ContentFilterRule,
      JobLabel,
      UsageType,
      WidgetDesignRow,
      WidgetDesignRevision,
      AiAgent,
    ]),
    IntegrationModule,
    AuditModule,
    // For the secret-rotation route; EmbedModule owns the secret's lifecycle.
    EmbedModule,
    // Design-profile asset references are verified against the tenant's files (P2).
    TenantAssetModule,
  ],
  controllers: [TenantController, WidgetBrandingController, WidgetDesignController, SettingsSnapshotController],
  providers: [
    TenantService,
    MobileAppConfigService,
    EcommerceIntegrationService,
    WebhookSecretService,
    WidgetLogoService,
    WidgetDesignService,
    WidgetLiveService,
    SettingsSnapshotService,
  ],
  exports: [TenantService, WebhookSecretService, WidgetLogoService],
})
export class TenantModule {}
