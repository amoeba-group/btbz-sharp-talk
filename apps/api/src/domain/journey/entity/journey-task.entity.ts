import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

export const JOURNEY_TASK_SOURCE = { MANUAL: 'manual', REPORT: 'report' } as const;
export type JourneyTaskSource = (typeof JOURNEY_TASK_SOURCE)[keyof typeof JOURNEY_TASK_SOURCE];

/**
 * journey_tasks — the next actions for one journey (PLN-261006 P2, G3).
 *
 * A report suggests next actions in prose; a person picks the ones worth doing
 * and they become rows here (`source=report`) with an owner and a due date.
 * Nothing is created automatically.
 */
@Entity('journey_tasks')
@Index('idx_journey_task_journey', ['tenantId', 'journeyId'])
export class JourneyTask {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ name: 'journey_id', type: 'bigint', transformer: bigintTransformer })
  journeyId: number;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ name: 'due_at', type: 'date', nullable: true })
  dueAt: string | null;

  @Column({ name: 'assignee_user_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  assigneeUserId: number | null;

  @Column({ name: 'done_at', type: 'datetime', nullable: true })
  doneAt: Date | null;

  @Column({ type: 'varchar', length: 8, default: JOURNEY_TASK_SOURCE.MANUAL })
  source: JourneyTaskSource;

  @Column({ name: 'report_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  reportId: number | null;

  @Column({ name: 'created_by', type: 'bigint', transformer: bigintTransformer })
  createdBy: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
