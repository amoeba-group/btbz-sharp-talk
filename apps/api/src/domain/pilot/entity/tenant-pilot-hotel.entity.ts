import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/**
 * tenant_pilot_hotels — the hotels a tenant's agent is open to while its pilot
 * allowlist is on (PLN-261012 SG-40). Matched against the SIGNED hotelSn of a
 * session, exactly, so the column is binary-collated: the unique key must agree
 * with the application about whether "HN1" and "hn1" are the same hotel.
 */
@Entity('tenant_pilot_hotels')
@Unique('uk_pilot_hotel', ['tenantId', 'hotelSn'])
export class TenantPilotHotel {
  // NOTE: a BIGINT PK hydrates as a STRING (see JobLabel); callers that compare
  // ids must String()-normalise both sides.
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ name: 'hotel_sn', type: 'varchar', length: 64, collation: 'utf8mb4_bin' })
  hotelSn: string;

  /** Operator's own label ("batch 1"); never read by enforcement. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  /** 0 = paused: kept in the list with its note, but not served. */
  @Column({ type: 'tinyint', width: 1, default: 1 })
  active: number;

  /** Console user who added it; null when added by a system path. */
  @Column({ name: 'added_by', type: 'bigint', nullable: true, transformer: bigintTransformer })
  addedBy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
