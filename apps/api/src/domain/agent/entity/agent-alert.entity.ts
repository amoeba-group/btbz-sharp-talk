import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/**
 * agent_alerts — escalation alarms for the agent console (FR-S3,
 * PLAN-Scenario-Handoff-Alert). One row per escalation event; the console
 * polls status='new' rows for the alarm modal and acks them.
 */
@Entity('agent_alerts')
export class AgentAlert {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  @Index('idx_alert_tenant')
  tenantId: number | null;

  @Column({ name: 'conversation_id', type: 'bigint', transformer: bigintTransformer })
  @Index('idx_alert_conv')
  conversationId: number;

  @Column({ name: 'session_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  sessionId: number | null;

  @Column({ type: 'varchar', length: 32 })
  reason: string; // low_confidence/moderation_blocked/user_request

  @Column({ type: 'varchar', length: 300, nullable: true })
  preview: string | null;

  /**
   * Agent this alert is addressed to. NULL = broadcast (every agent sees it),
   * which is the behaviour when no assignees are configured (PLN-AiSetting W3).
   */
  @Column({ name: 'target_user_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  targetUserId: number | null;

  /**
   * Strict regional routing (PLN-261012 SG-67): on a broadcast row (no addressed
   * agent) the team (north | south) that may see it. NULL = a plain broadcast for
   * everyone in the tenant — the behaviour every row had before.
   */
  @Column({ name: 'target_region', type: 'varchar', length: 16, nullable: true })
  targetRegion: string | null;

  @Column({ type: 'varchar', length: 16, default: 'new' })
  @Index('idx_alert_status')
  status: string; // new/acked/superseded (replaced by a newer alert, or its conversation was settled)

  @Column({ name: 'acked_by', type: 'bigint', nullable: true, transformer: bigintTransformer })
  ackedBy: number | null;

  @Column({ name: 'acked_at', type: 'datetime', nullable: true })
  ackedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
