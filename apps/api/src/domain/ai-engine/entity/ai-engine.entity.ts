import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/** ai_engines — pluggable multi-engine catalog (FR-070). */
@Entity('ai_engines')
export class AiEngine {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  @Index('idx_aiengine_tenant')
  tenantId: number | null;

  @Column({ type: 'varchar', length: 24 })
  @Index('idx_aiengine_provider')
  provider: string; // anthropic/openai/google/azure/custom

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 64 })
  model: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  endpoint: string | null;

  @Column({ name: 'api_key_encrypted', type: 'varbinary', length: 2048, nullable: true })
  apiKeyEncrypted: Buffer | null;

  @Column({ type: 'varchar', length: 128, default: 'chat,rag,summary,assist,moderation' })
  capabilities: string;

  @Column({ type: 'varchar', length: 16, default: 'enabled' })
  status: string; // enabled/disabled

  @Column({ name: 'is_default', type: 'tinyint', width: 1, default: 0 })
  isDefault: number;

  /**
   * Platform engines only: may a tenant choose it (PLN-261007 D1)? Choosing one
   * bills the operator's key, so it is opt-in per engine.
   */
  @Column({ name: 'tenant_selectable', type: 'tinyint', width: 1, default: 0 })
  tenantSelectable: number;

  // ---- Last observed health (PLN-261007 S1) — written by the gateway and the
  // connection test, never by a form. Explicit `type` on every nullable column:
  // a union type alone makes TypeORM infer Object and the API fails to boot.
  @Column({ name: 'last_ok_at', type: 'datetime', nullable: true })
  lastOkAt: Date | null;

  @Column({ name: 'last_error_at', type: 'datetime', nullable: true })
  lastErrorAt: Date | null;

  @Column({ name: 'last_error_reason', type: 'varchar', length: 24, nullable: true })
  lastErrorReason: string | null;

  @Column({ name: 'last_error_detail', type: 'varchar', length: 255, nullable: true })
  lastErrorDetail: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
