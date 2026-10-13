import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';
import type { GoldenPartnerCtx } from '../../partner-data/partner-golden.util';

/**
 * golden_questions — the questions a tenant re-asks to see what a config change
 * did (FR-073).
 *
 * They exist because a single reply proves nothing: the model words the same
 * answer differently every time, so "it changed" is not evidence that a rule
 * took effect (TCR-260813 §3 O-1).
 */
@Entity('golden_questions')
@Index('idx_golden_q_tenant', ['tenantId', 'active'])
export class GoldenQuestion {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ type: 'text' })
  question: string;

  /** EN/ES/KO — answers are language-specific, so a run must fix one. */
  @Column({ type: 'varchar', length: 8, default: 'KO' })
  language: string;

  /** Why this question is worth watching. Human-only; never sent to the model. */
  @Column({ type: 'varchar', length: 300, nullable: true })
  note: string | null;

  @Column({ type: 'tinyint', default: 1 })
  active: number;

  /** Facts the answer must contain; NULL = no verdict (PLN-261007 R7). */
  @Column({ type: 'json', nullable: true })
  expected: string[] | null;

  /** Text the answer must not contain, on top of the built-in masks. */
  @Column({ type: 'json', nullable: true })
  forbidden: string[] | null;

  /**
   * Hotel, role and mock fixture set this question runs under (PLN-261012 SG-31):
   * `{ hotelSn, role, mockSet }`. NULL = an ordinary knowledge question, asked
   * exactly as before. Set = the question is first run through the partner-data
   * step against that MOCK set, so partner-data answers can be graded too.
   */
  @Column({ name: 'partner_ctx', type: 'json', nullable: true })
  partnerCtx: GoldenPartnerCtx | null;

  @Column({ name: 'created_by', type: 'bigint', nullable: true, transformer: bigintTransformer })
  createdBy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
