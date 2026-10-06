import { Module } from '@nestjs/common';
import { TenantAiConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { ChannelThread } from '../messenger/entity/channel-thread.entity';
import { MessengerChannel } from '../messenger/entity/messenger-channel.entity';
import { ReplyDraft } from '../chat/entity/reply-draft.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Agent } from './entity/agent.entity';
import { AgentProfile } from './entity/agent-profile.entity';
import { Assignment } from './entity/assignment.entity';
import { AgentDailyStat } from './entity/agent-daily-stat.entity';
import { AgentAlert } from './entity/agent-alert.entity';
import { AiAgent } from '../ai-engine/entity/ai-agent.entity';
import { ChatComment } from './entity/chat-comment.entity';
import { ChatGroup } from './entity/chat-group.entity';
import { Journey } from '../journey/entity/journey.entity';
import { JourneyTask } from '../journey/entity/journey-task.entity';
import { ChatGroupMember } from './entity/chat-group-member.entity';
import { ConversationBriefing } from './entity/conversation-briefing.entity';
import { Customer } from '../customer/entity/customer.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { User } from '../user/entity/user.entity';
import { Session } from '../session/entity/session.entity';
import { AgentService } from './agent.service';
import { AgentAlertService } from './agent-alert.service';
import { BriefingService } from './briefing.service';
import { ChatCommentService } from './chat-comment.service';
import { ChatGroupService } from './chat-group.service';
import { AgentConsoleController } from './agent-console.controller';
import { ModerationModule } from '../moderation/moderation.module';
import { CustomerModule } from '../customer/customer.module';
import { AuditModule } from '../audit/audit.module';
import { SessionModule } from '../session/session.module';
import { AnswerReuseModule } from '../answer-reuse/answer-reuse.module';
import { JobLabel } from '../user/entity/job-label.entity';
import { UserJobLabel } from '../user/entity/user-job-label.entity';
import { IssueModule } from '../issue/issue.module';
import { AttachmentModule } from '../attachment/attachment.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Agent,
      AgentProfile,
      Assignment,
      AgentDailyStat,
      AgentAlert,
      // Read-only: AI-agent names for queue rows/filter (REQ-260825 R6/R7).
      AiAgent,
      // Internal notes + stored briefings (REQ-260824 R3/R4).
      ChatComment,
      ConversationBriefing,
      // Session grouping: timeline/project (PLN-260824-Session-Grouping).
      ChatGroup,
      ChatGroupMember,
      // A dissolved group takes its journey with it (PLN-261006 P2).
      Journey,
      JourneyTask,
      // Read-only: group member display names (session → customer).
      Customer,
      Conversation,
      Message,
      User,
      Session,
      JobLabel,
      UserJobLabel,
      // Read-only: the handback notice lives in tenant_ai_config.handoff_config.
      TenantAiConfig,
      // Read-only: whether the AI is answering a channel thread depends on the
      // channel's default (PLN-260812). Entity-only, so no module cycle.
      ChannelThread,
      MessengerChannel,
      // Approval-mode drafts live next to the conversation they belong to.
      ReplyDraft,
    ]),
    ModerationModule,
    CustomerModule,
    AuditModule,
    // Files on a transcript's turns (PLN-260814).
    AttachmentModule,
    SessionModule,
    // Answer reuse (PLN-260808 Track C): agent replies feed the reuse store.
    AnswerReuseModule,
    // Issue P1: accept/end hooks drive the conversation's ticket.
    IssueModule,
  ],
  controllers: [AgentConsoleController],
  providers: [AgentService, AgentAlertService, BriefingService, ChatCommentService, ChatGroupService],
  exports: [AgentService, AgentAlertService],
})
export class AgentModule {}
