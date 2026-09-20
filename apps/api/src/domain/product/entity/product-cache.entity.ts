import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { bigintTransformer, decimalTransformer } from '../../../global/util/transformers';

/** Catalog row lifecycle: 'archived' = no longer on the storefront (never hard-deleted by sync). */
export const PRODUCT_STATUS = {
  ACTIVE: 'active',
  ARCHIVED: 'archived',
} as const;
export type ProductStatus = (typeof PRODUCT_STATUS)[keyof typeof PRODUCT_STATUS];

/**
 * products_cache — customer-facing product catalog cache (PLN-260807-IvyusaApp-Revamp F1).
 *
 * Synced from the tenant storefront's public `/products.json` (no Admin API scope,
 * no Storefront API token). Display data only — the KB `doc_group='product'`
 * documents remain the recommendation/RAG source (linked by handle ↔ external_key).
 */
@Entity('products_cache')
@Unique('uk_product_tenant_handle', ['tenantId', 'handle'])
export class ProductCache {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  @Index('idx_prdc_tenant')
  tenantId: number | null;

  @Column({ type: 'varchar', length: 255 })
  handle: string;

  /**
   * The platform's own product id (Shopify numeric id from `/products.json`).
   * The import still keys on `handle`; this exists so an ORDER LINE — which
   * carries the id and nothing else — can find its product's picture
   * (PLN-260920 P4). Nullable: not every storefront reports one.
   */
  @Index('idx_prdc_tenant_ext')
  @Column({ name: 'external_id', type: 'varchar', length: 64, nullable: true })
  externalId: string | null;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  vendor: string | null;

  /**
   * Storefront variant SKU. A lookup aid for agents matching a chat to stock or
   * an order line — never an identity key: it repeats across products and is
   * blank on others (REQ-260804 §2-1), which is why the catalogue import keys
   * on `handle` instead.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  sku: string | null;

  /** Plain text (HTML stripped), capped ~2000 chars — a display summary, not KB content. */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'image_url', type: 'varchar', length: 1024, nullable: true })
  imageUrl: string | null;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, transformer: decimalTransformer })
  price: number | null;

  @Column({ type: 'varchar', length: 8, default: 'USD' })
  currency: string;

  @Column({ name: 'product_url', type: 'varchar', length: 1024, nullable: true })
  productUrl: string | null;

  /** From storefront `product_type`. */
  @Column({ type: 'varchar', length: 128, nullable: true })
  category: string | null;

  /** Comma-joined tag list (capped at 1024 chars). */
  @Column({ type: 'varchar', length: 1024, nullable: true })
  tags: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string; // active | archived

  @Column({ name: 'published_at', type: 'datetime', nullable: true })
  publishedAt: Date | null;

  /** Last time a sync run saw this product on the storefront. */
  @Column({ name: 'synced_at', type: 'datetime', nullable: true })
  syncedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
