import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/** notifications — customer/session notifications (FR-030). */
// Unread-count/list per customer (PERF-6).
@Index('idx_notif_customer_read', ['customerId', 'readAt'])
// Reverse lookup "notifications about this record" (PLN-260817 S5).
@Index('idx_notif_ref', ['refType', 'refId'])
@Entity('notifications')
export class Notification {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  @Index('idx_notif_tenant')
  tenantId: number | null;

  @Column({ name: 'customer_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  @Index('idx_notif_customer')
  customerId: number | null;

  @Column({ name: 'session_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  sessionId: number | null;

  @Column({ type: 'varchar', length: 16 })
  @Index('idx_notif_category')
  category: string; // payment/shipping/event/review/all

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string | null;

  @Column({ name: 'status_badge', type: 'varchar', length: 24, nullable: true })
  statusBadge: string | null;

  /** Deep-link target (campaign product/url — PLN-260807 F4, A-9). Client routes on tap. */
  @Column({ name: 'link_url', type: 'varchar', length: 1024, nullable: true })
  linkUrl: string | null;

  /**
   * What this notification is *about*, as an in-app reference the client can act
   * on — currently only `'order_item'`, set by review requests so the widget can
   * open the review form for the right item (PLN-260817 S5). `linkUrl` is the
   * outbound counterpart (a URL to navigate to); this one names a record.
   * Rows written before this column exists carry NULL and stay inert.
   */
  @Column({ name: 'ref_type', type: 'varchar', length: 24, nullable: true })
  refType: string | null;

  @Column({ name: 'ref_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  refId: number | null;

  @Column({ type: 'varchar', length: 16, default: 'in_app' })
  channel: string;

  @Column({ name: 'read_at', type: 'datetime', nullable: true })
  readAt: Date | null;

  /** Shopper deleted it from the widget (PLN-260916 P3). Hidden from the feed and the unread count. */
  @Column({ name: 'deleted_at', type: 'datetime', nullable: true })
  deletedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
