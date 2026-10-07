import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { bigintTransformer, decimalTransformer } from '../../../global/util/transformers';

export const GOLDEN_RUN_KIND = {
  /** Captured before a change, so there is something to compare against. */
  BASELINE: 'baseline',
  /** Captured right after applying a proposal. */
  AFTER: 'after',
  /**
   * Same config, run again. Measures how much the answers move on their own —
   * without it, ordinary model variance reads as a regression.
   */
  NOISE: 'noise',
  /** Run on demand, tied to no particular change. */
  MANUAL: 'manual',
} as const;
export type GoldenRunKind = (typeof GOLDEN_RUN_KIND)[keyof typeof GOLDEN_RUN_KIND];

/** golden_runs — one pass of the question set (FR-073). */
@Entity('golden_runs')
@Index('idx_golden_run_tenant', ['tenantId', 'id'])
export class GoldenRun {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ type: 'varchar', length: 16 })
  kind: string;

  @Column({ type: 'varchar', length: 120, nullable: true })
  label: string | null;

  /** The proposal this run is evidence for, when it came from apply-verified. */
  @Column({ name: 'proposal_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  proposalId: number | null;

  /**
   * Hash of persona + rules + scenario overrides at run time. Comparing two runs
   * with the same hash measures noise; comparing across a change measures the
   * change. Without it an old baseline could be presented as evidence for a
   * change it predates.
   */
  @Column({ name: 'config_hash', type: 'varchar', length: 64 })
  configHash: string;

  @Column({ name: 'question_count', type: 'int', default: 0 })
  questionCount: number;

  /** Set when the set exceeded the per-run cap — never truncate silently. */
  @Column({ type: 'tinyint', default: 0 })
  truncated: number;

  @Column({ type: 'varchar', length: 16, default: 'running' })
  status: string;

  /** Which AI agent the run asked as (persona + knowledge scope); NULL = no scope. */
  @Column({ name: 'ai_agent_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  aiAgentId: number | null;

  @Column({ name: 'pass_count', type: 'int', default: 0 })
  passCount: number;

  @Column({ name: 'fail_count', type: 'int', default: 0 })
  failCount: number;

  @Column({ name: 'created_by', type: 'bigint', nullable: true, transformer: bigintTransformer })
  createdBy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt: Date | null;
}

/** golden_run_items — one question's answer within a run. */
@Entity('golden_run_items')
@Index('idx_golden_item_run', ['runId', 'id'])
export class GoldenRunItem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ name: 'run_id', type: 'bigint', transformer: bigintTransformer })
  runId: number;

  /** Nullable so deleting a question does not erase the history that used it. */
  @Column({ name: 'question_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  questionId: number | null;

  /** The question text as asked, so a later edit cannot rewrite the past. */
  @Column({ type: 'text' })
  question: string;

  @Column({ type: 'text' })
  answer: string;

  @Column({ type: 'decimal', precision: 4, scale: 3, nullable: true, transformer: decimalTransformer })
  confidence: number | null;

  @Column({ type: 'tinyint', default: 0 })
  blocked: number;

  @Column({ type: 'json', nullable: true })
  citations: Array<{ id: number; title: string; similarity: number | null }> | null;

  /** pass / fail against the question's expected facts; NULL = not graded. */
  @Column({ type: 'varchar', length: 8, nullable: true })
  verdict: string | null;

  @Column({ name: 'failed_checks', type: 'json', nullable: true })
  failedChecks: string[] | null;

  /** A question that failed does not abort the run; it is recorded and skipped. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
