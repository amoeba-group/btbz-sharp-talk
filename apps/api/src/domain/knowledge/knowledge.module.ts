import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KnowledgeSource } from './entity/knowledge-source.entity';
import { AuditLog } from '../audit/entity/audit-log.entity';
import { KbDocument } from './entity/kb-document.entity';
import { KbFile } from './entity/kb-file.entity';
import { KbConflict } from './entity/kb-conflict.entity';
import { KbDocumentRevision } from './entity/kb-document-revision.entity';
import { ProductCache } from '../product/entity/product-cache.entity';
import { KnowledgeService } from './knowledge.service';
import { KbConflictService } from './kb-conflict.service';
import { KbRevisionService } from './kb-revision.service';
import { ProductImportService } from './product-import.service';
import { BulkImportService } from './bulk-import.service';
import { BulkExportService } from './bulk-export.service';
import { KnowledgeIngestService } from './knowledge-ingest.service';
import { BoardReviewService } from './board-review.service';
import { BoardReviewController } from './board-review.controller';
import { BoardDocument } from '../board/entity/board-document.entity';
import { GoldenQuestion } from '../ai-coach/entity/golden-question.entity';
import { BoardModule } from '../board/board.module';
import { KnowledgeIngestJobService } from './knowledge-ingest-job.service';
import { CatalogSyncService } from './catalog-sync.service';
import { CatalogSyncJobService } from './catalog-sync-job.service';
import { AnswerProposalService } from './answer-proposal.service';
import { KbAnswerProposal } from './entity/kb-answer-proposal.entity';
import { UsageGuideService } from './usage-guide.service';
import { SourceSyncService } from './source-sync.service';
import { GdriveAdapter } from './adapters/gdrive.adapter';
import { GdriveClient } from './gdrive.client';
import { GdriveCredentialService } from './gdrive-credential.service';
import { NotionAdapter } from './adapters/notion.adapter';
import { UsageType } from './entity/usage-type.entity';
import { KbCategory } from './entity/kb-category.entity';
import { AiAgent } from '../ai-engine/entity/ai-agent.entity';
import { UsageTypeService } from './usage-type.service';
import { KbCategoryService } from './kb-category.service';
import { NotionClient } from './notion.client';
import { KbVideoService } from './kb-video.service';
import { KbVideoController } from './kb-video.controller';
import { NotionCredentialService } from './notion-credential.service';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { AuditModule } from '../audit/audit.module';
import { KnowledgeGapTask } from './entity/knowledge-gap-task.entity';
import { QuestionStatDaily } from '../analytics/entity/question-stat-daily.entity';
import { Message } from '../chat/entity/message.entity';
import { KnowledgeGapService } from './knowledge-gap.service';
import { KnowledgeController } from './knowledge.controller';
import { AgentKnowledgeController } from './agent-knowledge.controller';
import { ChatModule } from '../chat/chat.module';
import { ModerationModule } from '../moderation/moderation.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      KnowledgeSource,
      AuditLog,
      KbDocument,
      KbFile,
      KbConflict,
      KbDocumentRevision,
      KbAnswerProposal,
      UsageType,
      KbCategory,
      // Repository only — the CSV import's optional Price/Image bridge writes
      // into the display catalog (PLN-260807 F1). No ProductModule import.
      ProductCache,
      KnowledgeGapTask,
      QuestionStatDaily,
      Message,
      // Repository only — the Drive service-account key and the Notion token
      // live with the other provider secrets; no TenantModule import.
      IntegrationCredential,
      // Repository only — category scope validates the agent ids it is handed
      // against this tenant's agents; no AiEngineModule import.
      AiAgent,
      // Repository only — board review reads/updates board rows and golden
      // questions for the A/B; the dependency arrow stays knowledge → board.
      BoardDocument,
      GoldenQuestion,
    ]),
    // RagService answers the console's knowledge questions; Chat does not depend
    // on Knowledge, so this stays acyclic.
    ChatModule,
    ModerationModule,
    // Ingest approval publishes drafts onto the board (B2 P4-6).
    BoardModule,
    // Knowledge edits were the one privileged action leaving no audit trail.
    AuditModule,
  ],
  controllers: [KnowledgeController, AgentKnowledgeController, BoardReviewController, KbVideoController],
  providers: [
    KnowledgeService,
    BoardReviewService,
    KnowledgeGapService,
    KbConflictService,
    KbRevisionService,
    ProductImportService,
    BulkImportService,
    BulkExportService,
    KnowledgeIngestService,
    KnowledgeIngestJobService,
    CatalogSyncService,
    CatalogSyncJobService,
    AnswerProposalService,
    UsageGuideService,
    SourceSyncService,
    GdriveAdapter,
    GdriveClient,
    GdriveCredentialService,
    NotionAdapter,
    UsageTypeService,
    KbCategoryService,
    NotionClient,
    NotionCredentialService,
    KbVideoService,
  ],
  exports: [KnowledgeService, KbConflictService, KbRevisionService],
})
export class KnowledgeModule {}
