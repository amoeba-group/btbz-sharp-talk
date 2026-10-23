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
// Account threads (PLN-261022 stage 2) — mirrors sql/261022-b2b-company-thread.sql.
@Index('idx_conv_tenant_company', ['tenantId', 'companyId', 'id'])
@Index('idx_conv_tenant_customer', ['tenantId', 'customerId', 'id'])
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
   * Survey answers (PLN-261019-Csat-Survey-Disclosure). All null in `rating`
   * mode and on rows rated before the survey existed. `csatResolved` feeds the
   * shared resolution definition: a customer who says "not resolved" is not
   * counted as resolved just because they answered.
   */
  @Column({ name: 'csat_resolved', type: 'tinyint', width: 1, nullable: true })
  csatResolved: number | null;

  @Column({ name: 'csat_reason', type: 'varchar', length: 32, nullable: true })
  csatReason: string | null;

  /** Free text for "other reason" — PII-masked before it is stored. */
  @Column({ name: 'csat_comment', type: 'varchar', length: 80, nullable: true })
  csatComment: string | null;

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

  /**
   * The account this thread belongs to (PLN-261022 stage 2): the session's
   * customer and, for a B2B contact, the company. Written at creation and when
   * a signed identify lands on an already-open thread. The account thread =
   * company (B2B) or customer (otherwise) across sessions.
   */
  @Column({ name: 'customer_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  customerId: number | null;

  @Column({ name: 'company_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  companyId: number | null;

  /** The account thread's previous conversation — its agent is preferred on handoff (sticky). */
  @Column({ name: 'prev_conversation_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  prevConversationId: number | null;

  /**
   * The consult category the shopper picked when asking for an agent
   * (PLN-261024-Widget-Handoff-Consult-Category-Picker). Routing rules'
   * category filter matches this only; NULL = not picked (skipped / none offered).
   */
  @Column({ name: 'consult_category', type: 'varchar', length: 64, nullable: true })
  consultCategory: string | null;

  @Column({ name: 'consult_category_at', type: 'datetime', precision: 6, nullable: true })
  consultCategoryAt: Date | null;
}
