import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/** Operator-entered profile fields (PLN-261023) — HA "hotel info" tab items. */
export interface CompanyProfile {
  groupName?: string | null;
  promotion?: boolean | null;
  hot?: boolean | null;
  isNew?: boolean | null;
  contractStart?: string | null; // YYYY-MM-DD
  contractEnd?: string | null;
  payment?: string | null;
  hotelType?: string | null;
  enterpriseName?: string | null;
  enterpriseRegNo?: string | null;
  extraFee?: boolean | null;
  descriptionEn?: string | null;
  descriptionVi?: string | null;
  policyEn?: string | null;
  policyVi?: string | null;
}

/** What the Go2Joy Partner API Hotel Info returns, normalised (PLN-261023). */
export interface CompanyPartnerInfo {
  name: string | null;
  firstHours: number | null;
  hourly: { enabled: boolean; start: number | null; end: number | null };
  overnight: { enabled: boolean; start: number | null; end: number | null };
  daily: { enabled: boolean; start: number | null; end: number | null };
  cancellation: {
    hourlyMinutes: number | null;
    overnightMinutes: number | null;
    dailyMinutes: number | null;
    afterBookingMinutes: number | null;
  } | null;
}

/**
 * companies — business customers (PLN-261022 stage 2). For Go2Joy a company is
 * a partner hotel: the B2B customer unit is the hotel, its staff are contacts.
 *
 * Rows are created only from a SIGNED identify that carries `hotel_id`
 * (external_key `hotel:{id}`); name / province / region are refreshed from the
 * signed attributes on every identify. Not personal data — no PII transformer.
 */
@Entity('companies')
@Index('uq_companies_tenant_key', ['tenantId', 'externalKey'], { unique: true })
@Index('idx_companies_tenant_region', ['tenantId', 'region'])
export class Company {
  // BIGINT PK hydrates as a STRING at runtime — compare with String()/Number() both sides.
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ name: 'external_key', type: 'varchar', length: 120 })
  externalKey: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  name: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  province: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  region: string | null;

  @Column({ name: 'last_seen_at', type: 'datetime', nullable: true })
  lastSeenAt: Date | null;

  // ---- Profile (PLN-261023) — operator-entered until the host sends it ----
  @Column({ type: 'varchar', length: 64, nullable: true })
  code: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true })
  district: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  address: string | null;

  /** Operator-entered rest of the profile — see CompanyProfile. */
  @Column({ type: 'json', nullable: true })
  profile: CompanyProfile | null;

  /** Read from the Go2Joy Partner API (hours, cancellation policy) — never edited. */
  @Column({ name: 'partner_info', type: 'json', nullable: true })
  partnerInfo: CompanyPartnerInfo | null;

  @Column({ name: 'partner_synced_at', type: 'datetime', nullable: true })
  partnerSyncedAt: Date | null;

  @Column({ name: 'partner_sync_error', type: 'varchar', length: 255, nullable: true })
  partnerSyncError: string | null;

  @Column({ name: 'profile_updated_at', type: 'datetime', nullable: true })
  profileUpdatedAt: Date | null;

  @Column({ name: 'profile_updated_by', type: 'bigint', nullable: true, transformer: bigintTransformer })
  profileUpdatedBy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
