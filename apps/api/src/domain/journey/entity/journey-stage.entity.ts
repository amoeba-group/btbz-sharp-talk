import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/**
 * journey_stages — the columns of a tenant's journey board (PLN-261006 P2/P3).
 *
 * Tenant data, not code: a shop and a hotel partner desk do not walk the same
 * path. A tenant with no rows gets Kotler's 5A on first read (D3), the same
 * vocabulary the journey report already writes in.
 *
 * `key` is what a journey stores, so renaming a stage never moves anyone.
 */
@Entity('journey_stages')
@Unique('uk_journey_stage', ['tenantId', 'key'])
export class JourneyStage {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ type: 'varchar', length: 32 })
  key: string;

  /** Display name per language code (EN, KO, …); EN is the fallback. */
  @Column({ type: 'json' })
  label: Record<string, string>;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /** Hex colour of the board column header, e.g. #6366F1. */
  @Column({ type: 'varchar', length: 9, nullable: true })
  color: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
