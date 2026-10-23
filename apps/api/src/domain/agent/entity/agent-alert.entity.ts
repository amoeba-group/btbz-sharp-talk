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

  @Column({ type: 'varchar', length: 16, default: 'new' })
  @Index('idx_alert_status')
  status: string; // new/acked

  @Column({ name: 'acked_by', type: 'bigint', nullable: true, transformer: bigintTransformer })
  ackedBy: number | null;

  @Column({ name: 'acked_at', type: 'datetime', nullable: true })
  ackedAt: Date | null;

  /**
   * When the "still nobody has it" reminder went out (PLN-261015 D4). Set on
   * every row of the conversation at once so the sweep reminds exactly once.
   */
  @Column({ name: 'reminded_at', type: 'datetime', nullable: true })
  remindedAt: Date | null;

  /**
   * One escalation = one key (PLN-261024 alarm center): a group alarm writes a
   * row per paged agent, shown in the console as one alarm with its assignees.
   * NULL on rows written before the key existed — each stands alone.
   */
  @Column({ name: 'event_key', type: 'varchar', length: 36, nullable: true })
  @Index('idx_alert_event')
  eventKey: string | null;

  /** The routing rule that chose the agents; NULL = no rule matched. */
  @Column({ name: 'rule_name', type: 'varchar', length: 120, nullable: true })
  ruleName: string | null;

  /** The consult category the shopper picked (PLN-261024). */
  @Column({ name: 'consult_category', type: 'varchar', length: 64, nullable: true })
  consultCategory: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
