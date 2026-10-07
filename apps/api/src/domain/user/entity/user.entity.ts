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

  /**
   * Operational region (PLN-261007): north | south; NULL = nationwide. Rank is
   * the permission level, labels the role — this is only where they work.
   * Explicit `type`: a nullable union without it makes TypeORM infer Object
   * and the API fails to boot (dev-kit lesson A-1).
   */
  @Column({ type: 'varchar', length: 8, nullable: true })
  region: string | null;

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
