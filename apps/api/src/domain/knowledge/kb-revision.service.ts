import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KbDocument } from './entity/kb-document.entity';
import { KbDocumentRevision, REVISION_KIND } from './entity/kb-document-revision.entity';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/** Fields a revision snapshots; also the set compared to compute `changedFields`. */
const TRACKED = [
  'title',
  'category',
  'content',
  'sourceUrl',
  'effectiveFrom',
  'reviewIntervalDays',
  'active',
  // PLN-261012 SG-20: a re-stamped UI version changes what answers say about a
  // document, so it belongs in the trail (and in a rollback).
  'uiVersion',
] as const;
type Tracked = (typeof TRACKED)[number];

/**
 * Knowledge document history (PLN T3).
 *
 * Two layers on purpose: an audit entry answers "who did what, when" and shows
 * up in the existing work log alongside agent activity, while a snapshot row
 * answers "what did it actually say before" and makes a rollback possible.
 * Neither existed — knowledge edits left no trace anywhere.
 */
@Injectable()
export class KbRevisionService {
  private readonly logger = new Logger(KbRevisionService.name);

  constructor(
    @InjectRepository(KbDocument) private readonly docRepo: Repository<KbDocument>,
    @InjectRepository(KbDocumentRevision)
    private readonly revRepo: Repository<KbDocumentRevision>,
    private readonly audit: AuditService,
  ) {}

  /**
   * Record a change. `before` is the document as it stood beforehand; pass null
   * for a creation.
   *
   * When a document has no history yet, this writes TWO rows: a baseline
   * holding the pre-change state, then the change itself. Otherwise the first
   * edit after this feature shipped would be unrollbackable — there would be
   * nothing to roll back *to*.
   */
  async record(
    tenantId: number,
    doc: KbDocument,
    before: KbDocument | null,
    kind: string,
    actorUserId: number | null,
    restoredFrom?: number,
  ): Promise<KbDocumentRevision | null> {
    try {
      let next = await this.nextRevisionNo(tenantId, Number(doc.id));

      if (before && next === 1) {
        await this.revRepo.save(
          this.snapshot(tenantId, before, 1, REVISION_KIND.BASELINE, null, null),
        );
        next = 2;
      }

      const changed = before ? this.changedFields(before, doc) : [...TRACKED];
      // A no-op save (opening the editor and pressing save) should not litter
      // the history — but a restore always records, since the point is the trail.
      if (before && changed.length === 0 && kind !== REVISION_KIND.RESTORE) return null;

      const saved = await this.revRepo.save(
        this.snapshot(tenantId, doc, next, kind, changed, actorUserId, restoredFrom),
      );
      await this.writeAudit(tenantId, doc, kind, changed, actorUserId, saved.revisionNo);
      return saved;
    } catch (e) {
      // History must never block the edit itself — the document write has
      // already happened by the time we get here.
      this.logger.warn(`revision record failed for doc ${doc.id}: ${(e as Error).message}`);
      return null;
    }
  }

  /** Audit-only event (no content change), e.g. marking a document reviewed. */
  async recordAudit(
    tenantId: number,
    documentId: number,
    action: string,
    actorUserId: number | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.audit.write({
        tenantId,
        actorType: 'user',
        actorId: actorUserId ?? 0,
        action,
        target: `kb_document:${documentId}`,
        metadata: metadata ?? null,
      });
    } catch (e) {
      this.logger.warn(`audit write failed (${action}): ${(e as Error).message}`);
    }
  }

  async list(tenantId: number, documentId: number): Promise<KbDocumentRevision[]> {
    return this.revRepo.find({
      where: { tenantId, documentId },
      order: { revisionNo: 'DESC' },
    });
  }

  async get(tenantId: number, documentId: number, revisionId: number): Promise<KbDocumentRevision> {
    const rev = await this.revRepo.findOne({ where: { id: revisionId, tenantId, documentId } });
    if (!rev) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    return rev;
  }

  /**
   * Roll the document back to a revision. This moves forward, never backward:
   * the restore becomes a new revision, so the history it came from stays
   * intact and the rollback itself is attributable.
   *
   * Returns the document so the caller can re-embed — the body may have changed.
   */
  async restore(
    tenantId: number,
    documentId: number,
    revisionId: number,
    actorUserId: number,
  ): Promise<{ doc: KbDocument; contentChanged: boolean; versionChanged: boolean }> {
    const rev = await this.get(tenantId, documentId, revisionId);
    const doc = await this.docRepo.findOne({ where: { id: documentId, tenantId } });
    if (!doc) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);

    const before = { ...doc } as KbDocument;
    const contentChanged = (doc.content ?? null) !== (rev.content ?? null);

    doc.title = rev.title;
    doc.category = rev.category;
    doc.content = rev.content;
    doc.sourceUrl = rev.sourceUrl;
    doc.effectiveFrom = rev.effectiveFrom;
    doc.reviewIntervalDays = rev.reviewIntervalDays;
    doc.active = rev.active;
    // The UI version rides with the content it describes (PLN-261012 SG-20):
    // rolling the text back to the v0.9 wording while the document still says
    // v0.12 would silence the caveat on exactly the stale text. NULL on the
    // revision means "not recorded" (it predates the column), NOT "unversioned"
    // — applying it would wipe a version stamped since, so the document keeps its own.
    if (rev.uiVersion !== null && rev.uiVersion !== undefined) doc.uiVersion = rev.uiVersion.trim() || null;
    const versionChanged = (before.uiVersion ?? null) !== (doc.uiVersion ?? null);
    const saved = await this.docRepo.save(doc);

    await this.record(
      tenantId,
      saved,
      before,
      REVISION_KIND.RESTORE,
      actorUserId,
      rev.revisionNo,
    );
    return { doc: saved, contentChanged, versionChanged };
  }

  private async nextRevisionNo(tenantId: number, documentId: number): Promise<number> {
    // MAX + 1, never COUNT + 1: a deleted or skipped revision would otherwise
    // collide with an existing number (repo convention for per-tenant sequences).
    const row = await this.revRepo
      .createQueryBuilder('r')
      .select('MAX(r.revision_no)', 'max')
      .where('r.tenant_id = :tenantId', { tenantId })
      .andWhere('r.document_id = :documentId', { documentId })
      .getRawOne<{ max: string | null }>();
    return Number(row?.max ?? 0) + 1;
  }

  private changedFields(before: KbDocument, after: KbDocument): Tracked[] {
    // Compared as strings: `effectiveFrom` is a DATE that TypeORM may hand back
    // as either a string or a Date depending on the driver path, and an
    // identity check would then report a change on every save.
    const norm = (v: unknown): string => {
      if (v === null || v === undefined) return '';
      // A DATE column compared as a Date stringifies to a locale-dependent
      // form ("Fri Feb 28 2026 …") that never equals the "2026-03-01" the
      // string path yields — take the date part from both.
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v);
    };
    return TRACKED.filter((f) => norm(before[f]) !== norm(after[f]));
  }

  private snapshot(
    tenantId: number,
    doc: KbDocument,
    revisionNo: number,
    changeKind: string,
    changedFields: string[] | null,
    actorUserId: number | null,
    restoredFrom?: number,
  ): KbDocumentRevision {
    return this.revRepo.create({
      tenantId,
      documentId: Number(doc.id),
      revisionNo,
      title: doc.title,
      category: doc.category,
      content: doc.content,
      sourceUrl: doc.sourceUrl,
      effectiveFrom: doc.effectiveFrom,
      reviewIntervalDays: doc.reviewIntervalDays,
      // '' = "recorded, unversioned"; NULL is reserved for pre-column revisions.
      uiVersion: doc.uiVersion ?? '',
      active: doc.active,
      changedFields,
      changeKind,
      actorUserId,
      restoredFrom: restoredFrom ?? null,
    });
  }

  private async writeAudit(
    tenantId: number,
    doc: KbDocument,
    kind: string,
    changed: string[],
    actorUserId: number | null,
    revisionNo: number,
  ): Promise<void> {
    const action =
      kind === REVISION_KIND.CREATE
        ? 'knowledge.document_created'
        : kind === REVISION_KIND.DELETE
          ? 'knowledge.document_deleted'
          : kind === REVISION_KIND.RESTORE
            ? 'knowledge.document_restored'
            : 'knowledge.document_updated';
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId: actorUserId ?? 0,
      action,
      target: `kb_document:${doc.id}`,
      // Field names only — the content itself lives in the revision row, which
      // has a different lifetime from the audit trail.
      metadata: { revisionNo, changedFields: changed, title: doc.title },
    });
  }
}
