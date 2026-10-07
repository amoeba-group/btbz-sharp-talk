import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import { normalizePage } from '@sharptalk/common';
import { MODERATION_DECISION } from '@sharptalk/types';
import { AiGatewayService } from '../../infrastructure/external/ai/ai-gateway.service';
import { RagService } from '../chat/rag.service';
import { ModerationService } from '../moderation/moderation.service';
import { QdrantService } from '../../infrastructure/external/vector/qdrant.service';
import { KnowledgeSource } from './entity/knowledge-source.entity';
import { DOC_GROUP, KbDocument } from './entity/kb-document.entity';
import { KbFile } from './entity/kb-file.entity';
import {
  CreateDocumentRequest,
  CreateSourceRequest,
  ListDocumentsQuery,
  UpdateDocumentRequest,
  UpdateSourceRequest,
} from './dto/request/knowledge.request';
import { KbConflictService, isStale } from './kb-conflict.service';
import { KbRevisionService } from './kb-revision.service';
import { ProductImportService } from './product-import.service';
import { BulkImportService } from './bulk-import.service';
import { CatalogSyncPreview, CatalogSyncService } from './catalog-sync.service';
import { UsageGuideService, UsageGuideSummary } from './usage-guide.service';
import { SourceSyncService } from './source-sync.service';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { AuditLog } from '../audit/entity/audit-log.entity';
import { decryptSecret } from '../../global/util/crypto.util';
import { REVISION_KIND } from './entity/kb-document-revision.entity';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/**
 * Knowledge source / RAG corpus management (FR-064, FR-065). All operations are
 * tenant-scoped. Documents are embedded through the AI gateway (Voyage voyage-4,
 * or the deterministic stub when keyless) and mirrored into the Qdrant vector
 * index; MySQL remains the source of truth and Qdrant is rebuildable via
 * reindexAll() (PLAN-KB-VectorHybrid-Qdrant W3).
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  /** Detached-retry backoff (ms). After the last failure the doc stays 'pending' for reindex. */
  private static readonly RETRY_DELAYS_MS = [1_000, 5_000, 15_000];
  /** Keep embedding input well inside voyage-4's 32K-token context. */
  private static readonly EMBED_MAX_CHARS = 30_000;

  constructor(
    @InjectRepository(KnowledgeSource) private readonly sourceRepo: Repository<KnowledgeSource>,
    @InjectRepository(KbDocument) private readonly docRepo: Repository<KbDocument>,
    @InjectRepository(KbFile) private readonly fileRepo: Repository<KbFile>,
    private readonly ai: AiGatewayService,
    private readonly qdrant: QdrantService,
    private readonly rag: RagService,
    private readonly moderation: ModerationService,
    private readonly conflicts: KbConflictService,
    private readonly revisions: KbRevisionService,
    private readonly productImport: ProductImportService,
    private readonly bulkImport: BulkImportService,
    private readonly catalogSync: CatalogSyncService,
    private readonly usageGuides: UsageGuideService,
    private readonly sourceSync: SourceSyncService,
    @InjectRepository(IntegrationCredential)
    private readonly credRepo: Repository<IntegrationCredential>,
    // Optional: run-history reads (PLN-260828-Source-Conversion-History).
    @InjectRepository(AuditLog)
    private readonly auditRepo?: Repository<AuditLog>,
  ) {}

  // ---- Sources ----

  async listSources(tenantId: number): Promise<KnowledgeSource[]> {
    return this.sourceRepo.find({ where: { tenantId }, order: { id: 'DESC' } });
  }

  /** Source types with a working adapter — the console greys out the rest. */
  supportedSourceTypes(): string[] {
    return this.sourceSync.supportedTypes();
  }

  async createSource(tenantId: number, body: CreateSourceRequest): Promise<KnowledgeSource> {
    // Validate before saving. Accepting a source whose configuration cannot
    // work — no folder id, no credential — and only surfacing it at sync time
    // is exactly the "registers fine, does nothing" behaviour this whole line
    // of work set out to remove.
    const adapter = this.sourceSync.adapterFor(body.type);
    // A type with no adapter can never ingest, so creating the row only buys a
    // source that reports "unsupported" forever. Five of those exist on staging
    // (REQ-260826 R5) — refuse at the door rather than adding a sixth. Rows
    // created before their type was retired keep working as they are.
    if (!adapter) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, {
        type: [`unsupported source type: ${body.type}`],
      });
    }
    const reason = adapter.validateConfig(body.config_json ?? null);
    if (reason) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, {
        config_json: [reason],
      });
    }
    // Credentialled source types declare what they need; asking the adapter
    // keeps this from growing a branch per provider (REQ-260821 G5).
    if (adapter?.credential) {
      const cred = await this.credRepo.findOne({
        where: { tenantId, provider: adapter.credential.provider },
      });
      // Present is not the same as usable: a secret written under a rotated
      // key still has a row, and the source would be created only to fail at
      // every sync afterwards.
      if (!cred?.secretEnc || !this.isReadable(cred.secretEnc)) {
        throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, {
          credential: [`Register the ${adapter.credential.label} before adding this source.`],
        });
      }
    }

    const source = this.sourceRepo.create({
      tenantId,
      type: body.type,
      name: body.name,
      status: 'active',
      designated: body.designated ?? 1,
      configJson: body.config_json ?? null,
    });
    return this.sourceRepo.save(source);
  }

  private isReadable(secret: Buffer): boolean {
    try {
      return decryptSecret(secret).length > 0;
    } catch (e) {
      this.logger.warn(`stored credential could not be decrypted: ${(e as Error).message}`);
      return false;
    }
  }

  async updateSource(
    tenantId: number,
    id: number,
    body: UpdateSourceRequest,
  ): Promise<KnowledgeSource> {
    const source = await this.findSource(tenantId, id);
    if (body.name !== undefined) source.name = body.name;
    if (body.status !== undefined) source.status = body.status;
    if (body.designated !== undefined) source.designated = body.designated;
    return this.sourceRepo.save(source);
  }

  /**
   * Delete a source, deactivating its documents first (PLN-260829 P1-1).
   *
   * A bare row delete used to orphan the documents: they stayed active with a
   * dangling source_id, and the designated-exclusion subquery could never
   * filter them again. Deactivating keeps them reviewable and re-activatable
   * from the document list; hard-deleting knowledge is the operator's call,
   * one document at a time.
   */
  async deleteSource(
    tenantId: number,
    id: number,
    actorUserId: number | null = null,
  ): Promise<{ deactivatedDocuments: number }> {
    const source = await this.findSource(tenantId, id);
    const docs = await this.docRepo.find({ where: { tenantId, sourceId: id, active: 1 } });
    if (docs.length > 0) {
      await this.docRepo.update({ tenantId, sourceId: id, active: 1 }, { active: 0 });
      if (this.qdrant.enabled) {
        for (const doc of docs) {
          // Retrieval reads MySQL's active flag too, so a failed flip here is
          // shadow state, not a leak — reindexAll() reconciles it.
          this.qdrant
            .setActive(Number(doc.id), false)
            .catch((e) => this.logger.warn(`qdrant setActive(${doc.id}) failed: ${e.message}`));
        }
      }
    }
    await this.sourceRepo.delete({ id, tenantId });
    await this.revisions.recordAudit(tenantId, 0, 'knowledge.source_deleted', actorUserId, {
      sourceId: id,
      sourceName: source.name,
      sourceType: source.type,
      deactivatedDocuments: docs.length,
    });
    this.logger.log(
      `source ${id} ("${source.name}") deleted; ${docs.length} document(s) deactivated`,
    );
    return { deactivatedDocuments: docs.length };
  }

  // ---- Documents ----

  async listDocuments(
    tenantId: number,
    query: ListDocumentsQuery,
  ): Promise<{ items: KbDocument[]; total: number; page: number; size: number }> {
    const { page, size } = normalizePage(query.page, query.size);
    const where: Record<string, unknown> = { tenantId };
    if (query.source_id !== undefined) where.sourceId = Number(query.source_id);
    if (query.category !== undefined) where.category = query.category;
    if (query.group !== undefined) where.docGroup = query.group;
    // Filters (PLN-260826-KB-Documents-List-UI). Values are equality-matched —
    // an unknown source/status just returns an empty page, never an error.
    if (query.active !== undefined) where.active = Number(query.active);
    if (query.source !== undefined) where.source = query.source;
    if (query.status !== undefined) where.status = query.status;
    // Sort axis is a whitelist mapped here — user input never reaches ORDER BY
    // directly. Unset (or anything else, which the DTO already rejects) keeps
    // the original id DESC, so existing callers see identical ordering.
    const dir: 'ASC' | 'DESC' = query.order === 'asc' ? 'ASC' : 'DESC';
    const order: Record<string, 'ASC' | 'DESC'> =
      query.sort === 'title'
        ? { title: dir, id: 'DESC' }
        : query.sort === 'updated'
          ? { updatedAt: dir, id: 'DESC' }
          : { id: 'DESC' };
    const [items, total] = await this.docRepo.findAndCount({
      // PERF-9: the list never renders the LONGTEXT body — skip it so a page
      // of documents doesn't drag megabytes of content off disk. Detail/edit
      // endpoints still load the full row.
      select: [
        'id',
        'tenantId',
        'source',
        'sourceId',
        'category',
        'title',
        'embeddingRef',
        'active',
        'status',
        'docGroup',
        'externalKey',
        'updatedAt',
        'reviewedAt',
        'reviewIntervalDays',
        'effectiveFrom',
        'supersededBy',
      ],
      where,
      order,
      skip: (page - 1) * size,
      take: size,
    });
    return { items, total, page, size };
  }

  /**
   * Distinct source/status values actually present for this tenant — the
   * console's filter selects are built from these instead of a hardcoded
   * list, so a new origin system shows up the day its first document does
   * (invisible-fallback prevention).
   */
  async listDocumentFacets(tenantId: number): Promise<{ sources: string[]; statuses: string[] }> {
    const [sources, statuses] = await Promise.all([
      this.docRepo
        .createQueryBuilder('kb')
        .select('DISTINCT kb.source', 'v')
        .where('kb.tenant_id = :tenantId', { tenantId })
        .orderBy('v', 'ASC')
        .getRawMany<{ v: string }>(),
      this.docRepo
        .createQueryBuilder('kb')
        .select('DISTINCT kb.status', 'v')
        .where('kb.tenant_id = :tenantId', { tenantId })
        .orderBy('v', 'ASC')
        .getRawMany<{ v: string }>(),
    ]);
    return {
      sources: sources.map((r) => r.v).filter(Boolean),
      statuses: statuses.map((r) => r.v).filter(Boolean),
    };
  }

  /** Full document including LONGTEXT content (list omits it — PERF-9). */
  async getDocument(tenantId: number, id: number): Promise<KbDocument> {
    return this.findDocument(tenantId, id);
  }

  /**
   * Category breakdown for the console's category navigator
   * (PLN-Knowledge-QA-Console F3). One grouped query, tenant-scoped.
   */
  async categoryCounts(
    tenantId: number,
    group?: string,
  ): Promise<Array<{ group: string; category: string | null; total: number; active: number }>> {
    // Grouped by (group, category) so the console can show per-group totals and
    // a category list scoped to the selected group from one query.
    const qb = this.docRepo
      .createQueryBuilder('kb')
      .select('kb.doc_group', 'grp')
      .addSelect('kb.category', 'category')
      .addSelect('COUNT(*)', 'total')
      .addSelect('SUM(CASE WHEN kb.active = 1 THEN 1 ELSE 0 END)', 'active')
      .where('kb.tenantId = :tenantId', { tenantId });
    if (group) qb.andWhere('kb.doc_group = :group', { group });
    const rows = await qb
      .groupBy('kb.doc_group')
      .addGroupBy('kb.category')
      .orderBy('total', 'DESC')
      .getRawMany<{ grp: string; category: string | null; total: string; active: string }>();
    return rows.map((r) => ({
      group: r.grp,
      category: r.category,
      total: Number(r.total),
      active: Number(r.active ?? 0),
    }));
  }

  /**
   * Answer a question from this tenant's knowledge base and return the source
   * documents behind it (PLN-Knowledge-QA-Console F1). Admin-facing verification
   * tool: no conversation or session is created, so nothing lands in the chat
   * history or the agent queue. The mandatory moderation gate (FR-069/POL-020)
   * still runs — a blocked answer is reported as blocked rather than shown,
   * because "this answer would be blocked" is itself the diagnostic.
   */
  /**
   * `aiAgentId` answers as that agent would — same knowledge scope a shopper
   * pinned to it would get. Omitted, the operator sees everything they manage,
   * which is the point of the console: you cannot fix what is hidden from you.
   */
  async ask(
    tenantId: number,
    question: string,
    language = 'EN',
    preferGroup?: string,
    aiAgentId?: number | null,
  ): Promise<{
    answer: string;
    confidence: number;
    blocked: boolean;
    sources: Array<{
      id: number;
      title: string;
      category: string | null;
      similarity: number | null;
      snippet: string;
      /** Source system the document came from — knowledge_store or google_drive. */
      source: string | null;
      /** Past its review cadence, so its facts may have moved on. */
      stale: boolean;
      /** Contradicts another cited document (an open conflict names this one). */
      conflicted: boolean;
    }>;
  }> {
    const result = await this.rag.answer(
      tenantId,
      question,
      language.toUpperCase(),
      undefined,
      preferGroup,
      undefined,
      aiAgentId ?? null,
    );
    const moderated = await this.moderation.moderate({
      tenantId,
      scope: 'ai',
      authorType: 'ai',
      text: result.text,
    });
    const blocked = moderated.decision === MODERATION_DECISION.BLOCKED;

    // Provenance/freshness/conflict markers for the cited documents.
    const citedIds = result.citations.map((c) => Number(c.id)).filter(Number.isFinite);
    const [citedDocs, conflicted] = await Promise.all([
      citedIds.length ? this.docRepo.find({ where: { id: In(citedIds), tenantId } }) : Promise.resolve([]),
      this.conflicts.forDocuments(tenantId, citedIds),
    ]);
    const docsById = new Map(citedDocs.map((d) => [Number(d.id), d]));

    return {
      answer: blocked ? '' : moderated.text,
      confidence: result.confidence,
      blocked,
      sources: result.citations.map((c) => {
        const doc = docsById.get(Number(c.id));
        return {
          id: Number(c.id),
          title: c.title,
          category: c.category,
          similarity: c.similarity,
          snippet: c.snippet,
          source: doc?.source ?? null,
          stale: doc ? isStale(doc) : false,
          // A flat ranked list gave no way to tell which of two disagreeing
          // sources to trust; this marks the ones already flagged for review.
          conflicted: conflicted.has(Number(c.id)),
        };
      }),
    };
  }

  /**
   * Record that a person has re-checked this document's facts. Distinct from
   * saving an edit: `updated_at` moves for any change, including one that never
   * revisited the content, so it cannot answer "is this still true?".
   */
  async markReviewed(tenantId: number, id: number, userId: number): Promise<KbDocument> {
    const doc = await this.findDocument(tenantId, id);
    doc.reviewedAt = new Date();
    doc.reviewedBy = userId;
    const saved = await this.docRepo.save(doc);
    // Audit only — nothing about the content changed, so a snapshot would just
    // duplicate the previous revision.
    await this.revisions.recordAudit(tenantId, id, 'knowledge.document_reviewed', userId);
    return saved;
  }

  async createDocument(
    tenantId: number,
    body: CreateDocumentRequest,
    actorUserId: number | null = null,
  ): Promise<KbDocument> {
    const doc = this.docRepo.create({
      tenantId,
      source: body.source ?? 'knowledge_store',
      sourceId: body.source_id ?? null,
      category: body.category,
      docGroup: body.doc_group ?? DOC_GROUP.COUNSEL,
      title: body.title,
      content: body.content,
      sourceUrl: body.source_url ?? null,
      videoRef: body.video_ref || null,
      active: 1,
      status: 'pending',
      embeddingRef: null,
    });
    const saved = await this.docRepo.save(doc);
    await this.revisions.record(tenantId, saved, null, REVISION_KIND.CREATE, actorUserId);
    return this.embed(saved);
  }

  async updateDocument(
    tenantId: number,
    id: number,
    body: UpdateDocumentRequest,
    actorUserId: number | null = null,
  ): Promise<KbDocument> {
    const doc = await this.findDocument(tenantId, id);
    // Snapshot the pre-edit state before the entity is mutated in place.
    const before = { ...doc } as KbDocument;
    if (body.title !== undefined) doc.title = body.title;
    if (body.category !== undefined) doc.category = body.category;
    // Provenance/staleness fields (PLN D7). `null` is meaningful — clearing a
    // review cadence is a real edit — so only `undefined` means "not sent".
    if (body.source_url !== undefined) doc.sourceUrl = body.source_url;
    // A video link changes nothing the search reads, so it never re-embeds.
    if (body.video_ref !== undefined) doc.videoRef = body.video_ref || null;
    if (body.effective_from !== undefined) doc.effectiveFrom = body.effective_from;
    if (body.review_interval_days !== undefined) doc.reviewIntervalDays = body.review_interval_days;
    if (body.owner_user_id !== undefined) doc.ownerUserId = body.owner_user_id;
    const activeChanged = body.active !== undefined && body.active !== doc.active;
    if (body.active !== undefined) doc.active = body.active;
    let reembed = body.title !== undefined && doc.embeddingModel !== null;
    if (body.content !== undefined && body.content !== doc.content) {
      doc.content = body.content;
      reembed = true;
    }
    const saved = await this.docRepo.save(doc);
    await this.revisions.record(tenantId, saved, before, REVISION_KIND.UPDATE, actorUserId);
    if (reembed) return this.embed(saved);
    if (activeChanged && this.qdrant.enabled) {
      // Visibility toggle only — flip the Qdrant payload flag, no re-embedding.
      this.qdrant
        .setActive(saved.id, saved.active === 1)
        .catch((e) => this.logger.warn(`qdrant setActive(${saved.id}) failed: ${e.message}`));
    }
    return saved;
  }

  /** Usage guides per product type, written or not (PLN-260807 P2). */
  async listUsageGuides(tenantId: number): Promise<UsageGuideSummary[]> {
    return this.usageGuides.list(tenantId);
  }

  /**
   * Write one usage guide and index it immediately — it is a single document,
   * so the batch path buys nothing and the operator expects it searchable by
   * the time the dialog closes.
   */
  async saveUsageGuide(
    tenantId: number,
    typeKey: string,
    input: { title: string; content: string },
    actorUserId: number,
  ): Promise<Record<string, unknown>> {
    const doc = await this.usageGuides.upsert(tenantId, typeKey, input, actorUserId);
    const { embedded, failed } = await this.embedDocuments([doc]);
    await this.revisions.recordAudit(
      tenantId,
      Number(doc.id),
      'knowledge.usage_guide_saved',
      actorUserId,
      { typeKey, embedded, embedFailed: failed },
    );
    return { id: String(doc.id), typeKey, embedded, embedFailed: failed };
  }

  /** Dry run of the catalogue → knowledge conversion (PLN-260807 P1). */
  async previewCatalogSync(tenantId: number): Promise<CatalogSyncPreview> {
    return this.catalogSync.preview(tenantId);
  }

  /**
   * Convert the storefront catalogue into product knowledge, then embed what
   * changed in batches — same two-phase shape as the CSV import, for the same
   * reason (single-text embedding calls are not retried and die under rate
   * limiting, PR #95).
   */
  async syncProductCatalog(
    tenantId: number,
    actorUserId: number,
    report?: {
      write: (done: number, total: number) => void;
      embed: (done: number, total: number) => void;
    },
  ): Promise<Record<string, unknown>> {
    const { counts, touchedIds } = await this.catalogSync.sync(tenantId, actorUserId, report?.write);
    const docs = await this.productImport.pendingByIds(tenantId, touchedIds);
    const { embedded, failed } = await this.embedDocuments(docs, report?.embed);

    await this.revisions.recordAudit(tenantId, 0, 'knowledge.catalog_synced', actorUserId, {
      ...counts,
      embedded,
      embedFailed: failed,
    });
    this.logger.log(
      `catalog sync: scanned=${counts.scanned} families=${counts.families} ` +
        `created=${counts.created} updated=${counts.updated} curatedKept=${counts.curatedKept} ` +
        `unchanged=${counts.unchanged} held=${counts.held} embedded=${embedded} embedFailed=${failed}`,
    );
    return { ...counts, embedded, embedFailed: failed };
  }

  /**
   * Import a product catalogue CSV (PLN-260804 P3).
   *
   * Two phases on purpose: every row is upserted as `pending` first, then the
   * touched documents are embedded in batches. Embedding inside the row loop
   * would issue one single-text call per product — the shape the adapter does
   * not retry, and the one that failed under rate limiting (PR #95).
   */
  async importProductCsv(
    tenantId: number,
    csv: string,
    actorUserId: number,
    filename: string,
  ): Promise<Record<string, unknown>> {
    const { result, touchedIds } = await this.productImport.importCsv(tenantId, csv, actorUserId);
    const docs = await this.productImport.pendingByIds(tenantId, touchedIds);
    const { embedded, failed } = await this.embedDocuments(docs);

    await this.revisions.recordAudit(tenantId, 0, 'knowledge.products_imported', actorUserId, {
      filename,
      ...result,
      embedded,
      embedFailed: failed,
    });
    this.logger.log(
      `product import "${filename}": parsed=${result.parsed} created=${result.created} ` +
        `updated=${result.updated} skipped=${result.skipped} invalid=${result.invalid} ` +
        `embedded=${embedded} embedFailed=${failed}`,
    );
    return { ...result, embedded, embedFailed: failed };
  }

  /**
   * Bulk-import counsel/operation documents from a CSV or XLSX upload
   * (PLN-260828 D3). Same two-phase shape as the product import: upsert rows
   * as `pending`, then embed the touched documents in batches.
   */
  async importBulk(
    tenantId: number,
    docGroup: string,
    file: { originalname: string; buffer: Buffer },
    actorUserId: number,
  ): Promise<Record<string, unknown>> {
    const parsed = await this.bulkImport.parseFile(file.originalname, file.buffer);
    const { result, touchedIds } = await this.bulkImport.importRecords(
      tenantId,
      docGroup,
      parsed,
      actorUserId,
    );
    const docs = await this.bulkImport.pendingByIds(tenantId, touchedIds);
    const { embedded, failed } = await this.embedDocuments(docs);

    await this.revisions.recordAudit(tenantId, 0, 'knowledge.bulk_imported', actorUserId, {
      filename: file.originalname,
      docGroup,
      ...result,
      embedded,
      embedFailed: failed,
    });
    this.logger.log(
      `bulk import "${file.originalname}" (${docGroup}): parsed=${result.parsed} ` +
        `created=${result.created} updated=${result.updated} skipped=${result.skipped} ` +
        `invalid=${result.invalid} embedded=${embedded} embedFailed=${failed}`,
    );
    return { ...result, docGroup, embedded, embedFailed: failed };
  }

  /**
   * Roll a document back to an earlier revision. Re-embeds when the body
   * actually moved, so retrieval matches what the console now shows.
   */
  async restoreRevision(
    tenantId: number,
    documentId: number,
    revisionId: number,
    actorUserId: number,
  ): Promise<KbDocument> {
    const { doc, contentChanged } = await this.revisions.restore(
      tenantId,
      documentId,
      revisionId,
      actorUserId,
    );
    return contentChanged ? this.embed(doc) : doc;
  }

  async deleteDocument(tenantId: number, id: number, actorUserId: number | null = null): Promise<void> {
    const doc = await this.findDocument(tenantId, id);
    // Record before deleting: documents are hard-deleted here, so this is the
    // last chance to preserve what the document said.
    await this.revisions.record(tenantId, doc, null, REVISION_KIND.DELETE, actorUserId);
    await this.docRepo.delete({ id, tenantId });
    if (this.qdrant.enabled) {
      this.qdrant
        .delete(id)
        .catch((e) => this.logger.warn(`qdrant delete(${id}) failed: ${e.message}`));
    }
  }

  /**
   * Embed the document and mirror it into Qdrant. The first attempt runs
   * inline (so a normal create returns status 'embedded'); on failure the doc
   * stays 'pending' and detached retries fire with backoff. Documents still
   * 'pending' after the last retry are swept by reindexAll().
   */
  private async embed(doc: KbDocument): Promise<KbDocument> {
    try {
      await this.embedOnce(doc);
    } catch (e) {
      this.logger.warn(`embed(${doc.id}) failed, scheduling retries: ${(e as Error).message}`);
      doc.status = 'pending';
      await this.docRepo.save(doc);
      this.scheduleEmbedRetries(doc.id, 0);
    }
    return doc;
  }

  private async embedOnce(doc: KbDocument): Promise<void> {
    const text = `${doc.title}\n${doc.content ?? ''}`.slice(0, KnowledgeService.EMBED_MAX_CHARS);
    const emb = await this.ai.embed([text], 'document');
    if (this.qdrant.enabled) {
      await this.qdrant.upsert(doc.id, emb.vectors[0], {
        tenant_id: doc.tenantId ?? 0,
        category: doc.category,
        source: doc.source,
        active: doc.active === 1,
      });
      doc.embeddingRef = `qdrant:${doc.id}`;
    } else {
      doc.embeddingRef = `emb_${doc.id}`; // FULLTEXT-only deployment
    }
    doc.embeddingModel = emb.model;
    doc.embeddedAt = new Date();
    doc.status = 'embedded';
    await this.docRepo.save(doc);
  }

  private scheduleEmbedRetries(docId: number, attempt: number): void {
    if (attempt >= KnowledgeService.RETRY_DELAYS_MS.length) return;
    const delay = KnowledgeService.RETRY_DELAYS_MS[attempt];
    setTimeout(async () => {
      const doc = await this.docRepo.findOne({ where: { id: docId } }).catch(() => null);
      if (!doc || doc.status !== 'pending') return; // deleted or already embedded
      try {
        await this.embedOnce(doc);
        this.logger.log(`embed(${docId}) succeeded on retry ${attempt + 1}`);
      } catch (e) {
        this.logger.warn(`embed(${docId}) retry ${attempt + 1} failed: ${(e as Error).message}`);
        this.scheduleEmbedRetries(docId, attempt + 1);
      }
    }, delay).unref?.();
  }

  /** Batch size for reindex embedding calls (Voyage accepts up to 128 inputs). */
  private static readonly REINDEX_BATCH = 64;

  /**
   * Embed a specific set of documents in batches and mirror them into Qdrant.
   *
   * Extracted from reindexAll so bulk imports use the same path: creating
   * documents one at a time issues one single-text embedding call each, and the
   * adapter deliberately does not retry those (the guard that keeps live chat
   * from stalling on a rate-limit backoff), so a per-document loop dies
   * wholesale the moment the provider throttles — observed 2026-08-04 (PR #95).
   *
   * A stub-provider result while a real key is configured is a failure, not a
   * usable vector: stub pseudo-vectors share no space with real ones and would
   * corrupt the collection.
   */
  async embedDocuments(
    docs: KbDocument[],
    onBatch?: (done: number, total: number) => void,
  ): Promise<{ embedded: number; failed: number }> {
    const realKeySet = !!process.env.VOYAGE_API_KEY;
    let embedded = 0;
    let failed = 0;
    for (let i = 0; i < docs.length; i += KnowledgeService.REINDEX_BATCH) {
      onBatch?.(i, docs.length);
      const batch = docs.slice(i, i + KnowledgeService.REINDEX_BATCH);
      const texts = batch.map((d) =>
        `${d.title}\n${d.content ?? ''}`.slice(0, KnowledgeService.EMBED_MAX_CHARS),
      );
      try {
        const emb = await this.ai.embed(texts, 'document');
        if (realKeySet && emb.provider === 'stub') {
          throw new Error('embedder degraded to stub while VOYAGE_API_KEY is set');
        }
        for (let j = 0; j < batch.length; j++) {
          const doc = batch[j];
          try {
            if (this.qdrant.enabled) {
              await this.qdrant.upsert(Number(doc.id), emb.vectors[j], {
                tenant_id: doc.tenantId ?? 0,
                category: doc.category,
                source: doc.source,
                active: doc.active === 1,
              });
              doc.embeddingRef = `qdrant:${doc.id}`;
            } else {
              doc.embeddingRef = `emb_${doc.id}`;
            }
            doc.embeddingModel = emb.model;
            doc.embeddedAt = new Date();
            doc.status = 'embedded';
            await this.docRepo.save(doc);
            embedded++;
          } catch (e) {
            failed++;
            this.logger.warn(`embed upsert(${doc.id}) failed: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        failed += batch.length;
        this.logger.warn(`embed batch ${i}-${i + batch.length - 1} failed: ${(e as Error).message}`);
      }
    }
    return { embedded, failed };
  }

  /**
   * Rebuild the vector index from MySQL (npm run kb:reindex). Re-embeds
   * pending docs and docs whose stored embedding_model differs from the
   * current one; `force` re-embeds everything. Embeds in batches (a per-doc
   * call per row trips free-tier Voyage rate limits). When a Voyage key is
   * configured, a stub fallback result is counted as FAILURE — mixing stub
   * pseudo-vectors into a voyage collection would corrupt the vector space.
   */
  async reindexAll(opts: { force?: boolean } = {}): Promise<{ scanned: number; embedded: number; failed: number }> {
    const currentModel = (await this.ai.embed(['probe'], 'document')).model;
    const docs = opts.force
      ? await this.docRepo.find()
      : await this.docRepo.find({
          where: [
            { status: 'pending' },
            { embeddingModel: IsNull() },
            { embeddingModel: Not(currentModel) },
          ],
        });
    const { embedded, failed } = await this.embedDocuments(docs);
    return { scanned: docs.length, embedded, failed };
  }

  /**
   * Pull a source into the knowledge base and embed what changed.
   *
   * Two phases like the CSV import: reconcile every item first, then embed the
   * touched documents in batches. One embedding call per document is the shape
   * the adapter does not retry (PR #95).
   */
  async syncSource(
    tenantId: number,
    sourceId: number,
    actorUserId: number | null,
  ): Promise<Record<string, unknown>> {
    const source = await this.findSource(tenantId, sourceId);
    try {
      const { result, touchedIds } = await this.sourceSync.sync(tenantId, source, actorUserId);
      const docs = touchedIds.length
        ? await this.docRepo.find({ where: { tenantId, id: In(touchedIds) } })
        : [];
      const { embedded, failed } = await this.embedDocuments(docs);
      // A guarded run kept the documents, but it did not succeed: something is
      // wrong with the source's access, and a green "last synced" would hide
      // that until someone noticed the answers had gone stale.
      await this.sourceSync.recordSyncState(source, result.guardedEmpty ? 'failed' : 'ok', result);
      await this.revisions.recordAudit(tenantId, 0, 'knowledge.source_synced', actorUserId, {
        sourceId,
        type: source.type,
        status: result.guardedEmpty ? 'failed' : 'ok',
        ...result,
        embedded,
        embedFailed: failed,
      });
      this.logger.log(
        `source ${sourceId} (${source.type}) sync: fetched=${result.fetched} ` +
          `created=${result.created} updated=${result.updated} skipped=${result.skipped} ` +
          `hidden=${result.hidden} embedded=${embedded}`,
      );
      return { ...result, embedded, embedFailed: failed };
    } catch (e) {
      // Record the failure so the console shows a red state instead of a stale
      // "last synced" timestamp that suggests everything is fine. The reason
      // travels too (REQ-260828 B1) — a red row without a why sent the go2joy
      // operator to us instead of to Notion's share menu.
      await this.sourceSync.recordSyncState(source, 'failed', {
        fetched: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        hidden: 0,
        failed: 0,
        error: ((e as Error).message || String(e)).slice(0, 200),
      });
      // The run history must show failures too — until now only successes
      // were audited, which made every history read look all-green.
      await this.revisions.recordAudit(tenantId, 0, 'knowledge.source_synced', actorUserId, {
        sourceId,
        type: source.type,
        status: 'failed',
        error: ((e as Error).message || String(e)).slice(0, 200),
      });
      throw e;
    }
  }

  /**
   * Sync-run history for one source (PLN-260828-Source-Conversion-History).
   * Read from the audit log — every run already writes its full result there,
   * so the history costs no new table. Filtered on the metadata sourceId
   * (JSON) so rows recorded before this feature still appear.
   */
  async listSourceRuns(
    tenantId: number,
    sourceId: number,
    limit = 20,
  ): Promise<
    Array<{
      at: Date;
      actorId: number | null;
      status: string;
      result: Record<string, unknown>;
    }>
  > {
    await this.findSource(tenantId, sourceId);
    if (!this.auditRepo) return [];
    const rows = await this.auditRepo
      .createQueryBuilder('a')
      .where('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.action = :action', { action: 'knowledge.source_synced' })
      .andWhere("JSON_EXTRACT(a.metadata, '$.sourceId') = :sourceId", { sourceId })
      .orderBy('a.id', 'DESC')
      .take(Math.min(Math.max(limit, 1), 100))
      .getMany();
    return rows.map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const { sourceId: _s, type: _t, status, ...result } = meta;
      return {
        at: r.createdAt,
        actorId: r.actorId != null && Number(r.actorId) !== 0 ? Number(r.actorId) : null,
        // Rows from before this feature carry no status — they were only ever
        // written on success.
        status: typeof status === 'string' ? status : 'ok',
        result,
      };
    });
  }

  // ---- Helpers ----

  private async findSource(tenantId: number, id: number): Promise<KnowledgeSource> {
    const source = await this.sourceRepo.findOne({ where: { id, tenantId } });
    if (!source) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return source;
  }

  private async findDocument(tenantId: number, id: number): Promise<KbDocument> {
    const doc = await this.docRepo.findOne({ where: { id, tenantId } });
    if (!doc) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return doc;
  }
}
