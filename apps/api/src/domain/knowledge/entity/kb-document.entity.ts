import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/** Top-level document groups (PLN-260804 D2; operation: PLN-260828 D1). */
export const DOC_GROUP = {
  /** Support/policy knowledge — everything that predates the split. */
  COUNSEL: 'counsel',
  /** Product catalogue knowledge. */
  PRODUCT: 'product',
  /** Operational how-to knowledge — admin/partner manuals, runbooks. */
  OPERATION: 'operation',
} as const;
export type DocGroup = (typeof DOC_GROUP)[keyof typeof DOC_GROUP];

/**
 * Groups the generic bulk importer accepts. Product joined with the bulk
 * export round-trip (PLN-260903): the dedicated catalogue importer still owns
 * shop-export files, while this path speaks the document's own vocabulary.
 * Lives here, not in the service: a constant exported from a service file has
 * already caused a circular-import boot crash tsc could not catch.
 */
export const BULK_IMPORT_GROUPS = [
  DOC_GROUP.COUNSEL,
  DOC_GROUP.OPERATION,
  DOC_GROUP.PRODUCT,
] as const;

/** kb_documents — knowledge base documents for RAG (FR-064). */
// FULLTEXT for the RAG retriever (PERF-2); ngram parser so ko (CJK) tokenizes.
@Index('ft_kb_title_content', ['title', 'content'], { fulltext: true, parser: 'ngram' })
@Entity('kb_documents')
export class KbDocument {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  @Index('idx_kb_tenant')
  tenantId: number | null;

  @Column({ type: 'varchar', length: 24, default: 'knowledge_store' })
  source: string; // knowledge_store/google_drive

  @Column({ name: 'source_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  @Index('idx_kb_source')
  sourceId: number | null;

  /**
   * Top-level grouping above `category` (PLN-260804 D2). Closed set: a free
   * string would let a typo split a group in two.
   *
   * Named doc_group because `group` is a MySQL reserved word.
   */
  @Column({ name: 'doc_group', type: 'varchar', length: 16, default: 'counsel' })
  @Index('idx_kb_group')
  docGroup: string;

  /**
   * Stable key from the origin system — the Shopify `Handle` for imported
   * products. Unique per (tenant, group), and NULL repeats freely under a
   * MySQL UNIQUE index, so hand-written documents stay unconstrained.
   *
   * 255, not 128: Shopify handles are slugified product titles and the supplied
   * catalogue peaks at 185 characters. The average is 63, which is what made
   * 128 look sufficient — the maximum is the number that matters here.
   */
  @Column({ name: 'external_key', type: 'varchar', length: 255, nullable: true })
  externalKey: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  @Index('idx_kb_category')
  category: string | null; // faq/product/policy/warranty

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'longtext', nullable: true })
  content: string | null;

  @Column({ name: 'embedding_ref', type: 'varchar', length: 128, nullable: true })
  embeddingRef: string | null;

  /** Model that produced the Qdrant vector — reindex re-embeds on mismatch. */
  @Column({ name: 'embedding_model', type: 'varchar', length: 64, nullable: true })
  embeddingModel: string | null;

  @Column({ name: 'embedded_at', type: 'datetime', nullable: true })
  embeddedAt: Date | null;

  @Column({ type: 'tinyint', width: 1, default: 1 })
  active: number;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: string; // embedded/pending

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  // --- Provenance & staleness (PLN D7) -------------------------------------
  // `updated_at` was the only age signal and it moves for any edit, including
  // one that never revisited the facts. These make "where did this come from"
  // and "is it due for review" answerable.

  /** Where the content came from — the source document, ticket or page. */
  @Column({ name: 'source_url', type: 'varchar', length: 512, nullable: true })
  sourceUrl: string | null;

  /**
   * The video this document explains (PLN-261006-KB-Video-Links): an
   * `https://` URL played as is, or `notion:<blockId>` for a file uploaded to
   * Notion, whose signed URL expires within the hour and is fetched fresh on
   * click. Answers citing the document get a "watch video" link; nothing else
   * reads this.
   */
  @Column({ name: 'video_ref', type: 'varchar', length: 255, nullable: true })
  videoRef: string | null;

  /** Staff member accountable for keeping this accurate. */
  @Column({ name: 'owner_user_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  ownerUserId: number | null;

  /** When the policy itself took effect — distinct from when the row was edited. */
  @Column({ name: 'effective_from', type: 'date', nullable: true })
  effectiveFrom: string | null;

  /** Review cadence in days; with `reviewedAt` this yields a due date. */
  @Column({ name: 'review_interval_days', type: 'int', nullable: true })
  reviewIntervalDays: number | null;

  @Column({ name: 'reviewed_at', type: 'datetime', nullable: true })
  reviewedAt: Date | null;

  @Column({ name: 'reviewed_by', type: 'bigint', nullable: true, transformer: bigintTransformer })
  reviewedBy: number | null;

  /** Set when a conflict review picks the other document as the one to follow. */
  @Column({ name: 'superseded_by', type: 'bigint', nullable: true, transformer: bigintTransformer })
  supersededBy: number | null;
}
