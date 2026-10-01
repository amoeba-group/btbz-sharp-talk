import type { SessionLanguage } from '@sharptalk/types';
import { apiGet, apiPut, apiPost, apiDelete } from '@/lib/api-client';

export type AiFunction = 'chat' | 'rag' | 'summary' | 'assist' | 'moderation' | 'coach';

/** Why a function runs on the engine it runs on (mirrors ROUTING_SOURCE). */
export type RoutingSource =
  | 'explicit'
  | 'inherited'
  | 'tenant_default'
  | 'platform_default'
  | 'none';

export interface AiEngineOption {
  id: string;
  name: string;
  provider?: string;
  model?: string;
}

export interface AiFunctionSetting {
  function: AiFunction;
  /** The tenant's explicit choice; null means never configured. */
  engineId: string | null;
  params?: Record<string, unknown>;
  availableEngines: AiEngineOption[];
  /** What actually serves this function today, after inheritance/defaults. */
  effectiveEngineName: string | null;
  effectiveProvider: string | null;
  source: RoutingSource;
  inheritedFrom: string | null;
}

/** Mirrors ModerationMapper (apps/api moderation.mapper.ts). */
export interface ModerationRule {
  id: string;
  scope: string; // both / ai / agent
  type: string; // word / phrase / regex / context
  pattern: string; // pattern, or the classifier prompt for type=context
  severity?: string;
  action: string; // block / mask / rephrase / warn
  isActive?: number;
  createdAt?: string;
}

export interface CreateModerationRule {
  scope: string;
  type: string;
  pattern_or_prompt: string;
  action: string;
}

export interface ScenarioButton {
  id: string;
  /** A string is the same label in every language; a map is per-language. */
  label: string | Partial<Record<ScenarioLang, string>>;
  action: string;
  enabled: boolean;
  /** AI agents this button shows for (REQ-260825 R5); empty/absent = all agents. */
  agentIds?: number[];
  /** Question a "send a message" button asks; empty = use the label. */
  message?: string | Partial<Record<ScenarioLang, string>>;
}

/** Session language the console edits copy for — one source of truth with the API. */
export type ScenarioLang = SessionLanguage;

/**
 * A button's label in one language. Mirrors the API's resolver: English first,
 * then any language with text — a button whose own language is blank must
 * still show something rather than an empty pill.
 */
export function scenarioLabelText(
  label: ScenarioButton['label'] | undefined,
  lang: ScenarioLang,
): string {
  if (typeof label === 'string') return label;
  if (!label) return '';
  return label[lang]?.trim() || label.EN?.trim() || Object.values(label).find((v) => v?.trim()) || '';
}

/** Where the widget sends the shopper after a scripted reply (PLN-AiSetting W2). */
export interface ScenarioPostAction {
  type: 'none' | 'open_orders' | 'open_contact' | 'open_affiliate' | 'connect_agent' | 'open_url';
  url?: string;
}

/** Tenant edits to a built-in scenario script; blank fields keep the built-in copy. */
export interface ScenarioOverride {
  /** The line echoed as the shopper's own words (editable since PLN-260903). */
  utterance?: Partial<Record<ScenarioLang, string>>;
  reply?: Partial<Record<ScenarioLang, string>>;
  followUps?: Array<{ id: string; label: Partial<Record<ScenarioLang, string>> }>;
  postAction?: ScenarioPostAction;
}

/** Escalation routing (PLN-AiSetting W3). */
/**
 * What a matched deny rule says to the customer. Mirrors the API's DENY_MODE —
 * a value outside these two is normalised to SILENT before it reaches a select,
 * so a hand-edited config cannot show a blank control.
 */
export const DENY_MODE = {
  SILENT: 'silent',
  ANSWER_THEN_HANDOFF: 'answer_then_handoff',
} as const;
export type DenyMode = (typeof DENY_MODE)[keyof typeof DENY_MODE];

export interface HandoffConfig {
  assigneeUserIds?: number[];
  businessHours?: {
    timezone: string;
    days: number[];
    start: string;
    end: string;
    /** Windows inside the shift when nobody is on duty (lunch) — off-hours routing. */
    breaks?: Array<{ start: string; end: string }>;
  };
  offHours?: { email?: string; notice?: Partial<Record<ScenarioLang, string>> };
  /** Policy deny-list (P2): matched messages are force-handed to a human. */
  denyRules?: Array<{
    keywords: string[];
    type?: string;
    label?: string;
    /** Absent = SILENT, matching the API (REQ-260826). */
    mode?: DenyMode;
  }>;
  /** Issue-board SLA targets (백로그 B2); defaults 24h/4h. */
  sla?: { normalHours?: number; urgentHours?: number };
}

/**
 * The copy SharpTalk ships with, served by the API (never re-declared here — a
 * frontend copy drifts from the widget the day either changes, invisibly).
 */
export interface ScenarioScriptDefault {
  action: string;
  /** Straight from a menu button, or only as a follow-up chip inside a script. */
  via: 'button' | 'follow_up';
  buttonAction: string | null;
  utterance: Partial<Record<ScenarioLang, string>>;
  reply: Partial<Record<ScenarioLang, string>>;
  followUps: Array<{ id: string; label: Partial<Record<ScenarioLang, string>> }>;
}

export interface AiConfigDefaults {
  scenarioButtons: ScenarioButton[];
  persona: string;
  rules: string[];
  /** Button action → the script it runs; a button missing here runs no script. */
  scriptByButtonAction: Record<string, string>;
  scripts: ScenarioScriptDefault[];
  widgetCopy: {
    firstVisit: Record<string, string>;
    loginGreeting: Record<string, string>;
  };
}

export interface AiConfig {
  persona: string;
  rules: string[];
  scenarioButtons: ScenarioButton[];
  scenarioOverrides?: Record<string, ScenarioOverride>;
  handoffConfig?: HandoffConfig | null;
}

// Backend returns { settings: [{function, engineId, effective*, source, ...}], availableEngines: [...] }.
interface AiSettingsResponse {
  settings: {
    function: AiFunction;
    engineId: number | string | null;
    params?: Record<string, unknown>;
    effectiveEngineName?: string | null;
    effectiveProvider?: string | null;
    source?: RoutingSource;
    inheritedFrom?: string | null;
  }[];
  availableEngines: AiEngineOption[];
}

export const aiSettingsService = {
  // Adapt the {settings, availableEngines} payload to a flat per-function array,
  // normalizing engineId to a string so it matches AiEngineOption.id in the Select.
  list: async (): Promise<AiFunctionSetting[]> => {
    const d = await apiGet<AiSettingsResponse>('/ai-settings');
    return (d.settings ?? []).map((s) => ({
      function: s.function,
      engineId: s.engineId == null ? null : String(s.engineId),
      params: s.params,
      availableEngines: d.availableEngines ?? [],
      effectiveEngineName: s.effectiveEngineName ?? null,
      effectiveProvider: s.effectiveProvider ?? null,
      source: s.source ?? 'none',
      inheritedFrom: s.inheritedFrom ?? null,
    }));
  },
  // engine_id is numeric server-side (@IsInt) — send a number, not the
  // stringified id the option list carries.
  update: (fn: AiFunction, body: { engine_id: string; params?: Record<string, unknown> }) =>
    apiPut<AiFunctionSetting>(`/ai-settings/${fn}`, {
      engine_id: Number(body.engine_id),
      ...(body.params !== undefined ? { params: body.params } : {}),
    }),
  getConfig: () => apiGet<AiConfig>('/ai-config'),
  getDefaults: () => apiGet<AiConfigDefaults>('/ai-config/defaults'),
  updateConfig: (body: {
    persona?: string;
    rules?: string[];
    scenario_buttons?: ScenarioButton[];
    scenario_overrides?: Record<string, ScenarioOverride>;
    handoff_config?: HandoffConfig;
    /** Why this change was made — recorded on the config revision. */
    note?: string;
    /** Which AI agent a persona/rules write targets (PLN-260820); omitted = default. */
    ai_agent_id?: number;
  }) =>
    apiPut<AiConfig>('/ai-config', body),
  rules: () => apiGet<ModerationRule[]>('/moderation/rules'),
  createRule: (body: CreateModerationRule) => apiPost<ModerationRule>('/moderation/rules', body),
  deleteRule: (id: string) => apiDelete<{ ok: true }>(`/moderation/rules/${id}`),
};
