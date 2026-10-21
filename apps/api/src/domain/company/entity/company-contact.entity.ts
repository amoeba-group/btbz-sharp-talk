import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/**
 * company_contacts — which contacts (customers of type b2b_contact) belong to
 * which company (PLN-261022 stage 2). Many-to-many: a chain operator is linked
 * to every hotel they signed in for. `role` = the signed role at last identify.
 */
@Entity('company_contacts')
@Index('uq_company_contacts', ['companyId', 'customerId'], { unique: true })
@Index('idx_company_contacts_customer', ['customerId'])
export class CompanyContact {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ name: 'company_id', type: 'bigint', transformer: bigintTransformer })
  companyId: number;

  @Column({ name: 'customer_id', type: 'bigint', transformer: bigintTransformer })
  customerId: number;

  @Column({ name: 'role', type: 'varchar', length: 120, nullable: true })
  role: string | null;

  @Column({ name: 'last_seen_at', type: 'datetime', nullable: true })
  lastSeenAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
