import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/** users — tenant staff accounts (FR-052, FR-062). */
@Entity('users')
@Unique('uk_user_tenant_email', ['tenantId', 'email'])
export class User {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', nullable: false, transformer: bigintTransformer })
  @Index('idx_user_tenant')
  tenantId: number;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true })
  passwordHash: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string | null;

  @Column({ type: 'varchar', length: 16, default: 'staff' })
  rank: string; // master/director/manager/staff

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string; // invited/active/suspended

  /** Team the user belongs to (`units.id`), at most one; NULL = unassigned (PLN-261019 P1). */
  @Column({ name: 'unit_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  unitId: number | null;

  @Column({ name: 'must_change_password', type: 'tinyint', width: 1, default: 1 })
  mustChangePassword: number;

  /** Refresh tokens issued before this instant are rejected (SEC-M1 session revocation). */
  @Column({ name: 'password_changed_at', type: 'datetime', nullable: true })
  passwordChangedAt: Date | null;

  @Column({ name: 'invited_at', type: 'datetime', nullable: true })
  invitedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
