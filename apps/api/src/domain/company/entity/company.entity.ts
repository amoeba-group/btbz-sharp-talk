import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
