import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { buildTypeOrmOptions } from './global/config/typeorm.config';
import { GlobalModule } from './global/global.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { AiModule } from './infrastructure/external/ai/ai.module';
import { VectorModule } from './infrastructure/external/vector/vector.module';
import { JwtAuthGuard } from './global/guard/jwt-auth.guard';
import { XffThrottlerGuard } from './global/guard/xff-throttler.guard';
import { RequestContextMiddleware } from './global/middleware/request-context.middleware';
import { ObservabilityModule } from './infrastructure/observability/observability.module';
import { HttpMetricsMiddleware } from './infrastructure/observability/http-metrics.middleware';

// Domain modules
import { AuthModule } from './domain/auth/auth.module';
import { SessionModule } from './domain/session/session.module';
import { EmbedModule } from './domain/embed/embed.module';
import { ChatModule } from './domain/chat/chat.module';
import { AnswerReuseModule } from './domain/answer-reuse/answer-reuse.module';
import { AttachmentModule } from './domain/attachment/attachment.module';
import { IssueModule } from './domain/issue/issue.module';
import { ModerationModule } from './domain/moderation/moderation.module';
import { TenantModule } from './domain/tenant/tenant.module';
import { TenantAssetModule } from './domain/tenant-asset/tenant-asset.module';
import { MenuAccessModule } from './domain/menu-access/menu-access.module';
import { UserModule } from './domain/user/user.module';
import { OrderModule } from './domain/order/order.module';
import { ProductModule } from './domain/product/product.module';
import { NotificationModule } from './domain/notification/notification.module';
import { PushModule } from './domain/push/push.module';
import { ReviewModule } from './domain/review/review.module';
import { SaveModule } from './domain/save/save.module';
import { NudgeModule } from './domain/nudge/nudge.module';
import { DiaryModule } from './domain/diary/diary.module';
import { AffiliateModule } from './domain/affiliate/affiliate.module';
import { RestockModule } from './domain/restock/restock.module';
import { SubscriptionModule } from './domain/subscription/subscription.module';
import { InquiryModule } from './domain/inquiry/inquiry.module';
import { KnowledgeModule } from './domain/knowledge/knowledge.module';
import { BoardModule } from './domain/board/board.module';
import { CampaignModule } from './domain/campaign/campaign.module';
import { CjmModule } from './domain/cjm/cjm.module';
import { IntegrationModule } from './domain/integration/integration.module';
import { MessengerModule } from './domain/messenger/messenger.module';
import { AgentModule } from './domain/agent/agent.module';
import { AuditModule } from './domain/audit/audit.module';
import { AiEngineModule } from './domain/ai-engine/ai-engine.module';
import { AiCoachModule } from './domain/ai-coach/ai-coach.module';
import { AnalyticsModule } from './domain/analytics/analytics.module';
import { CustomerModule } from './domain/customer/customer.module';
import { JourneyModule } from './domain/journey/journey.module';
import { PrivacyModule } from './domain/privacy/privacy.module';
import { HealthModule } from './domain/health/health.module';
import { PilotModule } from './domain/pilot/pilot.module';
import { ShopifyOAuthModule } from './domain/shopify-oauth/shopify-oauth.module';
import { Cafe24Module } from './domain/cafe24/cafe24.module';
import { OdooModule } from './domain/odoo/odoo.module';
import { HaravanModule } from './domain/haravan/haravan.module';
import { WooModule } from './domain/woocommerce/woocommerce.module';
import { ShopifyProxyModule } from './domain/shopify-proxy/shopify-proxy.module';
import { PartnerDataModule } from './domain/partner-data/partner-data.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../env/backend/.env.development', '.env'],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => buildTypeOrmOptions(config),
    }),
    // App-wide flood limiter: 600 requests / 60s per client IP (generous — see
    // XffThrottlerGuard). High-frequency widget polls are @SkipThrottle'd.
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 600 }] }),
    GlobalModule,
    InfrastructureModule,
    AiModule,
    VectorModule,
    // metrics, readiness, ops alerts, error tracking (PLN-261012 SG-83)
    ObservabilityModule,
    // domains
    AuthModule,
    SessionModule,
    EmbedModule,
    ChatModule,
    AnswerReuseModule,
    AttachmentModule,
    IssueModule,
    ModerationModule,
    TenantModule,
    TenantAssetModule,
    MenuAccessModule,
    UserModule,
    CustomerModule,
    OrderModule,
    ProductModule,
    ShopifyOAuthModule,
    Cafe24Module,
    OdooModule,
    HaravanModule,
    WooModule,
    ShopifyProxyModule,
    NotificationModule,
    PushModule,
    ReviewModule,
    SaveModule,
    NudgeModule,
    DiaryModule,
    AffiliateModule,
    RestockModule,
    SubscriptionModule,
    InquiryModule,
    KnowledgeModule,
    BoardModule,
    CampaignModule,
    CjmModule,
    IntegrationModule,
    MessengerModule,
    AgentModule,
    AuditModule,
    AiEngineModule,
    AiCoachModule,
    PartnerDataModule,
    AnalyticsModule,
    JourneyModule,
    PrivacyModule,
    HealthModule,
    // Pilot allowlist by hotel (PLN-261012 SG-40) — console API; Chat/Session/Embed import it too.
    PilotModule,
  ],
  providers: [
    // Throttle first (cheap, before auth work), then authenticate.
    { provide: APP_GUARD, useClass: XffThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Request-context (requestId + client IP) for audit traceability — all routes.
    consumer.apply(RequestContextMiddleware).forRoutes('*');
    // Request count + latency by route group for /metrics (PLN-261012 SG-83).
    consumer.apply(HttpMetricsMiddleware).forRoutes('*');
  }
}
