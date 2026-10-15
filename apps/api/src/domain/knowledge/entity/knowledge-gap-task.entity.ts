import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

export const GAP_SOURCE = {
  ESCALATION_CLUSTER: 'escalation_cluster',
  NO_SOURCE: 'no_source',
  AGENT_RESOLUTION: 'agent_resolution',
  /** An agent rated an AI answer partial/inaccurate (PLN-261015 D7). */
  ANSWER_RATING: 'answer_rating',
} as const;
export type GapSource = (typeof GAP_SOURCE)[keyof typeof GAP_SOURCE];

export const GAP_STATUS = {
  PROPOSED: 'proposed',
  ACCEPTED: 'accepted',
  DISMISSED: 'dismissed',
} as const;

/**
 * knowledge_gap_tasks — the closed loop's inbox (PLN-260809-Issue-Workflow-P5,
 * 결정 9): batch analytics and agent resolutions PROPOSE knowledge; a human
 * accepts (→ existing KB create+embed pipeline) or dismisses. Never auto-applied.
 */
@Entity('knowledge_gap_tasks')
@Unique('uk_gap', ['tenantId', 'source', 'refKey'])
@Index('idx_gap_tenant_status', ['tenantId', 'status'])
export class KnowledgeGapTask {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ type: 'varchar', length: 24 })
  source: string; // GapSource

  /** Idempotency axis: cluster id / intent / issue id. */
  @Column({ name: 'ref_key', type: 'varchar', length: 64 })
  refKey: string;

  @Column({ type: 'varchar', length: 300 })
  title: string; // representative question (PII-scrubbed)

  @Column({ type: 'text', nullable: true })
  detail: string | null; // answer candidate or metric summary

  @Column({ name: 'metric_json', type: 'json', nullable: true })
  metricJson: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 12, default: GAP_STATUS.PROPOSED })
  status: string;

  @Column({ name: 'decided_by', type: 'bigint', nullable: true, transformer: bigintTransformer })
  decidedBy: number | null;

  @Column({ name: 'decided_at', type: 'datetime', nullable: true })
  decidedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
