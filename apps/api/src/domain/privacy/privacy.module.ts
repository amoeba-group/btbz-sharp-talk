import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionModule } from '../session/session.module';
import { Customer } from '../customer/entity/customer.entity';
import { Session } from '../session/entity/session.entity';
import { OrderCache } from '../order/entity/order-cache.entity';
import { OrderItem } from '../order/entity/order-item.entity';
import { Fulfillment } from '../order/entity/fulfillment.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { Notification } from '../notification/entity/notification.entity';
import { NotificationPref } from '../notification/entity/notification-pref.entity';
import { Review } from '../review/entity/review.entity';
import { Inquiry } from '../inquiry/entity/inquiry.entity';
import { CjmEvent } from '../cjm/entity/cjm-event.entity';
import { Affiliate } from '../affiliate/entity/affiliate.entity';
import { Subscription } from '../subscription/entity/subscription.entity';
import { RestockSubscription } from '../restock/entity/restock-subscription.entity';
import { ProductSave } from '../save/entity/product-save.entity';
import { Nudge } from '../nudge/entity/nudge.entity';
import { DiaryNote } from '../diary/entity/diary-note.entity';
import { DeviceToken } from '../push/entity/device-token.entity';
import { AiUsageDaily } from '../ai-engine/entity/ai-usage-daily.entity';
import { Campaign } from '../campaign/entity/campaign.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { AuditModule } from '../audit/audit.module';
import { TenantModule } from '../tenant/tenant.module';
import { AnswerReuseModule } from '../answer-reuse/answer-reuse.module';
import { AttachmentModule } from '../attachment/attachment.module';
import { ShopifyAdminClient } from '../order/shopify-admin.client';
import { PrivacyService } from './privacy.service';
import { RetentionService } from './retention.service';
import { ErasureSuppressionModule } from './erasure-suppression.module';
import { PrivacyController, ShopifyComplianceController } from './privacy.controller';
import { ModerationLog } from '../moderation/entity/moderation-log.entity';
import { AgentAlert } from '../agent/entity/agent-alert.entity';

/**
 * Privacy / consumer-rights module: Shopify GDPR webhooks (audit High-2) and
 * widget DSAR/CCPA endpoints (audit High-3).
 */
@Module({
  imports: [
    SessionModule,
    TypeOrmModule.forFeature([
      Customer,
      Session,
      OrderCache,
      OrderItem,
      Fulfillment,
      Conversation,
      Message,
      Notification,
      NotificationPref,
      Review,
      Inquiry,
      CjmEvent,
      Affiliate,
      Subscription,
      RestockSubscription,
      ProductSave,
      Nudge,
      DiaryNote,
      DeviceToken,
      AiUsageDaily,
      Campaign,
      Tenant,
      ModerationLog,
      AgentAlert,
    ]),
    AuditModule,
    ErasureSuppressionModule,
    // For propagating an erasure upstream: the per-tenant Shopify credential and
    // the Admin API client. The client is stateless (no injected deps), so it is
    // provided here rather than dragging in the whole OrderModule.
    TenantModule,
    // Answer reuse (PLN-260808 Track C): DSAR erasure drops derived Q&A entries.
    AnswerReuseModule,
    // Attachments (PLN-260814): retention, tenant purge and DSAR erasure must
    // remove the files on disk, not just the rows that point at them.
    AttachmentModule,
  ],
  controllers: [ShopifyComplianceController, PrivacyController],
  providers: [PrivacyService, RetentionService, ShopifyAdminClient],
})
export class PrivacyModule {}
