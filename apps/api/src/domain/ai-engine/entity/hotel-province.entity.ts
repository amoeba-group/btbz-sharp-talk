import { Column, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/**
 * hotel_provinces — hotel → province, for hosts that sign a hotelSn but not the
 * hotel's province (PLN-261012 SG-67, REQ-261007 R3). Region routing reads it ONLY
 * keyed by the SIGNED hotelSn, and only when the signed claims carry no province of
 * their own; an unsigned hotel name or code never reaches this table.
 * The console replaces the whole table per tenant in one transaction.
 * Mirrors sql/261017-hotel-provinces.sql.
 */
@Entity('hotel_provinces')
@Unique('uk_hotel_province', ['tenantId', 'hotelSn'])
export class HotelProvince {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', nullable: false, transformer: bigintTransformer })
  tenantId: number;

  @Column({ name: 'hotel_sn', type: 'varchar', length: 64 })
  hotelSn: string;

  @Column({ type: 'varchar', length: 80 })
  province: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 })
  updatedAt: Date;
}
