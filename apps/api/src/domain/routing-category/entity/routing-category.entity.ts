import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/**
 * routing_categories — the tenant's own list for the routing rules' category
 * axis (PLN-261024-Settings-Handoff-Tab-Routing-Categories). It replaces the
 * fixed five-region catalogue: the session's signed `region` value is matched
 * against `code`, which rules, unit/label scopes and companies store.
 *
 * The code is fixed once created (it is what the host sends and what the
 * references hold); only the name and order change. Deleting is refused while
 * anything uses the code (D6).
 */
@Entity('routing_categories')
@Unique('uq_rcat_tenant_code', ['tenantId', 'code'])
export class RoutingCategory {
  // BIGINT PK comes back as a STRING at runtime — compare with String() on both sides.
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  /** Canonical form (`canonicalRegion`): lower-case, `_` for spaces/hyphens. */
  @Column({ type: 'varchar', length: 64 })
  code: string;

  /** NULL = the console's built-in localized name for a known region code, else the code. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  name: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /** Offered to the shopper in the widget when an agent is requested (PLN-261024 consult categories). */
  @Column({ type: 'tinyint', width: 1, default: 0 })
  visible: number;

  /** Per-language display names for the widget ({en,es,ko,vi,ja,zh}); missing → `name`. */
  @Column({ type: 'json', nullable: true })
  names: Record<string, string> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
