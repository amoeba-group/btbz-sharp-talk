import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CoachingThread } from './entity/coaching-thread.entity';
import { CoachingMessage } from './entity/coaching-message.entity';
import { CoachingProposal } from './entity/coaching-proposal.entity';
import { GoldenQuestion } from './entity/golden-question.entity';
import { GoldenRun, GoldenRunItem } from './entity/golden-run.entity';
import { GoldenService } from './golden.service';
import { Message } from '../chat/entity/message.entity';
import { AiCoachService } from './ai-coach.service';
import { CoachContextService } from './coach-context.service';
import { CoachProposalService } from './coach-proposal.service';
import { AiCoachController } from './ai-coach.controller';
import { ChatModule } from '../chat/chat.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AiEngineModule } from '../ai-engine/ai-engine.module';
import { ModerationModule } from '../moderation/moderation.module';
import { AuditModule } from '../audit/audit.module';
import { PartnerDataModule } from '../partner-data/partner-data.module';

/**
 * Agent coaching (FR-071..073). Depends on Chat for RagService (KB retrieval)
 * and AiEngine for the tenant config it proposes changes to. Nothing depends on
 * this module, so those imports stay acyclic.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      CoachingThread,
      CoachingMessage,
      CoachingProposal,
      GoldenQuestion,
      GoldenRun,
      GoldenRunItem,
      Message,
    ]),
    ChatModule,
    KnowledgeModule,
    AiEngineModule,
    ModerationModule,
    AuditModule,
    // Golden questions that carry a partner context (PLN-261012 SG-31).
    PartnerDataModule,
  ],
  controllers: [AiCoachController],
  providers: [AiCoachService, CoachContextService, CoachProposalService, GoldenService],
  exports: [AiCoachService, GoldenService],
})
export class AiCoachModule {}
