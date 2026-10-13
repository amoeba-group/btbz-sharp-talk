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
   * The team (north | south, the `users.region` values) that looks after the
   * hotel's region, resolved from the signed province claim when the thread was
   * handed to a person (PLN-261007 Hotel Region Routing). Null when region
   * routing is off or the region could not be determined. The queue badges and
   * filters on it.
   */
  @Column({ name: 'support_region', type: 'varchar', length: 8, nullable: true })
  supportRegion: string | null;

  /**
   * The signed province the region table did NOT list (PLN-261012 SG-65): persisted
   * so the queue can show a "?" badge with the province in its tooltip and filter on
   * it. `supportRegion` stays null for such a row. Cleared with the rest of the
   * escalation state when the thread is handed back to the AI.
   */
  @Column({ name: 'support_region_hint', type: 'varchar', length: 64, nullable: true })
  supportRegionHint: string | null;

  /**
   * When the conversation became WAITING for a person (PLN-261012 SG-63/66). The
   * queue shows the age from it and the unclaimed-alert sweeper counts from it.
   * Re-stamped by a re-route, cleared by a hand-back to the AI. NULL = never
   * escalated, or waiting since before the column existed (the sweeper skips those).
   */
  @Column({ name: 'escalated_at', type: 'datetime', nullable: true })
  escalatedAt: Date | null;

  /**
   * "UNCLAIMED" re-pages sent for the current waiting spell and when the last one went
   * out (PLN-261012 SG-63): the de-dupe latch and the cap, kept on the row so a
   * restart or a second API instance cannot page twice.
   */
  @Column({ name: 'unclaimed_pages', type: 'tinyint', unsigned: true, default: 0 })
  unclaimedPages: number;

  @Column({ name: 'unclaimed_paged_at', type: 'datetime', nullable: true })
  unclaimedPagedAt: Date | null;

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
