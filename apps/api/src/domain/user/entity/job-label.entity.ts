import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/** job_labels — editable per-tenant job labels (FR-055). */
@Entity('job_labels')
@Unique('uk_label_tenant_code', ['tenantId', 'code'])
export class JobLabel {
  // NOTE: TypeORM returns this BIGINT PK as a STRING at runtime (despite the number
  // type) — @PrimaryGeneratedColumn takes no transformer. Any code joining this id to
  // UserJobLabel.jobLabelId (which IS transformed to a number) must String()-normalize
  // both sides, or the join silently misses (bigint-PK-as-string trap; see
  // loadLabelCodes). Left as-is to match every other bigint PK in the schema.
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', nullable: false, transformer: bigintTransformer })
  tenantId: number;

  @Column({ type: 'varchar', length: 24 })
  code: string; // consult/accounting/operations

  @Column({ type: 'varchar', length: 64 })
  name: string;

  /**
   * Places this label covers (PLN-261022 stage 1): canonical region codes and
   * province names. A routing rule set to "assign by region" pages the users
   * whose unit or labels cover the session's province (first) or region.
   * NULL = covers nothing in particular (still usable as an explicit group).
   */
  @Column({ type: 'json', nullable: true })
  regions: string[] | null;

  @Column({ type: 'json', nullable: true })
  provinces: string[] | null;
}
