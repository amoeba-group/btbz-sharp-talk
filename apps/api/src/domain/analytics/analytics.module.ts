import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { Notification } from '../notification/entity/notification.entity';
import { CjmEvent } from '../cjm/entity/cjm-event.entity';
import { OrderCache } from '../order/entity/order-cache.entity';
import { Session } from '../session/entity/session.entity';
import { Customer } from '../customer/entity/customer.entity';
import { User } from '../user/entity/user.entity';
import { KbDocument } from '../knowledge/entity/kb-document.entity';
import { AuditModule } from '../audit/audit.module';
import { AuditLog } from '../audit/entity/audit-log.entity';
import { AiAgent } from '../ai-engine/entity/ai-agent.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { QuestionStatDaily } from './entity/question-stat-daily.entity';
import { QuestionCluster } from './entity/question-cluster.entity';
import { AnalyticsService } from './analytics.service';
import { QuestionStatsService } from './question-stats.service';
import { AnalyticsBreakdownService } from './analytics-breakdown.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsPilotController } from './analytics-pilot.controller';
import { AnalyticsPilotService } from './analytics-pilot.service';
import { AnalyticsPilotQueries } from './analytics-pilot.queries';
import { TenantPilotHotel } from '../pilot/entity/tenant-pilot-hotel.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Conversation,
      Message,
      Notification,
      CjmEvent,
      OrderCache,
      Session,
      Customer,
      User,
      KbDocument,
      QuestionStatDaily,
      AuditLog,
      AiAgent,
      Tenant,
      QuestionCluster,
      // Pilot analytics (PLN-261012 SG-52): the allowlist adoption is measured against.
      TenantPilotHotel,
    ]),
    // Reading a transcript is a PII access and is audited like the agent
    // console's equivalent route (PRV-H4).
    AuditModule,
  ],
  controllers: [AnalyticsController, AnalyticsPilotController],
  providers: [
    AnalyticsService,
    QuestionStatsService,
    AnalyticsBreakdownService,
    AnalyticsPilotQueries,
    AnalyticsPilotService,
  ],
  exports: [AnalyticsService, QuestionStatsService, AnalyticsBreakdownService],
})
export class AnalyticsModule {}
