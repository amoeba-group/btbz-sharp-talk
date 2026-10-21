import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DOC_GROUP, KbDocument } from './entity/kb-document.entity';
import { KnowledgeSource } from './entity/knowledge-source.entity';
import { REVISION_KIND } from './entity/kb-document-revision.entity';
import { KbRevisionService } from './kb-revision.service';
import { SourceAdapter, SourceItem } from './source-adapter.interface';
import { GdriveAdapter } from './adapters/gdrive.adapter';
import { NotionAdapter } from './adapters/notion.adapter';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

export interface SyncResult {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  /** Documents whose source item disappeared — hidden, never deleted (D7). */
  hidden: number;
  failed: number;
  /**
   * Set when an external source returned nothing while documents still exist,
   * so hiding was refused. The sync is reported as failed: the likeliest cause
   * is lost access, not an emptied folder (PLN-260815 §6).
   */
  guardedEmpty?: boolean;
  /**
   * Items the adapter held back this run — Notion's per-sync page cap today.
   * Recorded because a truncated sync otherwise reports exactly like a
   * complete one.
   */
  dropped?: number;
  /** Documents stored with only part of their source content (see SourceFetch). */
  truncated?: number;
  /** How long the pull took. Notion syncs are minutes, not milliseconds. */
  elapsedMs?: number;
  /**
   * Why a failed run failed, clamped short (REQ-260828 B1). Without this the
   * console showed a red timestamp over zeroed counts and the actual reason
   * (e.g. Notion's "share the page with your integration") lived only in the
   * server log — the go2joy case exactly.
   */
  error?: string;
  /**
   * Documents taken over from a deleted or hidden source that held the same
   * page (FIX-261021). Counted in `updated` as well.
   */
  adopted?: number;
}

/**
 * Shared ingestion pipeline for every knowledge source (PLN-260804 S1).
 *
 * Adapters answer one question — "what does the source hold right now" — and
 * everything downstream happens here: upserting on a stable key, skipping
 * unchanged content, hiding what disappeared, batching the embedding calls and
 * recording history. That split is deliberate: the CSV importer already learned
 * these lessons the hard way, and a second source type should not have to
 * relearn them.
 */
@Injectable()
export class SourceSyncService {
  private readonly logger = new Logger(SourceSyncService.name);
  private readonly adapters = new Map<string, SourceAdapter>();

  constructor(
    @InjectRepository(KbDocument) private readonly docRepo: Repository<KbDocument>,
    @InjectRepository(KnowledgeSource) private readonly sourceRepo: Repository<KnowledgeSource>,
    private readonly revisions: KbRevisionService,
    gdrive: GdriveAdapter,
    notion: NotionAdapter,
  ) {
    // The internal board is not registered (REQ-260826 R5). It was a second way
    // to write knowledge by hand with nothing the document editor lacks, and no
    // console screen ever existed to write a post — so every board source was
    // empty by construction. Existing rows stay and simply report unsupported,
    // the same treatment `repository` gets; their documents are untouched,
    // because retrieval excludes UNdesignated sources rather than admitting
    // designated ones.
    this.register(gdrive);
    this.register(notion);
  }

  private register(adapter: SourceAdapter): void {
    this.adapters.set(adapter.type, adapter);
  }

  /** Source types that can actually ingest today. */
  supportedTypes(): string[] {
    return [...this.adapters.keys()];
  }

  adapterFor(type: string): SourceAdapter | null {
    return this.adapters.get(type) ?? null;
  }

  /**
   * Pull a source and reconcile its documents.
   *
   * Returns the ids that need embedding rather than embedding them here: the
   * caller batches, because one call per document is the shape that fails under
   * rate limiting (PR #95).
   */
  async sync(
    tenantId: number,
    source: KnowledgeSource,
    actorUserId: number | null,
  ): Promise<{ result: SyncResult; touchedIds: number[] }> {
    const adapter = this.adapterFor(source.type);
    if (!adapter) {
      // Loudly, not silently: registering a source of an unimplemented type and
      // seeing nothing happen is the confusion this whole plan started from.
      this.logger.warn(`sync requested for unimplemented source type "${source.type}"`);
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }

    const startedAt = Date.now();
    // Adapters may answer with a bare list or with a list plus what it left
    // out; normalise here so neither shape leaks past this line.
    const fetched = await adapter.fetchAll(tenantId, source);
    const items = Array.isArray(fetched) ? fetched : fetched.items;
    const dropped = Array.isArray(fetched) ? 0 : (fetched.dropped ?? 0);
    const truncated = Array.isArray(fetched) ? 0 : (fetched.truncated ?? 0);
    const result: SyncResult = {
      fetched: items.length,
      created: 0,
      updated: 0,
      skipped: 0,
      hidden: 0,
      failed: 0,
      ...(dropped ? { dropped } : {}),
      ...(truncated ? { truncated } : {}),
    };
    const touchedIds: number[] = [];

    const existing = await this.docRepo.find({ where: { tenantId, sourceId: source.id } });
    const byKey = new Map(existing.filter((d) => d.externalKey).map((d) => [d.externalKey!, d]));
    const seen = new Set<string>();
    const conflicts: string[] = [];

    for (const item of items) {
      if (!item.externalKey || !item.title) {
        result.failed += 1;
        continue;
      }
      if (seen.has(item.externalKey)) {
        this.logger.warn(`source ${source.id} returned duplicate key ${item.externalKey}`);
        result.failed += 1;
        continue;
      }
      seen.add(item.externalKey);

      let found = byKey.get(item.externalKey);
      if (!found) {
        // The document key is unique per tenant, not per source. A page that
        // another source used to hold keeps its (hidden) row after that source
        // is deleted, so inserting again failed the whole sync with a
        // duplicate-key error — go2joy re-created its Hotel Admin source and
        // could never sync it (FIX-261021-Notion-Resync).
        const holder = await this.docRepo.findOne({
          where: { tenantId, docGroup: DOC_GROUP.COUNSEL, externalKey: item.externalKey },
        });
        if (holder) {
          if (!(await this.isAdoptable(tenantId, holder))) {
            conflicts.push(`${item.externalKey} (${holder.sourceId ? `source #${holder.sourceId}` : 'manual document'} #${holder.id})`);
            result.failed += 1;
            continue;
          }
          holder.sourceId = source.id;
          found = holder;
          result.adopted = (result.adopted ?? 0) + 1;
        }
      }
      if (!found) {
        const saved = await this.docRepo.save(
          this.docRepo.create({
            tenantId,
            sourceId: source.id,
            docGroup: DOC_GROUP.COUNSEL,
            externalKey: item.externalKey,
            source: 'knowledge_store',
            title: item.title,
            category: item.category,
            content: item.content,
            sourceUrl: item.sourceUrl,
            active: 1,
            status: 'pending',
            embeddingRef: null,
          }),
        );
        await this.revisions.record(tenantId, saved, null, REVISION_KIND.CREATE, actorUserId);
        touchedIds.push(Number(saved.id));
        result.created += 1;
        continue;
      }

      const unchanged =
        found.title === item.title &&
        (found.content ?? '') === item.content &&
        (found.category ?? null) === item.category &&
        (found.sourceUrl ?? null) === item.sourceUrl &&
        found.active === 1;
      if (unchanged) {
        // Unchanged is not the same as searchable: a document left at 'pending'
        // by an earlier partial run would otherwise be skipped forever and stay
        // invisible to retrieval (learned from the CSV import, PR #104).
        if (found.status !== 'embedded') touchedIds.push(Number(found.id));
        result.skipped += 1;
        continue;
      }

      const before = { ...found } as KbDocument;
      found.title = item.title;
      found.category = item.category;
      found.content = item.content;
      found.sourceUrl = item.sourceUrl;
      found.active = 1; // a previously hidden item that came back is live again
      found.status = 'pending';
      const saved = await this.docRepo.save(found);
      await this.revisions.record(tenantId, saved, before, REVISION_KIND.UPDATE, actorUserId);
      touchedIds.push(Number(saved.id));
      result.updated += 1;
    }

    if (conflicts.length) {
      result.error = `Already synced by another live source, skipped: ${conflicts.slice(0, 3).join(', ')}${
        conflicts.length > 3 ? ` (+${conflicts.length - 3} more)` : ''
      }`.slice(0, 500);
      this.logger.warn(`source ${source.id}: ${conflicts.length} page(s) held by another source — ${conflicts.join(', ')}`);
    }

    // An external source that returned nothing, while documents still exist, is
    // far more likely to have lost access than to have been emptied. Hiding
    // here would take the whole source out of retrieval on a transient
    // permission problem, and nothing in the result would say why.
    const liveDocs = existing.filter((d) => d.active === 1).length;
    if (items.length === 0 && liveDocs > 0 && adapter.trustEmptyListing === false) {
      result.guardedEmpty = true;
      result.error = `Source returned 0 items while ${liveDocs} document(s) are live — hiding refused; check the source's access.`;
      this.logger.warn(
        `source ${source.id} (${source.type}) returned 0 items while ${liveDocs} document(s) are live — ` +
          `refusing to hide them; check the source's access`,
      );
      result.elapsedMs = Date.now() - startedAt;
      return { result, touchedIds };
    }

    result.hidden = await this.hideMissing(tenantId, existing, seen, actorUserId);
    result.elapsedMs = Date.now() - startedAt;
    return { result, touchedIds };
  }

  /**
   * A row holding the same page key may be taken over when nothing live owns
   * it: it is hidden, or the source that created it no longer exists. A live
   * document of another source or one written by hand is left alone — two
   * sources syncing one page would overwrite each other on every run.
   */
  private async isAdoptable(tenantId: number, holder: KbDocument): Promise<boolean> {
    if (holder.active !== 1) return true;
    if (holder.sourceId == null) return false;
    const owner = await this.sourceRepo.findOne({ where: { id: holder.sourceId, tenantId } });
    return !owner;
  }

  /**
   * Documents whose source item is gone are hidden, not deleted (D7).
   *
   * Hiding is reversible and is what retrieval already honours; a hard delete
   * would destroy the revision history's subject and could not be undone if the
   * disappearance turned out to be an upstream glitch.
   */
  private async hideMissing(
    tenantId: number,
    existing: KbDocument[],
    seen: Set<string>,
    actorUserId: number | null,
  ): Promise<number> {
    let hidden = 0;
    for (const doc of existing) {
      if (!doc.externalKey || seen.has(doc.externalKey) || doc.active !== 1) continue;
      const before = { ...doc } as KbDocument;
      doc.active = 0;
      const saved = await this.docRepo.save(doc);
      await this.revisions.record(tenantId, saved, before, REVISION_KIND.UPDATE, actorUserId);
      hidden += 1;
    }
    return hidden;
  }

  /** Persist the outcome so the console can show when a source last ran. */
  async recordSyncState(source: KnowledgeSource, status: string, result: SyncResult): Promise<void> {
    source.lastSyncAt = new Date();
    source.lastSyncStatus = status;
    source.lastSyncResult = { ...result };
    await this.sourceRepo.save(source);
  }
}
