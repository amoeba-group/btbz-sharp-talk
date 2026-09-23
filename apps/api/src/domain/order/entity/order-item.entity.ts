import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { bigintTransformer, decimalTransformer } from '../../../global/util/transformers';

/** order_items — line items of a cached order (FR-020). */
@Entity('order_items')
export class OrderItem {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  @Index('idx_ordi_tenant')
  tenantId: number | null;

  @Column({ name: 'order_id', type: 'bigint', nullable: false, transformer: bigintTransformer })
  @Index('idx_items_order')
  orderId: number;

  @Column({ name: 'product_id', type: 'varchar', length: 64, nullable: true })
  productId: string | null;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  /**
   * Picture of the line as ordered (variant first, product featured image
   * second). Null when the payload carried none — the detail route then falls
   * back to the catalogue, and the widget to a placeholder.
   */
  @Column({ name: 'image_url', type: 'varchar', length: 1024, nullable: true })
  imageUrl: string | null;

  /**
   * The product's own storefront page (PLN-260923 P3) — where the widget's
   * "write a review" sends the shopper. From the order's GraphQL rich tier
   * (`onlineStoreUrl`, else `https://{shop}/products/{handle}`); null for lines
   * that arrived by webhook or a downgraded tier until the next sync fills it.
   */
  @Column({ name: 'product_url', type: 'varchar', length: 1024, nullable: true })
  productUrl: string | null;

  @Column({ name: 'option_text', type: 'varchar', length: 255, nullable: true })
  optionText: string | null;

  @Column({ type: 'int', default: 1 })
  qty: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true, transformer: decimalTransformer })
  price: number | null;
}
