import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/** conversations — chat threads within a session (FR-010). */
// Agent-console queue scans filter by status (PERF-6).
@Index('idx_conv_status', ['status'])
// Queue driving query: tenant + status IN(...) ORDER BY id DESC — this composite
// makes it an index range scan with no filesort (PLN-260804).
@Index('idx_conv_tenant_status_id', ['tenantId', 'status', 'id'])
// Queue pinning (PLN-260826) — mirrors sql/260826-conversation-pin.sql.
@Index('idx_conv_tenant_pinned', ['tenantId', 'pinnedAt'])
@Index('idx_conv_tenant_ended', ['tenantId', 'endedAt'])
@Entity('conversations')
export class Conversation {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  @Index('idx_conv_tenant')
  tenantId: number | null;

  @Column({ name: 'session_id', type: 'bigint', nullable: false, transformer: bigintTransformer })
  @Index('idx_conv_session')
  sessionId: number;

  @Column({ type: 'varchar', length: 32, default: 'widget' })
  channel: string;

  @Column({ type: 'varchar', length: 24, default: 'ai_active' })
  status: string; // ai_active/waiting/agent/ended

  @Column({ type: 'tinyint', width: 1, default: 0 })
  escalated: number;

  @Column({ name: 'agent_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  @Index('idx_conv_agent')
  agentId: number | null;

  /**
   * How the shopper expects to hear back. 'email' is set when the handoff
   * happened outside business hours — nobody is in the widget to read a reply,
   * so an agent's answer is mailed to them as well (PLN-260806). Cleared when
   * they write again from the widget.
   */
  @Column({ name: 'reply_channel', type: 'varchar', length: 16, nullable: true })
  replyChannel: string | null;

  /**
   * The team the customer picked when they asked for a human (PLN-261007
   * Team Routing): a `handoffConfig.teamRouting` option id such as `cs` or
   * `business`. Null when the tenant does not ask, or nobody has chosen yet.
   * The console badges and filters the queue on it.
   */
  @Column({ name: 'support_type', type: 'varchar', length: 32, nullable: true })
  supportType: string | null;

  /**
   * When the "anything else?" check was sent (PLN-260810 P1). Doubles as the
   * idempotency guard — a non-null value means the question already went out,
   * so a sweep that runs every 30 seconds cannot ask twice.
   */
  @Column({ name: 'idle_prompt_at', type: 'datetime', nullable: true })
  idlePromptAt: Date | null;

  /** Customer satisfaction, 1..5 stars. Null = never rated. */
  @Column({ name: 'csat_rating', type: 'tinyint', nullable: true })
  csatRating: number | null;

  @Column({ name: 'csat_rated_at', type: 'datetime', nullable: true })
  csatRatedAt: Date | null;

  /**
   * Team-shared queue pin (PLN-260826): non-null floats the row to the top of
   * the live-chat list, max 3 active pins per tenant (service-enforced).
   */
  @Column({ name: 'pinned_at', type: 'datetime', nullable: true })
  pinnedAt: Date | null;

  @Column({ name: 'pinned_by', type: 'bigint', nullable: true, transformer: bigintTransformer })
  pinnedBy: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'ended_at', type: 'datetime', nullable: true })
  endedAt: Date | null;
}
