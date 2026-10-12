import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';

/** The operator-typed code lives in embed snippets — keep it URL/attribute safe. */
export const AI_AGENT_CODE_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * ai_agents — a tenant's AI counter staff (PLN-260820-Multi-AI-Agent-Personas).
 *
 * Each row is one persona the widget can answer with: landing-page guests,
 * internal admin staff, hotel partners, ad partners… A session is pinned to an
 * agent at creation (embed `data-agent`, messenger channel binding, preview
 * pick) and NULL means the tenant's default agent, so pages installed before
 * this feature keep today's behaviour.
 *
 * NOT the `agents` table — that one holds the human console agents
 * (conversations.agent_id points there).
 */
@Entity('ai_agents')
@Unique('uk_aiagent_code', ['tenantId', 'code'])
@Index('idx_aiagent_tenant', ['tenantId', 'isDefault'])
export class AiAgent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  /** Stable routing key used by embed snippets and channel bindings; locked after create. */
  @Column({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  /**
   * Shopper-facing name (REQ-260825 R4): overrides the tenant's widget
   * displayName for sessions pinned to this agent. NULL = tenant name.
   * `name` above stays the console label.
   */
  @Column({ name: 'display_name', type: 'varchar', length: 100, nullable: true })
  displayName: string | null;

  /** NULL falls back to DEFAULT_PERSONA — same semantics as tenant_ai_config. */
  @Column({ type: 'text', nullable: true })
  persona: string | null;

  /**
   * Per-agent first/welcome message (REQ-260825 R3): lang→text map like the
   * tenant's widget_copy.firstVisit. NULL/empty = tenant first-visit copy.
   */
  @Column({ type: 'json', nullable: true })
  greeting: Record<string, string> | null;

  @Column({ type: 'json', nullable: true })
  rules: string[] | null;

  /**
   * What this agent does for an unidentified visitor (PLN-261001 v1.1):
   * `open` = answer as always; `login_guidance` = only guest-visible categories,
   * everything else gets a sign-in prompt. Default keeps every existing agent
   * byte-identical. Explicit `type`: a union-typed column without one makes
   * TypeORM infer Object and the API fails to boot (dev-kit lesson A-1).
   */
  @Column({ name: 'guest_policy', type: 'varchar', length: 16, default: 'open' })
  guestPolicy: string; // open | login_guidance (GUEST_POLICY)

  /** Inactive agents stop matching by code; sessions already pinned fall back to default. */
  @Column({ type: 'tinyint', width: 1, default: 1 })
  active: number;

  /** Exactly one per tenant (enforced in service, transactionally). */
  @Column({ name: 'is_default', type: 'tinyint', width: 1, default: 0 })
  isDefault: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
