import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/**
 * partner_lookup_logs — one row per partner-data lookup (PLN-261012 SG-31).
 * Mirrors sql/261016-partner-lookup-logs.sql. Every nullable column carries an
 * explicit `type` (dev-kit lesson A-1: a union TS type makes TypeORM infer
 * `Object` and the API fails to boot, which `tsc` cannot catch).
 */
@Entity('partner_lookup_logs')
@Index('idx_pll_tenant_created', ['tenantId', 'createdAt'])
@Index('idx_pll_tenant_hotel', ['tenantId', 'hotelSn', 'createdAt'])
@Index('idx_pll_conversation', ['conversationId'])
export class PartnerLookupLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ name: 'conversation_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  conversationId: number | null;

  /** The customer turn that triggered the lookup. */
  @Column({ name: 'message_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  messageId: number | null;

  @Column({ name: 'session_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  sessionId: number | null;

  /** From the verified claims — never from the message. */
  @Column({ name: 'hotel_sn', type: 'varchar', length: 32, nullable: true })
  hotelSn: string | null;

  @Column({ name: 'actor_role', type: 'varchar', length: 16, nullable: true })
  actorRole: string | null;

  @Column({ type: 'varchar', length: 24 })
  topic: string;

  /** Scrubbed parameters; for a rejected lookup only `{ rejectedKeys }`. */
  @Column({ type: 'json', nullable: true })
  params: Record<string, unknown> | null;

  /** ok | denied | rejected | error | unverified */
  @Column({ type: 'varchar', length: 16 })
  status: string;

  /** E5100..E5108 */
  @Column({ name: 'error_code', type: 'varchar', length: 8, nullable: true })
  errorCode: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  reason: string | null;

  /** mock | live */
  @Column({ type: 'varchar', length: 8, nullable: true })
  source: string | null;

  @Column({ name: 'latency_ms', type: 'int', nullable: true })
  latencyMs: number | null;

  /** SHA-256 of the validated, projected snapshot the answer was built from. */
  @Column({ name: 'snapshot_hash', type: 'varchar', length: 64, nullable: true })
  snapshotHash: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
