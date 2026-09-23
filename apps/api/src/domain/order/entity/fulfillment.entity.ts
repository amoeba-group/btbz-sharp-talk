import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/** fulfillments — shipment/fulfillment status per order (FR-021). */
@Entity('fulfillments')
export class Fulfillment {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  @Index('idx_ful_tenant')
  tenantId: number | null;

  @Column({ name: 'order_id', type: 'bigint', nullable: false, transformer: bigintTransformer })
  @Index('idx_fulfill_order')
  orderId: number;

  @Column({ type: 'varchar', length: 24 })
  status: string; // preparing/shipped/in_transit/delivered

  @Column({ name: 'tracking_number', type: 'varchar', length: 64, nullable: true })
  trackingNumber: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  carrier: string | null;

  /**
   * The carrier's tracking page as the platform gave it (Shopify `tracking_url`,
   * PLN-260923 P2). Null → the API builds one from carrier + number when it can.
   */
  @Column({ name: 'tracking_url', type: 'varchar', length: 1024, nullable: true })
  trackingUrl: string | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
