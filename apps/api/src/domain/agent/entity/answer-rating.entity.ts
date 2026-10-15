import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

export const ANSWER_RATING = {
  ACCURATE: 'accurate',
  PARTIAL: 'partial',
  INACCURATE: 'inaccurate',
} as const;
export type AnswerRatingValue = (typeof ANSWER_RATING)[keyof typeof ANSWER_RATING];

/** Why an answer was not (fully) right — the fix differs per reason. */
export const ANSWER_RATING_REASON = {
  WRONG_SOURCE: 'wrong_source',
  OUTDATED: 'outdated',
  OUT_OF_SCOPE: 'out_of_scope',
  WORDING: 'wording',
  OTHER: 'other',
} as const;

/**
 * answer_ratings — a person's verdict on one AI or agent answer
 * (PLN-261015 D7). One row per (message, rater): rating again replaces it.
 * An AI answer rated partial/inaccurate also raises a knowledge-gap proposal,
 * so the verdict turns into a fix rather than a number.
 */
@Entity('answer_ratings')
@Unique('uk_answer_rating', ['tenantId', 'messageId', 'ratedBy'])
@Index('idx_answer_rating_tenant_created', ['tenantId', 'createdAt'])
@Index('idx_answer_rating_conversation', ['conversationId'])
export class AnswerRating {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ name: 'conversation_id', type: 'bigint', transformer: bigintTransformer })
  conversationId: number;

  @Column({ name: 'message_id', type: 'bigint', transformer: bigintTransformer })
  messageId: number;

  /** ai | agent — whose answer was rated. */
  @Column({ name: 'sender_type', type: 'varchar', length: 8 })
  senderType: string;

  @Column({ type: 'varchar', length: 12 })
  rating: string;

  @Column({ type: 'varchar', length: 24, nullable: true })
  reason: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ name: 'rated_by', type: 'bigint', transformer: bigintTransformer })
  ratedBy: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
