import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { KbDocument } from './entity/kb-document.entity';
import { CATEGORY_ORIGIN } from './entity/kb-category.entity';
import { KbCategoryService } from './kb-category.service';
import { KbRevisionService } from './kb-revision.service';
import { REVISION_KIND } from './entity/kb-document-revision.entity';
import { parseCsvRecords } from './csv.util';
import { parseXlsxRecords } from './xlsx.util';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { VIDEO_REF_PATTERN } from './video-ref.util';

/** Lower-cased on both sides so `Title` / `TITLE` from a spreadsheet still match. */
const REQUIRED_COLUMNS = ['category', 'title', 'content'] as const;
const OPTIONAL_COLUMNS = ['external_key', 'source_url', 'video_ref'] as const;
/** Same ceiling as the product importer — refuse absurd files before the row loop. */
const MAX_ROWS = 5_000;

/** Column limits mirrored from KbDocument — a too-long value is a row error the
 * operator can fix, not a MySQL 1406 that aborts the whole import. */
const LIMITS = { category: 64, title: 255, external_key: 255, source_url: 512, video_ref: 255 } as const;

export interface BulkImportResult {
  parsed: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
  errors: Array<{ row: number; reason: string }>;
}

/**
 * Generic document bulk import for the counsel/operation groups (PLN-260828 D3).
 *
 * The product group keeps its own importer: its columns come from the Shopify
 * export, it bridges into products_cache, and its key is the Handle — none of
 * which applies here. This one speaks the document's own vocabulary
 * (category/title/content) and upserts by `external_key` when the file carries
 * one, falling back to the title so re-uploading a corrected file updates
 * instead of duplicating.
 *
 * Embedding is NOT done here — rows land as `pending` and the caller embeds
 * them in batches (single-text embed calls are not retried and died under rate
 * limiting, PR #95 — same reason the product importer is two-phase).
 */
@Injectable()
export class BulkImportService {
  private readonly logger = new Logger(BulkImportService.name);

  constructor(
    @InjectRepository(KbDocument) private readonly docRepo: Repository<KbDocument>,
    private readonly revisions: KbRevisionService,
    private readonly categories: KbCategoryService,
  ) {}

  /** Decode + parse the uploaded file into header-keyed records. */
  async parseFile(
    filename: string,
    buffer: Buffer,
  ): Promise<{ headers: string[]; records: Record<string, string>[] }> {
    if (/\.xlsx$/i.test(filename)) return parseXlsxRecords(buffer);
    if (/\.csv$/i.test(filename)) {
      const text = buffer.toString('utf8');
      // CP949 (Korean Excel's default "CSV") decodes to U+FFFD under utf8.
      // Reject the file with the specific reason instead of importing mojibake
      // rows that would each fail validation for the wrong reason.
      if (text.includes('�')) {
        this.logger.warn(`bulk import rejected: "${filename}" is not valid UTF-8`);
        throw new BusinessException(ERROR_CODE.BULK_IMPORT_ENCODING, HttpStatus.BAD_REQUEST);
      }
      return parseCsvRecords(text);
    }
    this.logger.warn(`bulk import rejected: unsupported file "${filename}"`);
    throw new BusinessException(ERROR_CODE.BULK_IMPORT_UNSUPPORTED_FILE, HttpStatus.BAD_REQUEST);
  }

  async importRecords(
    tenantId: number,
    docGroup: string,
    input: { headers: string[]; records: Record<string, string>[] },
    actorUserId: number,
  ): Promise<{ result: BulkImportResult; touchedIds: number[] }> {
    // Header lookup is case-insensitive: spreadsheets get re-typed by hand and
    // `Title` should not fail an import that `title` would pass.
    const headerMap = new Map(input.headers.map((h) => [h.toLowerCase(), h]));
    const missing = REQUIRED_COLUMNS.filter((c) => !headerMap.has(c));
    if (missing.length > 0) {
      this.logger.warn(`bulk import rejected: missing columns ${missing.join(', ')}`);
      throw new BusinessException(ERROR_CODE.BULK_IMPORT_MISSING_COLUMNS, HttpStatus.BAD_REQUEST);
    }
    if (input.records.length === 0) {
      throw new BusinessException(ERROR_CODE.BULK_IMPORT_EMPTY, HttpStatus.BAD_REQUEST);
    }
    if (input.records.length > MAX_ROWS) {
      throw new BusinessException(ERROR_CODE.BULK_IMPORT_TOO_MANY_ROWS, HttpStatus.BAD_REQUEST);
    }

    const hasVideoColumn = headerMap.has('video_ref');
    const col = (rec: Record<string, string>, name: string): string => {
      const key = headerMap.get(name);
      return key ? (rec[key] ?? '').trim() : '';
    };

    const result: BulkImportResult = {
      parsed: input.records.length,
      created: 0,
      updated: 0,
      skipped: 0,
      invalid: 0,
      errors: [],
    };

    // Existing documents of this group, keyed for in-memory upsert decisions.
    // Title keys are TRIMMED on both sides: rows arrive cell-trimmed, and a
    // stored title with stray whitespace ("아시아 배송 " on staging) would
    // otherwise miss its own exported row and come back as a duplicate
    // document on every re-upload (found in the PLN-260903 staging smoke).
    const existing = await this.docRepo.find({ where: { tenantId, docGroup } });
    const byKey = new Map(existing.filter((d) => d.externalKey).map((d) => [d.externalKey!, d]));
    const byTitle = new Map(existing.map((d) => [d.title.trim(), d]));

    const touchedIds: number[] = [];
    const seenKeys = new Set<string>();
    const seenTitles = new Set<string>();
    const categoriesSeen = new Set<string>();

    for (const [i, rec] of input.records.entries()) {
      const rowNo = i + 2; // 1-based, plus the header line
      // Empty means uncategorized, not invalid: documents without a category
      // legitimately exist, and the export writes them back as '' — rejecting
      // the row would break the download → edit → upload round-trip
      // (PLN-260903 D1).
      const category = col(rec, 'category') || null;
      const title = col(rec, 'title');
      const content = col(rec, 'content');
      const externalKey = col(rec, 'external_key') || null;
      const sourceUrl = col(rec, 'source_url') || null;
      // Only a file that HAS the column speaks about videos: an older export
      // re-uploaded without it must not wipe links set since.
      const videoRef = hasVideoColumn ? col(rec, 'video_ref') || null : undefined;

      const problem = this.rowProblem({ category, title, content, externalKey, sourceUrl, videoRef: videoRef ?? null });
      if (problem) {
        result.invalid += 1;
        result.errors.push({ row: rowNo, reason: problem });
        continue;
      }
      // Duplicates inside one file would make the last row win silently —
      // report them instead (same stance as the product importer).
      if (externalKey && seenKeys.has(externalKey)) {
        result.invalid += 1;
        result.errors.push({ row: rowNo, reason: `duplicate external_key "${externalKey}" in this file` });
        continue;
      }
      if (!externalKey && seenTitles.has(title)) {
        result.invalid += 1;
        result.errors.push({ row: rowNo, reason: `duplicate title "${title}" in this file` });
        continue;
      }
      if (externalKey) seenKeys.add(externalKey);
      seenTitles.add(title);
      if (category) categoriesSeen.add(category);

      let found = externalKey ? byKey.get(externalKey) : byTitle.get(title);
      if (!found && externalKey) {
        // First upload of a keyed file over hand-written documents: adopt the
        // key onto the title match instead of duplicating it. A title match
        // that already carries a DIFFERENT key is another row's document —
        // leave it alone and create.
        const t = byTitle.get(title);
        if (t && !t.externalKey) found = t;
      }

      if (!found) {
        const saved = await this.docRepo.save(
          this.docRepo.create({
            tenantId,
            docGroup,
            externalKey,
            source: 'knowledge_store',
            category,
            title,
            content,
            sourceUrl,
            videoRef: videoRef ?? null,
            active: 1,
            status: 'pending',
            embeddingRef: null,
          }),
        );
        await this.revisions.record(tenantId, saved, null, REVISION_KIND.CREATE, actorUserId);
        byTitle.set(saved.title.trim(), saved);
        if (saved.externalKey) byKey.set(saved.externalKey, saved);
        touchedIds.push(Number(saved.id));
        result.created += 1;
        continue;
      }

      const textUnchanged =
        found.title === title &&
        (found.content ?? '') === content &&
        (found.category ?? null) === category &&
        (found.sourceUrl ?? null) === sourceUrl;
      const videoChanged = videoRef !== undefined && (found.videoRef ?? null) !== videoRef;
      if (textUnchanged && videoChanged) {
        // A video link alone changes nothing the search reads — no re-embed.
        found.videoRef = videoRef ?? null;
        await this.docRepo.save(found);
        result.updated += 1;
        continue;
      }
      if (textUnchanged) {
        // Unchanged content is not the same as "already searchable" — a row
        // from a partial earlier run that never embedded must be re-queued.
        if (found.status !== 'embedded') touchedIds.push(Number(found.id));
        result.skipped += 1;
        continue;
      }

      const before = { ...found } as KbDocument;
      found.title = title;
      found.category = category;
      found.content = content;
      found.sourceUrl = sourceUrl;
      if (videoRef !== undefined) found.videoRef = videoRef;
      // A row matched by title adopts the file's external_key so the NEXT
      // upload matches it by the stable key instead.
      if (externalKey) found.externalKey = externalKey;
      found.status = 'pending';
      const saved = await this.docRepo.save(found);
      await this.revisions.record(tenantId, saved, before, REVISION_KIND.UPDATE, actorUserId);
      touchedIds.push(Number(saved.id));
      result.updated += 1;
    }

    // Keep kb_categories describing reality. ensure() creates only when absent
    // — an existing category keeps its agent scope and hidden flag untouched.
    for (const name of categoriesSeen) {
      await this.categories.ensure(tenantId, name, CATEGORY_ORIGIN.MANUAL, docGroup);
    }

    return { result, touchedIds };
  }

  /** Fetch the documents a caller should embed after an import. */
  async pendingByIds(tenantId: number, ids: number[]): Promise<KbDocument[]> {
    if (ids.length === 0) return [];
    return this.docRepo.find({ where: { tenantId, id: In(ids) } });
  }

  private rowProblem(v: {
    category: string | null;
    title: string;
    content: string;
    externalKey: string | null;
    sourceUrl: string | null;
    videoRef: string | null;
  }): string | null {
    if (!v.title) return 'title is empty';
    if (!v.content) return 'content is empty';
    if (v.category && v.category.length > LIMITS.category)
      return `category exceeds ${LIMITS.category} characters`;
    if (v.title.length > LIMITS.title) return `title exceeds ${LIMITS.title} characters`;
    if (v.externalKey && v.externalKey.length > LIMITS.external_key)
      return `external_key exceeds ${LIMITS.external_key} characters`;
    if (v.sourceUrl && v.sourceUrl.length > LIMITS.source_url)
      return `source_url exceeds ${LIMITS.source_url} characters`;
    if (v.videoRef && (v.videoRef.length > LIMITS.video_ref || !VIDEO_REF_PATTERN.test(v.videoRef)))
      return 'video_ref must be an https:// URL or notion:<block id>';
    return null;
  }
}
