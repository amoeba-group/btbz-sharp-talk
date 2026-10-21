import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/**
 * units — a tenant's teams (PLN-261019-Users-Unit-Labels-Routing-Conditions P1).
 *
 * One user belongs to at most one unit (`users.unit_id`). Unlike job labels the
 * code carries no permission: a unit is an organisational tag (CS, MKT, a region
 * team) the console shows and that later features may route on. Codes are fixed
 * once created; only the name is editable. Deleting a unit unassigns its
 * members in the same transaction and is refused while a routing rule names it
 * (PLN-261021-Users-Labels-Units-Delete).
 */
@Entity('units')
@Unique('uk_unit_tenant_code', ['tenantId', 'code'])
export class Unit {
  // BIGINT PK comes back as a STRING at runtime (bigint-PK-as-string trap) —
  // compare with String() on both sides, as JobLabel does.
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', nullable: false, transformer: bigintTransformer })
  tenantId: number;

  @Column({ type: 'varchar', length: 24 })
  code: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /**
   * Places this unit covers (PLN-261022 stage 1): canonical region codes and
   * province names. A routing rule set to "assign by region" pages the users
   * whose unit or labels cover the session's province (first) or region.
   * NULL = covers nothing in particular (still usable as an explicit group).
   */
  @Column({ type: 'json', nullable: true })
  regions: string[] | null;

  @Column({ type: 'json', nullable: true })
  provinces: string[] | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
