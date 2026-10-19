import { Column, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/** integration_credentials — per-tenant provider secrets, AES-256-GCM (FR-060). */
@Entity('integration_credentials')
@Unique('uk_cred_tenant_provider', ['tenantId', 'provider'])
export class IntegrationCredential {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ type: 'varchar', length: 32 })
  provider: string; // shopify/fulfillment/klaviyo/odoo/google_drive

  @Column({ name: 'secret_enc', type: 'varbinary', length: 2048, nullable: true })
  secretEnc: Buffer | null;

  @Column({ type: 'varchar', length: 16, default: 'connected' })
  status: string;

  /** When the connection was last verified by a real test (null = never tested). */
  @Column({ name: 'last_tested_at', type: 'datetime', nullable: true })
  lastTestedAt: Date | null;

  /** Last test/sync outcome message for this tenant's credential (per-tenant). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  detail: string | null;

  /**
   * When this tenant's last successful order sync ran — the incremental cursor
   * (FIX-261019). Per tenant on purpose: the global integration_status row it
   * replaces was shared by every store, so one tenant's sync advanced another's.
   */
  @Column({ name: 'last_synced_at', type: 'datetime', nullable: true })
  lastSyncedAt: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
