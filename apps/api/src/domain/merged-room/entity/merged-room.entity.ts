import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/**
 * merged_rooms — one live-chat room over the same customer's sessions
 * (PLN-261023-LiveChat-Merge-Same-Customer-Sessions). Unlike a timeline/project
 * group it is identity-bound: one per customer and per company (D5, F3), and with `autoJoin` the
 * customer's later sessions join it on their next message (D4).
 *
 * A view only: conversations, messages, assignment and stats stay per
 * conversation; dissolving deletes this row and its memberships.
 */
@Entity('merged_rooms')
@Unique('uq_mroom_tenant_customer', ['tenantId', 'customerId'])
@Unique('uq_mroom_tenant_company', ['tenantId', 'companyId'])
export class MergedRoom {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  /** The customer the room was merged for — the identity later sessions are matched against. */
  @Column({ name: 'customer_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  customerId: number | null;

  /**
   * The B2B company (hotel) it was merged for — for a business the company IS
   * the customer, so its other staff's sessions match too (PLN-261023 F1-F3).
   */
  @Column({ name: 'company_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  companyId: number | null;

  @Column({ name: 'auto_join', type: 'tinyint', width: 1, default: 1 })
  autoJoin: number;

  @Column({ name: 'created_by', type: 'bigint', transformer: bigintTransformer })
  createdBy: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
