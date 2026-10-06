import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HttpCode, HttpStatus } from '@nestjs/common';
import { CAPABILITY, Principal } from '@sharptalk/types';
import { Paginated } from '../../global/interceptor/transform.interceptor';
import { buildPagination, normalizePage } from '@sharptalk/common';
import { RequireCapability, RequireMenu } from '../../global/decorator/auth.decorator';
import { CatalogSyncJobService } from './catalog-sync-job.service';
import { AnswerProposalService } from './answer-proposal.service';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { KnowledgeService } from './knowledge.service';
import { KnowledgeIngestService } from './knowledge-ingest.service';
import { GdriveCredentialService } from './gdrive-credential.service';
import { NotionCredentialService } from './notion-credential.service';
import { UsageTypeService } from './usage-type.service';
import { KbCategoryService } from './kb-category.service';
import { BoardReviewService } from './board-review.service';
import { KnowledgeMapper } from './knowledge.mapper';
import { BULK_IMPORT_GROUPS, DOC_GROUP } from './entity/kb-document.entity';
import { BulkExportService } from './bulk-export.service';
import { decodeUploadName } from '../../global/util/upload-name.util';
import {
  ApproveIngestRequest,
  ApproveProposalRequest,
  AskKnowledgeRequest,
  BulkImportRequest,
  IngestFileRequest,
  IngestVideoRequest,
  CreateCategoryRequest,
  CreateDocumentRequest,
  CreateSourceRequest,
  ListConflictsQuery,
  ListDocumentsQuery,
  MergeCategoriesRequest,
  PreviewUsageTypeRequest,
  RejectProposalRequest,
  RenameCategoryRequest,
  ReorderRequest,
  ResolveConflictRequest,
  SaveGdriveCredentialRequest,
  SaveNotionCredentialRequest,
  SaveUsageGuideRequest,
  SaveUsageTypeRequest,
  SetCategoryAgentsRequest,
  SetCategoryGuestVisibleRequest,
  SetCategoryHiddenRequest,
  TestGdriveRequest,
  TestNotionRequest,
  UpdateDocumentRequest,
  UpdateSourceRequest,
} from './dto/request/knowledge.request';
import { KbConflictService } from './kb-conflict.service';
import { KbRevisionService } from './kb-revision.service';
import { KnowledgeGapService } from './knowledge-gap.service';
import { AcceptGapTaskRequest } from './dto/request/knowledge.request';

/** Knowledge source & RAG corpus management (FR-064, FR-065). Tenant-scoped. */
@ApiTags('Knowledge')
@Controller('knowledge')
// Screen gate (PLN-260812 S4): The agent-side /agent/knowledge/ask lives in its own controller and stays open to live chat.
@RequireMenu('knowledge')
export class KnowledgeController {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly conflictService: KbConflictService,
    private readonly revisionService: KbRevisionService,
    private readonly jobService: CatalogSyncJobService,
    private readonly answerProposals: AnswerProposalService,
    private readonly gapService: KnowledgeGapService,
    private readonly gdriveCredentials: GdriveCredentialService,
    private readonly notionCredentials: NotionCredentialService,
    private readonly usageTypes: UsageTypeService,
    private readonly kbCategories: KbCategoryService,
    private readonly ingest: KnowledgeIngestService,
    private readonly bulkExport: BulkExportService,
    private readonly boardReview: BoardReviewService,
  ) {}

  // ---- Knowledge-gap proposals (P5, 결정 9: human approval only) ----

  @Get('gap-tasks')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Knowledge-gap proposals awaiting a decision (P5)' })
  async listGapTasks(@CurrentUser() user: Principal, @Query('status') status?: string) {
    const tasks = await this.gapService.list(
      this.tenantUser(user).tenantId,
      status === 'accepted' || status === 'dismissed' ? status : 'proposed',
    );
    return { tasks: tasks.map((t) => KnowledgeMapper.toGapTask(t)) };
  }

  @Post('gap-tasks/:id/accept')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Approve a proposal → create+embed a KB document (existing pipeline)' })
  async acceptGapTask(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: AcceptGapTaskRequest,
  ) {
    const u = this.tenantUser(user);
    const { task, document } = await this.gapService.accept(u.tenantId, u.userId, id, {
      title: body.title,
      content: body.content,
    });
    return { task: KnowledgeMapper.toGapTask(task), documentId: String(document.id) };
  }

  @Post('gap-tasks/:id/dismiss')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Dismiss a proposal (never re-raised)' })
  async dismissGapTask(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const u = this.tenantUser(user);
    const task = await this.gapService.dismiss(u.tenantId, u.userId, id);
    return { task: KnowledgeMapper.toGapTask(task) };
  }

  /** Narrow to a tenant user; knowledge management is tenant-scoped only. */
  private tenantUser(user: Principal): { tenantId: number; userId: number } {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return { tenantId: user.tenantId, userId: user.userId };
  }

  // ---- Sources ----

  @Get('sources')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'List tenant knowledge sources' })
  async listSources(@CurrentUser() user: Principal) {
    const sources = await this.knowledgeService.listSources(this.tenantUser(user).tenantId);
    return KnowledgeMapper.toSourceList(sources, this.knowledgeService.supportedSourceTypes());
  }

  @Post('sources')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Create a knowledge source (board/repository/gdrive/notion)' })
  async createSource(@CurrentUser() user: Principal, @Body() body: CreateSourceRequest) {
    const source = await this.knowledgeService.createSource(this.tenantUser(user).tenantId, body);
    return KnowledgeMapper.toSource(
      source,
      this.knowledgeService.supportedSourceTypes().includes(source.type),
    );
  }

  @Patch('sources/:id')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Update a knowledge source (toggle active/designated)' })
  async updateSource(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateSourceRequest,
  ) {
    const source = await this.knowledgeService.updateSource(
      this.tenantUser(user).tenantId,
      id,
      body,
    );
    return KnowledgeMapper.toSource(
      source,
      this.knowledgeService.supportedSourceTypes().includes(source.type),
    );
  }

  @Delete('sources/:id')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Delete a knowledge source (its documents are deactivated, not deleted)' })
  async deleteSource(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const actor = this.tenantUser(user);
    const { deactivatedDocuments } = await this.knowledgeService.deleteSource(
      actor.tenantId,
      id,
      actor.userId,
    );
    return { deleted: true, deactivatedDocuments };
  }

  // ---- Google Drive credential (PLN-260815 G1) ----

  @Get('gdrive/credential')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Whether a Drive service account is registered' })
  async gdriveCredentialStatus(@CurrentUser() user: Principal) {
    return this.gdriveCredentials.status(this.tenantUser(user).tenantId);
  }

  @Put('gdrive/credential')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Register a Drive service account key' })
  async saveGdriveCredential(
    @CurrentUser() user: Principal,
    @Body() body: SaveGdriveCredentialRequest,
  ) {
    // Only the address comes back — the key itself is never echoed, so a
    // console that leaks its own screenshot does not leak the secret.
    const actor = this.tenantUser(user);
    return this.gdriveCredentials.save(actor.tenantId, body.key_json, actor.userId);
  }

  @Delete('gdrive/credential')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Remove the Drive service account key' })
  async deleteGdriveCredential(@CurrentUser() user: Principal) {
    const actor = this.tenantUser(user);
    await this.gdriveCredentials.remove(actor.tenantId, actor.userId);
    return { removed: true };
  }

  @Post('gdrive/test')
  @HttpCode(HttpStatus.OK)
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Check the key, and a folder when given' })
  async testGdrive(@CurrentUser() user: Principal, @Body() body: TestGdriveRequest) {
    return this.gdriveCredentials.test(this.tenantUser(user).tenantId, body.folder_id);
  }

  // ---- Notion credential (PLN-260821 W1) ----

  @Get('notion/credential')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Whether a Notion integration token is registered' })
  async notionCredentialStatus(@CurrentUser() user: Principal) {
    return this.notionCredentials.status(this.tenantUser(user).tenantId);
  }

  @Put('notion/credential')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Register a Notion integration token' })
  async saveNotionCredential(
    @CurrentUser() user: Principal,
    @Body() body: SaveNotionCredentialRequest,
  ) {
    // Only the last four characters come back; the token is never echoed.
    const actor = this.tenantUser(user);
    return this.notionCredentials.save(actor.tenantId, body.token, actor.userId);
  }

  @Delete('notion/credential')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Remove the Notion integration token' })
  async deleteNotionCredential(@CurrentUser() user: Principal) {
    const actor = this.tenantUser(user);
    await this.notionCredentials.remove(actor.tenantId, actor.userId);
    return { removed: true };
  }

  @Post('notion/test')
  @HttpCode(HttpStatus.OK)
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Check the token, and a page/database when given' })
  async testNotion(@CurrentUser() user: Principal, @Body() body: TestNotionRequest) {
    return this.notionCredentials.test(this.tenantUser(user).tenantId, body.target_id);
  }

  @Get('sources/:id/runs')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: "One source's sync-run history (from the audit log)" })
  async sourceRuns(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit?: string,
  ) {
    return this.knowledgeService.listSourceRuns(
      this.tenantUser(user).tenantId,
      id,
      limit ? Number(limit) : undefined,
    );
  }

  @Post('sources/:id/sync')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Pull a knowledge source into the RAG corpus' })
  async syncSource(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const actor = this.tenantUser(user);
    return this.knowledgeService.syncSource(actor.tenantId, id, actor.userId);
  }

  // ---- Documents ----

  @Get('documents')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'List RAG documents (paginated, filterable)' })
  async listDocuments(@CurrentUser() user: Principal, @Query() query: ListDocumentsQuery) {
    const { items, total, page, size } = await this.knowledgeService.listDocuments(
      this.tenantUser(user).tenantId,
      query,
    );
    return new Paginated(KnowledgeMapper.toDocumentList(items), buildPagination(page, size, total));
  }

  // Declared BEFORE `documents/:id` on purpose: a later literal segment would
  // be swallowed by the :id route (same shadowing that once made
  // `categories` return document counts).
  @Get('documents/facets')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Distinct source/status values for the list filter selects' })
  async documentFacets(@CurrentUser() user: Principal) {
    return this.knowledgeService.listDocumentFacets(this.tenantUser(user).tenantId);
  }

  // Also before `documents/:id` — a literal segment after a :id route is
  // swallowed silently.
  @Get('documents/export')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Export a group as CSV/XLSX in the bulk-import column format' })
  async exportDocuments(
    @CurrentUser() user: Principal,
    @Query('doc_group') docGroup: string,
    @Query('format') format: string,
    @Res() res: Response,
  ) {
    const actor = this.tenantUser(user);
    // Round-trip contract: only groups the bulk importer accepts back.
    if (!(BULK_IMPORT_GROUPS as readonly string[]).includes(docGroup)) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    if (format !== 'csv' && format !== 'xlsx') {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    const rows = await this.bulkExport.exportRows(actor.tenantId, docGroup);
    const buffer =
      format === 'csv'
        ? this.bulkExport.toCsvBuffer(rows)
        : await this.bulkExport.toXlsxBuffer(rows);
    const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    res.setHeader(
      'Content-Type',
      format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''kb-${docGroup}-${stamp}.${format}`,
    );
    res.send(buffer);
  }

  // `categories/counts`, not `categories`: this is a report about documents,
  // while `GET categories` is the category list itself. Declared first, the
  // bare path silently shadowed that list — the console asked for categories
  // and got document counts, with no error anywhere (found in deploy checks).
  @Get('categories/counts')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Document counts per category (console category navigator)' })
  async categoryCounts(@CurrentUser() user: Principal, @Query('group') group?: string) {
    return this.knowledgeService.categoryCounts(this.tenantUser(user).tenantId, group);
  }

  @Post('ask')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Answer a question from the KB and return its source documents' })
  async ask(@CurrentUser() user: Principal, @Body() body: AskKnowledgeRequest) {
    return this.knowledgeService.ask(
      this.tenantUser(user).tenantId,
      body.question,
      body.language ?? 'EN',
      body.group,
      body.ai_agent_id ?? null,
    );
  }

  @Get('documents/:id')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Get one RAG document with full content' })
  async getDocument(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const tenantId = this.tenantUser(user).tenantId;
    const doc = await this.knowledgeService.getDocument(tenantId, id);
    // Which board document manages this row (PLN-260910 D-6) — imported rows
    // keep their own external key, so the BRD- prefix alone cannot say.
    const boardDocumentId = await this.boardReview.boardDocumentIdFor(tenantId, Number(doc.id));
    return { ...KnowledgeMapper.toDocument(doc), boardDocumentId };
  }

  @Post('documents')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Create and embed a RAG document' })
  async createDocument(@CurrentUser() user: Principal, @Body() body: CreateDocumentRequest) {
    const actor = this.tenantUser(user);
    const doc = await this.knowledgeService.createDocument(actor.tenantId, body, actor.userId);
    return KnowledgeMapper.toDocument(doc);
  }

  @Patch('documents/:id')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Update a RAG document (re-embeds when content changes)' })
  async updateDocument(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateDocumentRequest,
  ) {
    const actor = this.tenantUser(user);
    const doc = await this.knowledgeService.updateDocument(actor.tenantId, id, body, actor.userId);
    return KnowledgeMapper.toDocument(doc);
  }

  @Delete('documents/:id')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Delete a RAG document' })
  async deleteDocument(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const actor = this.tenantUser(user);
    await this.knowledgeService.deleteDocument(actor.tenantId, id, actor.userId);
    return { deleted: true };
  }

  @Post('documents/import/product')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @UseInterceptors(
    FileInterceptor('file', {
      // Memory storage on purpose: the catalogue export is ~300KB and container
      // disk does not survive a redeploy. The raw file is not retained — the
      // audit entry and the import summary carry the traceability.
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiOperation({ summary: 'Import a product catalogue CSV into the ProductInfo group' })
  async importProducts(
    @CurrentUser() user: Principal,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    const actor = this.tenantUser(user);
    if (!file) throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    // Browsers label .csv inconsistently (text/csv, application/vnd.ms-excel,
    // sometimes text/plain), so the extension is the reliable check and the
    // parser rejects anything that is not tabular anyway.
    if (!/\.csv$/i.test(file.originalname)) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    return this.knowledgeService.importProductCsv(
      actor.tenantId,
      file.buffer.toString('utf8'),
      actor.userId,
      decodeUploadName(file.originalname),
    );
  }

  @Post('documents/import/bulk')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @UseInterceptors(
    FileInterceptor('file', {
      // Memory storage on purpose — same reasoning as the product import above.
      limits: { fileSize: 5 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiOperation({ summary: 'Bulk-import documents (CSV/XLSX) into counsel or operation' })
  async importBulk(
    @CurrentUser() user: Principal,
    @Body() body: BulkImportRequest,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    const actor = this.tenantUser(user);
    if (!file) throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    // Extension, not mimetype — browsers label these files inconsistently.
    // The specific "unsupported file" code is thrown by the parser so the
    // operator learns which of five different problems to fix.
    return this.knowledgeService.importBulk(
      actor.tenantId,
      body.doc_group ?? DOC_GROUP.COUNSEL,
      { ...file, originalname: decodeUploadName(file.originalname) },
      actor.userId,
    );
  }

  // ---- AI ingest (PLN-260829 3차) ----

  @Post('ingest/file')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024, files: 1 } }),
  )
  @ApiOperation({ summary: 'Analyze a pdf/docx/xlsx/csv/md(.markdown) into draft articles (async)' })
  async ingestFile(
    @CurrentUser() user: Principal,
    @Body() body: IngestFileRequest,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    const actor = this.tenantUser(user);
    if (!file) throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    return this.ingest.startFile(
      actor.tenantId,
      { ...file, originalname: decodeUploadName(file.originalname) },
      body.doc_group ?? DOC_GROUP.COUNSEL,
    );
  }

  @Post('ingest/video')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Analyze a YouTube transcript into draft articles (async, R5 P1)' })
  async ingestVideo(@CurrentUser() user: Principal, @Body() body: IngestVideoRequest) {
    const actor = this.tenantUser(user);
    return this.ingest.startVideo(actor.tenantId, body.video_url, body.doc_group ?? DOC_GROUP.COUNSEL);
  }

  @Get('ingest/status')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Progress and drafts of the running (or most recent) ingest' })
  async ingestStatus(@CurrentUser() user: Principal) {
    return this.ingest.status(this.tenantUser(user).tenantId);
  }

  @Post('ingest/approve')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Save the reviewed drafts as knowledge documents' })
  async approveIngest(@CurrentUser() user: Principal, @Body() body: ApproveIngestRequest) {
    const actor = this.tenantUser(user);
    return this.ingest.approve(actor.tenantId, body.articles ?? [], actor.userId);
  }

  @Get('documents/import/catalog/preview')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Dry run: what a catalogue sync would create, update and hold back' })
  async previewCatalogSync(@CurrentUser() user: Principal) {
    return this.knowledgeService.previewCatalogSync(this.tenantUser(user).tenantId);
  }

  /**
   * Starts the conversion and returns at once. The run takes minutes — held
   * open it hit nginx's 60-second header timeout and the operator saw a 504
   * for work that had actually succeeded (RPT-260808 D3). Progress is read
   * from the status route below.
   */
  @Post('documents/import/catalog')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Start the catalogue → ProductInfo conversion (async)' })
  async syncCatalog(@CurrentUser() user: Principal) {
    const actor = this.tenantUser(user);
    return this.jobService.start(actor.tenantId, (report) =>
      this.knowledgeService.syncProductCatalog(actor.tenantId, actor.userId, report),
    );
  }

  @Get('documents/import/catalog/status')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Progress of the running (or most recent) catalogue conversion' })
  async catalogSyncStatus(@CurrentUser() user: Principal) {
    return this.jobService.get(this.tenantUser(user).tenantId);
  }

  @Get('proposals')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Answer proposals awaiting review (PLN-260810 S4)' })
  async proposals(@CurrentUser() user: Principal, @Query('status') status?: string) {
    return this.answerProposals.list(this.tenantUser(user).tenantId, status || 'pending');
  }

  @Post('proposals/:id/approve')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Approve a proposal — creates and indexes the document' })
  async approveProposal(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ApproveProposalRequest,
  ) {
    const actor = this.tenantUser(user);
    return this.answerProposals.approve(actor.tenantId, id, body, actor.userId);
  }

  @Post('proposals/:id/reject')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Reject a proposal with a reason the proposer can read' })
  async rejectProposal(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RejectProposalRequest,
  ) {
    const actor = this.tenantUser(user);
    return this.answerProposals.reject(actor.tenantId, id, body.reason, actor.userId);
  }

  // ---- Usage types (PLN-260824 A축) ----

  @Get('usage-types')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: "This tenant's usage-guide types, in match order" })
  async listUsageTypes(@CurrentUser() user: Principal) {
    const rows = await this.usageTypes.list(this.tenantUser(user).tenantId);
    return KnowledgeMapper.toUsageTypeList(rows);
  }

  @Post('usage-types')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Add a usage-guide type' })
  async createUsageType(@CurrentUser() user: Principal, @Body() body: SaveUsageTypeRequest) {
    const row = await this.usageTypes.create(this.tenantUser(user).tenantId, {
      label: body.label,
      keywords: body.keywords,
    });
    return KnowledgeMapper.toUsageType(row);
  }

  @Put('usage-types/reorder')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Set match order — the first matching type claims a product' })
  async reorderUsageTypes(@CurrentUser() user: Principal, @Body() body: ReorderRequest) {
    await this.usageTypes.reorder(this.tenantUser(user).tenantId, body.ids);
    return { reordered: body.ids.length };
  }

  // Declared above `:id` on purpose — `reorder` is a path, not an id, and the
  // parameter route would otherwise match it first.
  @Put('usage-types/:id')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Rename a type, retune its keywords, or turn it off' })
  async updateUsageType(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() body: SaveUsageTypeRequest,
  ) {
    const row = await this.usageTypes.update(this.tenantUser(user).tenantId, Number(id), {
      label: body.label,
      keywords: body.keywords,
      active: body.active,
    });
    return KnowledgeMapper.toUsageType(row);
  }

  @Post('usage-types/preview')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'How many products a keyword set would claim, before saving it' })
  async previewUsageType(
    @CurrentUser() user: Principal,
    @Body() body: PreviewUsageTypeRequest,
  ) {
    return this.usageTypes.preview(this.tenantUser(user).tenantId, body.keywords, {
      excludeId: body.exclude_id,
    });
  }

  // ---- Document categories (PLN-260824 B축) ----

  @Get('categories')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: "This tenant's document categories with live document counts" })
  async listCategories(@CurrentUser() user: Principal, @Query('group') group?: string) {
    return this.kbCategories.list(
      this.tenantUser(user).tenantId,
      group && (Object.values(DOC_GROUP) as string[]).includes(group) ? group : DOC_GROUP.COUNSEL,
    );
  }

  @Post('categories')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Add a category' })
  async createCategory(@CurrentUser() user: Principal, @Body() body: CreateCategoryRequest) {
    const row = await this.kbCategories.create(
      this.tenantUser(user).tenantId,
      body.name,
      body.label ?? null,
      body.doc_group ?? DOC_GROUP.COUNSEL,
    );
    return KnowledgeMapper.toCategory(row);
  }

  @Put('categories/:id/rename')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Rename a category and every document filed under it' })
  async renameCategory(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() body: RenameCategoryRequest,
  ) {
    const row = await this.kbCategories.rename(
      this.tenantUser(user).tenantId,
      Number(id),
      body.name,
    );
    return KnowledgeMapper.toCategory(row);
  }

  @Post('categories/merge')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Move documents into one category and drop the emptied ones' })
  async mergeCategories(@CurrentUser() user: Principal, @Body() body: MergeCategoriesRequest) {
    return this.kbCategories.merge(this.tenantUser(user).tenantId, body.from_ids, body.into_id);
  }

  @Put('categories/:id/hidden')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Keep a category out of the pickers without moving its documents' })
  async setCategoryHidden(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() body: SetCategoryHiddenRequest,
  ) {
    const row = await this.kbCategories.setHidden(
      this.tenantUser(user).tenantId,
      Number(id),
      body.hidden,
    );
    return KnowledgeMapper.toCategory(row);
  }

  @Put('categories/:id/agents')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Narrow a category to specific AI agents (empty = every agent)' })
  async setCategoryAgents(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() body: SetCategoryAgentsRequest,
  ) {
    const row = await this.kbCategories.setAgents(
      this.tenantUser(user).tenantId,
      Number(id),
      body.agent_ids ?? [],
    );
    return KnowledgeMapper.toCategory(row);
  }

  @Put('categories/:id/guest-visible')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({
    summary: 'Let unidentified visitors of a login_guidance agent be answered from this category',
  })
  async setCategoryGuestVisible(
    @CurrentUser() user: Principal,
    @Param('id') id: string,
    @Body() body: SetCategoryGuestVisibleRequest,
  ) {
    const row = await this.kbCategories.setGuestVisible(
      this.tenantUser(user).tenantId,
      Number(id),
      body.guest_visible,
    );
    return KnowledgeMapper.toCategory(row);
  }

  @Put('categories/reorder')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Set the order categories are listed in' })
  async reorderCategories(@CurrentUser() user: Principal, @Body() body: ReorderRequest) {
    await this.kbCategories.reorder(this.tenantUser(user).tenantId, body.ids);
    return { reordered: body.ids.length };
  }

  @Delete('categories/:id')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Delete a category that holds no documents' })
  async removeCategory(@CurrentUser() user: Principal, @Param('id') id: string) {
    await this.kbCategories.remove(this.tenantUser(user).tenantId, Number(id));
    return { removed: true };
  }

  @Get('usage-guides')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Usage guides per product type, with coverage and write state' })
  async usageGuides(@CurrentUser() user: Principal) {
    return this.knowledgeService.listUsageGuides(this.tenantUser(user).tenantId);
  }

  @Put('usage-guides/:key')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Write or rewrite the usage guide for a product type' })
  async saveUsageGuide(
    @CurrentUser() user: Principal,
    @Param('key') key: string,
    @Body() body: SaveUsageGuideRequest,
  ) {
    const actor = this.tenantUser(user);
    return this.knowledgeService.saveUsageGuide(
      actor.tenantId,
      key,
      { title: body.title, content: body.content },
      actor.userId,
    );
  }

  // --- Revision history (PLN T3) -------------------------------------------

  @Get('documents/:id/revisions')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Change history for a document (newest first)' })
  async listRevisions(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const rows = await this.revisionService.list(this.tenantUser(user).tenantId, id);
    return KnowledgeMapper.toRevisionList(rows);
  }

  @Get('documents/:id/revisions/:revisionId')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'One revision including its full content' })
  async getRevision(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Param('revisionId', ParseIntPipe) revisionId: number,
  ) {
    const rev = await this.revisionService.get(this.tenantUser(user).tenantId, id, revisionId);
    return KnowledgeMapper.toRevision(rev, true);
  }

  @Post('documents/:id/revisions/:revisionId/restore')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Roll the document back to a revision (recorded as a new revision)' })
  async restoreRevision(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Param('revisionId', ParseIntPipe) revisionId: number,
  ) {
    const actor = this.tenantUser(user);
    const doc = await this.knowledgeService.restoreRevision(
      actor.tenantId,
      id,
      revisionId,
      actor.userId,
    );
    return KnowledgeMapper.toDocument(doc);
  }

  @Post('documents/:id/reviewed')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Mark a document reviewed (resets its staleness clock)' })
  async markReviewed(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const actor = this.tenantUser(user);
    const doc = await this.knowledgeService.markReviewed(actor.tenantId, id, actor.userId);
    return KnowledgeMapper.toDocument(doc);
  }

  // --- Conflict review (PLN S4) --------------------------------------------

  @Get('conflicts')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Conflicting/duplicate document pairs awaiting review' })
  async listConflicts(@CurrentUser() user: Principal, @Query() query: ListConflictsQuery) {
    const { page, size } = normalizePage(query.page, query.size);
    const { items, total } = await this.conflictService.list(
      this.tenantUser(user).tenantId,
      query.status,
      page,
      size,
    );
    return new Paginated(items, buildPagination(page, size, total));
  }

  @Post('conflicts/scan')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Re-scan the knowledge base for contradicting pairs' })
  async scanConflicts(@CurrentUser() user: Principal) {
    return this.conflictService.scan(this.tenantUser(user).tenantId);
  }

  @Post('conflicts/:id/resolve')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Pick which document to follow; hides the other' })
  async resolveConflict(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: ResolveConflictRequest,
  ) {
    const actor = this.tenantUser(user);
    return this.conflictService.resolve(actor.tenantId, id, body.resolution, actor.userId);
  }

  @Post('conflicts/:id/retry')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Re-judge a pair the model failed on (ignores the attempt budget)' })
  async retryConflict(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    return this.conflictService.retry(this.tenantUser(user).tenantId, id);
  }

  @Post('conflicts/:id/rejudge')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Re-judge a pair against the current document contents' })
  async rejudgeConflict(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    return this.conflictService.rejudge(this.tenantUser(user).tenantId, id);
  }

  @Post('conflicts/:id/dismiss')
  @RequireCapability(CAPABILITY.KNOWLEDGE_SOURCE_MANAGE)
  @ApiOperation({ summary: 'Mark a pair as not a conflict (keeps it out of future scans)' })
  async dismissConflict(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const actor = this.tenantUser(user);
    return this.conflictService.dismiss(actor.tenantId, id, actor.userId);
  }
}
