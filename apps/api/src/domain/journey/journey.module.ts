import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JourneyReport } from './entity/journey-report.entity';
import { JourneyReportCriteria } from './entity/journey-report-criteria.entity';
import { JourneyStage } from './entity/journey-stage.entity';
import { Journey } from './entity/journey.entity';
import { JourneyTask } from './entity/journey-task.entity';
import { ChatGroup } from '../agent/entity/chat-group.entity';
import { User } from '../user/entity/user.entity';
import { JourneyManageService } from './journey-manage.service';
import { Session } from '../session/entity/session.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { Assignment } from '../agent/entity/assignment.entity';
import { CjmEvent } from '../cjm/entity/cjm-event.entity';
import { AuditLog } from '../audit/entity/audit-log.entity';
import { ChatGroupMember } from '../agent/entity/chat-group-member.entity';
import { JourneyMetricsService } from './journey-metrics.service';
import { JourneyCriteriaService } from './journey-criteria.service';
import { JourneyReportService } from './journey-report.service';
import { JourneyController } from './journey.controller';
import { Tenant } from '../tenant/entity/tenant.entity';
import { ModerationModule } from '../moderation/moderation.module';
import { AuditModule } from '../audit/audit.module';

/**
 * Customer journey reports (PLN-260825). W1 is the counting half only — the
 * numbers have to be right before a narrative written from them means anything.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      JourneyReport,
      JourneyReportCriteria,
      // Journey management (PLN-261006) — the only tables this module writes
      // besides reports and criteria.
      JourneyStage,
      Journey,
      JourneyTask,
      ChatGroup,
      User,
      // Read-only across domains: the report reads what already happened and
      // writes nothing back into chat, sessions or assignments.
      Session,
      Conversation,
      Message,
      Assignment,
      CjmEvent,
      AuditLog,
      ChatGroupMember,
      Tenant,
    ]),
    ModerationModule,
    AuditModule,
  ],
  controllers: [JourneyController],
  providers: [JourneyMetricsService, JourneyCriteriaService, JourneyReportService, JourneyManageService],
  exports: [JourneyMetricsService, JourneyCriteriaService, JourneyReportService],
})
export class JourneyModule {}
