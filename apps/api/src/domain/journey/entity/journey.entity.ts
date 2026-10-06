import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/**
 * journeys — one per chat group: where this customer (timeline) or client
 * company (project) stands, and who looks after it (PLN-261006 P2, D1).
 *
 * Created the first time someone sets a stage — an untouched group has no row
 * and shows as "no stage". Stage history lives in audit_logs
 * (`journey.stage_changed`), like every other change log in the console.
 */
@Entity('journeys')
@Unique('uk_journey_group', ['tenantId', 'groupId'])
@Index('idx_journey_stage', ['tenantId', 'stageKey'])
export class Journey {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ name: 'group_id', type: 'bigint', transformer: bigintTransformer })
  groupId: number;

  @Column({ name: 'stage_key', type: 'varchar', length: 32, nullable: true })
  stageKey: string | null;

  @Column({ name: 'owner_user_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  ownerUserId: number | null;

  /** When the current stage began — the board's "days in stage". */
  @Column({ name: 'stage_changed_at', type: 'datetime', nullable: true })
  stageChangedAt: Date | null;

  @Column({ name: 'created_by', type: 'bigint', transformer: bigintTransformer })
  createdBy: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
