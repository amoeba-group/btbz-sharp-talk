import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

export const REPORT_KIND = {
  /** One group over a period. */
  JOURNEY: 'journey',
  /** Two earlier reports, compared. */
  COMPARISON: 'comparison',
} as const;
export type ReportKind = (typeof REPORT_KIND)[keyof typeof REPORT_KIND];

export const REPORT_STATUS = {
  PENDING: 'pending',
  READY: 'ready',
  FAILED: 'failed',
} as const;
export type ReportStatus = (typeof REPORT_STATUS)[keyof typeof REPORT_STATUS];

/**
 * journey_reports — a written analysis of one group's conversations
 * (PLN-260825).
 *
 * The row is also the job. The catalogue sync keeps its progress in memory
 * because the durable record there is the audit trail and the work is
 * idempotent; here the report *is* the product, so a restart mid-run must not
 * lose it. That trade has a cost: a `pending` row can outlive the process that
 * was writing it, which is why boot sweeps stale ones into `failed`.
 */
@Entity('journey_reports')
@Index('idx_jr_lookup', ['tenantId', 'groupId', 'createdAt'])
@Index('idx_jr_status', ['tenantId', 'status'])
export class JourneyReport {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ name: 'group_id', type: 'bigint', transformer: bigintTransformer })
  groupId: number;

  @Column({ type: 'varchar', length: 16 })
  kind: string;

  /** Null on both ends means "everything" — the operator's "전체". */
  @Column({ name: 'period_from', type: 'date', nullable: true })
  periodFrom: string | null;

  @Column({ name: 'period_to', type: 'date', nullable: true })
  periodTo: string | null;

  /**
   * Which criteria version wrote this.
   *
   * Pinned, not looked up later: editing the criteria must not change what a
   * past report concluded, or the decision someone made from it cannot be
   * retraced.
   */
  @Column({ name: 'criteria_version', type: 'int' })
  criteriaVersion: number;

  /**
   * The sessions this report actually read.
   *
   * A group is a view — its membership changes after the fact. Without the
   * snapshot the same report could not be produced twice, and the numbers in it
   * would have no fixed referent.
   */
  @Column({ name: 'session_ids_json', type: 'json' })
  sessionIdsJson: number[];

  /** What the code computed. The narrative is written *from* this, never instead of it. */
  @Column({ name: 'metrics_json', type: 'json', nullable: true })
  metricsJson: Record<string, unknown> | null;

  /**
   * The report as data (PLN-261008 P2): headline, questions with their quotes,
   * hypotheses, actions. Null for reports written before it existed and for
   * ones whose structured reply did not hold up — the screen then shows the
   * Markdown body, which is always written.
   */
  @Column({ name: 'content_json', type: 'json', nullable: true })
  contentJson: Record<string, unknown> | null;

  @Column({ name: 'body_md', type: 'mediumtext', nullable: true })
  bodyMd: string | null;

  @Column({ type: 'varchar', length: 8 })
  language: string;

  @Column({ type: 'varchar', length: 16, default: REPORT_STATUS.PENDING })
  status: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  error: string | null;

  /** kind=comparison: the two reports being compared. */
  @Column({ name: 'source_report_ids', type: 'json', nullable: true })
  sourceReportIds: number[] | null;

  /** Nullable so deleting an engine does not erase what wrote the report. */
  @Column({ name: 'engine_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  engineId: number | null;

  @Column({ type: 'varchar', length: 24, nullable: true })
  provider: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  model: string | null;

  /**
   * Hidden rather than deleted: a comparison report names two earlier ones as
   * its input, and a dangling reference makes it unreadable.
   */
  @Column({ type: 'tinyint', width: 1, default: 0 })
  hidden: number;

  @Column({ name: 'created_by', type: 'bigint', transformer: bigintTransformer })
  createdBy: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'finished_at', type: 'datetime', nullable: true })
  finishedAt: Date | null;
}
