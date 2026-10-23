import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

export const MERGED_SESSION_STATE = {
  MEMBER: 'member',
  /** Taken out by an operator — auto-join never brings it back (D6). */
  EXCLUDED: 'excluded',
} as const;
export type MergedSessionState = (typeof MERGED_SESSION_STATE)[keyof typeof MERGED_SESSION_STATE];

/**
 * merged_room_sessions — a session's place in a merged room. Unique per session
 * (D5): the queue folds a room into one row, which needs every session to
 * belong to one room at most.
 */
@Entity('merged_room_sessions')
@Unique('uq_mrs_tenant_session', ['tenantId', 'sessionId'])
@Index('idx_mrs_room', ['roomId', 'state'])
export class MergedRoomSession {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ name: 'room_id', type: 'bigint', transformer: bigintTransformer })
  roomId: number;

  @Column({ name: 'session_id', type: 'bigint', transformer: bigintTransformer })
  sessionId: number;

  @Column({ type: 'varchar', length: 16, default: MERGED_SESSION_STATE.MEMBER })
  state: string;

  /** NULL = joined automatically. */
  @Column({ name: 'added_by', type: 'bigint', nullable: true, transformer: bigintTransformer })
  addedBy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
