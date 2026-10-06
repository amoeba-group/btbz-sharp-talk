import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/** Where a category came from — it decides what may be done to it. */
export const CATEGORY_ORIGIN = {
  /** Someone typed it in the console. */
  MANUAL: 'manual',
  /**
   * Product sync wrote it. Read-only on purpose: `catalog-sync.service.ts`
   * compares the stored category against the one it would write to decide a
   * document is unchanged, so a rename here is undone at the next sync
   * (PLN D8). Refusing the edit is more honest than explaining the bounce-back.
   */
  CATALOG: 'catalog',
  /** Created for a new tenant by the default seed. */
  SEED: 'seed',
} as const;
export type CategoryOrigin = (typeof CATEGORY_ORIGIN)[keyof typeof CATEGORY_ORIGIN];

/**
 * kb_categories — a tenant's document categories as first-class rows
 * (PLN-260824 B축 / D6).
 *
 * `kb_documents.category` stays the string it always was and this table owns
 * it through `(tenant_id, name)`. The alternative — a foreign key on every
 * document — was considered and rejected: the categories arrive from outside
 * as *names* (catalogue sync, source adapters, CSV import), so a surrogate key
 * would buy integrity at the price of a name→id lookup at every boundary,
 * forever, and the only thing it saves is a bulk UPDATE on the rare rename
 * (PLN D6-1).
 *
 * The drift that choice admits — a document holding a category with no row —
 * is contained by routing every writer through `KbCategoryService.ensure()`.
 */
@Entity('kb_categories')
@Unique('uk_kb_category', ['tenantId', 'docGroup', 'name'])
export class KbCategory {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  @Index('idx_kb_category_tenant')
  tenantId: number;

  /** The exact string stored in `kb_documents.category`. */
  @Column({ type: 'varchar', length: 64 })
  name: string;

  /**
   * The document group this category belongs to (PLN-260829 D2-c). A category
   * is meaningful only inside one group — "배송" under counsel and "배송" under
   * operation are different things with different agent scopes — so the name
   * is unique per (tenant, group), not per tenant.
   */
  @Column({ name: 'doc_group', type: 'varchar', length: 16, default: 'counsel' })
  docGroup: string;

  /**
   * Display name, when the stored value is not what an operator wants to read
   * (`policy_return` → "Returns"). Null means show `name` as it is — so a
   * tenant that never opens this screen sees exactly what it saw before.
   */
  @Column({ type: 'varchar', length: 128, nullable: true })
  label: string | null;

  @Column({ type: 'varchar', length: 16, default: CATEGORY_ORIGIN.MANUAL })
  origin: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /** Kept out of the pickers without touching the documents filed under it. */
  @Column({ type: 'tinyint', width: 1, default: 0 })
  hidden: number;

  /**
   * Which AI agents may cite documents filed here (REQ-260826 R2).
   *
   * NULL or `[]` means every agent — the same convention scenario buttons use,
   * so an operator who has met one has met both. A non-empty array names the
   * only agents that may, which is why an agent created later sees none of the
   * scoped categories until someone adds it: an answer reaching the wrong
   * persona is the failure this exists to prevent, and an agent that cannot
   * answer escalates visibly instead.
   *
   * Ignored for `origin='catalog'` — product knowledge is common to everyone.
   *
   * ⚠️ `ensure()` must never write this field. Sync ensures every category on
   * every run, so writing a default there would quietly release the operator's
   * scope at the next sync — the shape of the rename catalogue sync undid (D8).
   */
  @Column({ name: 'agent_ids', type: 'json', nullable: true })
  agentIds: number[] | null;

  /**
   * May an UNIDENTIFIED visitor be answered from documents filed here
   * (PLN-261001 v1.1)? Only consulted when the answering agent's guest policy
   * is `login_guidance`; for `open` agents it changes nothing. Default 0: a
   * gated agent answers a guest from nothing until an operator opens a
   * category on purpose — the same fail-closed direction as `agent_ids`.
   *
   * ⚠️ `ensure()` must never write this field either (see `agentIds`).
   */
  @Column({ name: 'guest_visible', type: 'tinyint', width: 1, default: 0 })
  guestVisible: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
