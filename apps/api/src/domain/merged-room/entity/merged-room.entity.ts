import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/**
 * merged_rooms — one live-chat room over the same customer's sessions
 * (PLN-261023-LiveChat-Merge-Same-Customer-Sessions). Unlike a timeline/project
 * group it is identity-bound: one per customer (D5), and with `autoJoin` the
 * customer's later sessions join it on their next message (D4).
 *
 * A view only: conversations, messages, assignment and stats stay per
 * conversation; dissolving deletes this row and its memberships.
 */
@Entity('merged_rooms')
@Unique('uq_mroom_tenant_customer', ['tenantId', 'customerId'])
export class MergedRoom {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  /** The customer the room was merged for — the identity later sessions are matched against. */
  @Column({ name: 'customer_id', type: 'bigint', transformer: bigintTransformer })
  customerId: number;

  @Column({ name: 'auto_join', type: 'tinyint', width: 1, default: 1 })
  autoJoin: number;

  @Column({ name: 'created_by', type: 'bigint', transformer: bigintTransformer })
  createdBy: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
