import type { AnswerFooter } from '../answer-footer.util';
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import type { LocalizedText } from '@sharptalk/types';
import { bigintTransformer } from '../../../global/util/transformers';

/** Scenario button shown in the widget menu (FR-003 / FN-009). */
export interface ScenarioButton {
  id: string;
  /**
   * A plain string is the label in every language — the shape every button had
   * before PLN-260903 S3, kept so nothing needs a migration. A per-language map
   * is what the console writes now: a tenant serving six languages used to see
   * whichever one the operator happened to type, on all of them.
   */
  label: string | LocalizedText;
  action: string; // delivery_status|cancel_refund|product_help|contact_support|affiliate|my_orders|message
  enabled: boolean;
  /**
   * What a "send a message" button asks on the shopper's behalf. Empty/absent =
   * the label is the question, which is how every such button behaved before
   * this field existed (PLN-261001 §1-3) — so nothing needs migrating.
   *
   * Same shape as `label`: a plain string, or a per-language map.
   */
  message?: string | LocalizedText;
  /**
   * AI agents this button shows for (REQ-260825 R5). Empty/absent = every
   * agent (the pre-R5 behaviour). Visibility only — the button's behaviour
   * never differs per agent.
   */
  agentIds?: number[];
}

/** Where the widget should take the shopper after a scripted reply (FR-003). */
export interface ScenarioPostAction {
  type: 'none' | 'open_orders' | 'open_contact' | 'open_affiliate' | 'connect_agent' | 'open_url';
  /** Only for type='open_url'. */
  url?: string;
}

/**
 * Per-tenant edits to a built-in scenario script, keyed by action. Any field
 * may be omitted — the built-in script supplies the rest (see ScenarioService).
 * Text is per language (the registry's six); a missing language falls back to EN.
 */
/**
 * Handoff routing (PLN-AiSetting W3). All fields optional — an empty config
 * keeps the historical behaviour: alert every agent, any time of day.
 */
export interface HandoffConfig {
  /** Agents to page. Empty/omitted = broadcast to all (first to accept wins). */
  assigneeUserIds?: number[];
  /** When agents are on duty. Omitted = always route to agents. */
  businessHours?: {
    timezone: string; // IANA, e.g. America/New_York
    days: number[]; // 0=Sun … 6=Sat
    start: string; // 'HH:mm'
    end: string; // 'HH:mm'
    /**
     * Windows inside the shift when nobody is at the console (lunch, standup).
     * Treated exactly like off hours, so the shopper is told about the email
     * reply instead of waiting for someone who is away.
     */
    breaks?: Array<{ start: string; end: string }>;
  };
  /**
   * Wording shown when an agent hands the thread back to the AI (PLN-260810 S1).
   * Blank falls back to the built-in text. The customer should learn that the
   * person stepped out — a silent switch back reads as the agent ignoring them.
   */
  handbackNotice?: LocalizedText;
  /** Where to send the conversation outside business hours. */
  offHours?: {
    email?: string;
    /** Customer-facing notice; blank falls back to the built-in wording. */
    notice?: LocalizedText;
  };
  /**
   * Policy deny-list (PLN-260808-Issue-Workflow-P2, REQ §5.3): a customer
   * message matching any keyword is force-handed to an agent regardless of AI
   * confidence — the LLM is not even asked. Optional type/label stamp the
   * promoted issue (결정 4).
   */
  denyRules?: Array<{
    keywords: string[];
    /** IssueType to stamp (order_status|delivery|cancel|refund|partnership|other). */
    type?: string;
    /** JobLabel to route/stamp (consult|accounting|operations). */
    label?: string;
    /**
     * What the customer hears while the agent is being paged (REQ-260826).
     *
     * The rule always reaches a human either way — this decides only whether
     * they are told anything meanwhile. Absent means SILENT, so a tenant that
     * set up a deny-list before this existed keeps exactly the behaviour it
     * chose.
     */
    mode?: DenyMode;
  }>;
  /** SLA targets for the issue board (백로그 B2, 결정 5); defaults 24h/4h. */
  sla?: { normalHours?: number; urgentHours?: number };
}

/**
 * What a matched deny rule says to the customer (REQ-260826).
 *
 * The deny-list conflated two things: "a human must handle this" and "say
 * nothing meanwhile". Only the first is its purpose — on staging a shopper
 * waited two minutes for an agent to retype an answer six knowledge documents
 * already held, two of them promoted from that very conversation.
 *
 * Some topics genuinely want silence (legal threats, chargebacks), so the
 * choice is per rule and the silent default is preserved.
 */
export const DENY_MODE = {
  /** Hand off with no answer — the behaviour every existing rule has. */
  SILENT: 'silent',
  /** Answer from the knowledge base first, then hand off exactly as before. */
  ANSWER_THEN_HANDOFF: 'answer_then_handoff',
} as const;
export type DenyMode = (typeof DENY_MODE)[keyof typeof DENY_MODE];

export interface ScenarioOverride {
  /**
   * The line echoed into the thread as the shopper's own words. Editable since
   * PLN-260903: on a non-retail tenant the shipped phrasing ("How long does
   * shipping take?") is put in the customer's mouth, and only the tenant can
   * say what their customer would actually ask.
   */
  utterance?: LocalizedText;
  reply?: LocalizedText;
  followUps?: Array<{ id: string; label: LocalizedText }>;
  postAction?: ScenarioPostAction;
}

/**
 * tenant_ai_config — per-tenant AI behavior (FR-047 / FN-040): bot persona,
 * response rules (injected into the RAG system prompt), and the editable
 * scenario-button set rendered by the widget. One row per tenant.
 */
@Entity('tenant_ai_config')
@Unique('uk_aiconfig_tenant', ['tenantId'])
export class TenantAiConfig {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', transformer: bigintTransformer })
  tenantId: number;

  @Column({ type: 'text', nullable: true })
  persona: string | null;

  @Column({ type: 'json', nullable: true })
  rules: string[] | null;

  @Column({ name: 'scenario_buttons', type: 'json', nullable: true })
  scenarioButtons: ScenarioButton[] | null;

  /** Per-action edits to the built-in scripts, keyed by scenario action. */
  @Column({ name: 'scenario_overrides', type: 'json', nullable: true })
  scenarioOverrides: Record<string, ScenarioOverride> | null;

  /** Who gets paged on escalation, when, and what happens after hours. */
  @Column({ name: 'handoff_config', type: 'json', nullable: true })
  handoffConfig: HandoffConfig | null;

  /** Contact footer + masking-exempt values (PLN-261007-Go2Joy-FAQ-Accuracy R2/R4). */
  @Column({ name: 'answer_footer', type: 'json', nullable: true })
  answerFooter: AnswerFooter | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
