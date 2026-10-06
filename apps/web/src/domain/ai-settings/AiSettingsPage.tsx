import { useEffect, useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Modal } from '@/components/Modal';
import { FormRow, Input, Select, Label } from '@/components/Field';
import { Table, type Column } from '@/components/Table';
import { cn } from '@/lib/cn';
import { AiStudioPanel } from './AiStudioPanel';
import { RegressionSection } from './RegressionSection';
import { ConfigHistorySection } from './ConfigHistorySection';
import { ChangeNoteRow } from './ChangeNoteRow';
import { AnswerReuseSection } from './AnswerReuseSection';
import { LanguageTabs } from './LanguageTabs';
import { LANGUAGES } from '../../../../../packages/types/src/common/language';
import { ScenarioReplyEditor } from './ScenarioReplyEditor';
import { Link } from 'react-router-dom';
import {
  useAiSettings,
  useUpdateAiSetting,
  useModerationRules,
  useCreateRule,
  useDeleteRule,
  useAiConfig,
  useAiConfigDefaults,
  useUpdateAiConfig,
} from './ai-settings.hooks';
import { AgentsSection } from './AgentsSection';
import { AgentEffectiveSection } from './AgentEffectiveSection';
import { ScriptLibrarySection } from './ScriptLibrarySection';
import { GuestGuidanceSection } from './GuestGuidanceSection';
import { useAiAgents } from './ai-agents.hooks';
import type { AiAgentRow } from './ai-agents.service';
import type {
  AiFunctionSetting,
  ModerationRule,
  ScenarioAudience,
  ScenarioButton,
  ScenarioLang,
  ScenarioOverride,
} from './ai-settings.service';
import { SCENARIO_AUDIENCES, scenarioLabelText } from './ai-settings.service';

const FUNCTION_KEYS = new Set(['chat', 'rag', 'summary', 'assist', 'moderation', 'coach']);

const SCENARIO_ACTIONS = [
  'delivery_status',
  'cancel_refund',
  'product_help',
  'contact_support',
  'affiliate',
  'my_orders',
  'message',
] as const;

export function AiSettingsPage() {
  const { t } = useTranslation('aiSetting');
  // A version loaded from history lands in the editors, not in production —
  // restoring must go through the same review-and-save a manual edit does.
  const [restoreDraft, setRestoreDraft] = useState<{ persona: string; rules: string[] } | null>(null);

  // Which AI agent the persona/rules editors and the studio speak for
  // (PLN-260820). null until the list loads, then the default agent.
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const { data: agents } = useAiAgents();
  const selectedAgent =
    agents?.find((a) => a.id === selectedAgentId) ?? agents?.find((a) => a.isDefault) ?? agents?.[0];
  useEffect(() => {
    if (selectedAgentId == null && selectedAgent) setSelectedAgentId(selectedAgent.id);
  }, [selectedAgentId, selectedAgent]);

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {/* Settings on the left, the studio (preview + coaching) pinned on the
          right (xl+). Below xl it drops under the settings so it stays
          reachable on tablets. */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          <AgentsSection selectedId={selectedAgent?.id ?? null} onSelect={setSelectedAgentId} />
          <AgentEffectiveSection agent={selectedAgent} />
          <PersonaSection draft={restoreDraft?.persona} agent={selectedAgent} />
          <ResponseRulesSection draft={restoreDraft?.rules} agent={selectedAgent} />
          <ScenarioButtonsSection />
          {/* What a signed-out visitor is told once an agent asks them to sign
              in (PLN-261001 W2/W8); the per-agent switch is in AgentsSection. */}
          <GuestGuidanceSection />
          <ScriptLibrarySection />
          <AiFunctionsSection />
          <ModerationSection />
          <RegressionSection />
          <ConfigHistorySection onRestore={setRestoreDraft} />
          <AnswerReuseSection />
          <HandoffMovedNotice />
        </div>
        <div className="xl:sticky xl:top-6 xl:self-start">
          <AiStudioPanel agent={selectedAgent ?? null} />
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* a. Bot persona                                                             */
/* -------------------------------------------------------------------------- */

function PersonaSection({ draft, agent }: { draft?: string; agent?: AiAgentRow }) {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const { data: config, isLoading, error } = useAiConfig();
  const updateConfig = useUpdateAiConfig();
  const [persona, setPersona] = useState('');

  // Seed from the selected agent. The default agent may hold NULL (= built-in
  // persona); /ai-config resolves that to the effective text, so the operator
  // edits what actually runs instead of an empty box.
  useEffect(() => {
    if (!agent) return;
    if (agent.isDefault) {
      if (config) setPersona(config.persona ?? '');
    } else {
      setPersona(agent.persona ?? '');
    }
  }, [config, agent]);

  const [note, setNote] = useState('');

  // A restored version fills the editor and waits — nothing is live until save.
  useEffect(() => {
    if (draft !== undefined) setPersona(draft);
  }, [draft]);

  const save = () =>
    updateConfig.mutate(
      { persona, note: note.trim() || undefined, ai_agent_id: agent?.id },
      { onSuccess: () => setNote('') },
    );

  return (
    <Card title={agent && !agent.isDefault ? `${t('persona')} — ${agent.name}` : t('persona')}>
      {isLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}
      {!isLoading && error && (
        <p className="text-sm text-error">{error instanceof Error ? error.message : tc('empty')}</p>
      )}
      {!isLoading && !error && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">{t('personaHint')}</p>
          <textarea
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            rows={5}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
          />
          <ChangeNoteRow
            value={note}
            onChange={setNote}
            onSave={save}
            saving={updateConfig.isPending}
          />
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* b. Response rules                                                          */
/* -------------------------------------------------------------------------- */

function ResponseRulesSection({ draft, agent }: { draft?: string[]; agent?: AiAgentRow }) {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const { data: config, isLoading, error } = useAiConfig();
  const updateConfig = useUpdateAiConfig();
  const [rules, setRules] = useState<string[]>([]);

  // Same seeding as PersonaSection: the default agent shows the effective
  // (resolved) rules, a per-entry-point agent shows exactly its own.
  useEffect(() => {
    if (!agent) return;
    if (agent.isDefault) {
      if (config) setRules(config.rules ?? []);
    } else {
      setRules(agent.rules ?? []);
    }
  }, [config, agent]);

  const [note, setNote] = useState('');

  // A restored version fills the editor and waits — nothing is live until save.
  useEffect(() => {
    if (draft !== undefined) setRules(draft);
  }, [draft]);

  const setRuleAt = (i: number, value: string) =>
    setRules((prev) => prev.map((r, idx) => (idx === i ? value : r)));
  const removeRuleAt = (i: number) => setRules((prev) => prev.filter((_, idx) => idx !== i));
  const addRule = () => setRules((prev) => [...prev, '']);

  const save = () =>
    updateConfig.mutate(
      {
        rules: rules.map((r) => r.trim()).filter((r) => r.length > 0),
        note: note.trim() || undefined,
        ai_agent_id: agent?.id,
      },
      { onSuccess: () => setNote('') },
    );

  return (
    <Card
      title={agent && !agent.isDefault ? `${t('responseRules')} — ${agent.name}` : t('responseRules')}
      action={
        <Button size="sm" variant="secondary" onClick={addRule} disabled={isLoading || !!error}>
          <Plus className="h-4 w-4" /> {t('addRule')}
        </Button>
      }
    >
      {isLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}
      {!isLoading && error && (
        <p className="text-sm text-error">{error instanceof Error ? error.message : tc('empty')}</p>
      )}
      {!isLoading && !error && (
        <div className="space-y-3">
          {rules.length === 0 && <p className="text-sm text-gray-400">{t('noRules')}</p>}
          {rules.map((rule, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={rule}
                onChange={(e) => setRuleAt(i, e.target.value)}
                placeholder={t('rulePlaceholder')}
              />
              <Button
                variant="ghost"
                size="sm"
                aria-label={t('remove')}
                onClick={() => removeRuleAt(i)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <ChangeNoteRow
            value={note}
            onChange={setNote}
            onSave={save}
            saving={updateConfig.isPending}
          />
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* c. Scenario buttons                                                        */
/* -------------------------------------------------------------------------- */

function ScenarioButtonsSection() {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const { data: config, isLoading, error } = useAiConfig();
  const { data: defaults } = useAiConfigDefaults();
  const updateConfig = useUpdateAiConfig();
  const { data: agents } = useAiAgents();
  const [buttons, setButtons] = useState<ScenarioButton[]>([]);
  const [overrides, setOverrides] = useState<Record<string, ScenarioOverride>>({});
  const [editing, setEditing] = useState<string | null>(null);
  // Which button's agent-scope modal is open (REQ-260825 R5); index into `buttons`.
  const [scopeFor, setScopeFor] = useState<number | null>(null);
  const [note, setNote] = useState('');
  // One tab bar for the whole label column: an operator translates a menu
  // language by language, not button by button.
  const [labelLang, setLabelLang] = useState<ScenarioLang>('KO');

  useEffect(() => {
    if (config) {
      setButtons(config.scenarioButtons ?? []);
      setOverrides(config.scenarioOverrides ?? {});
    }
  }, [config]);

  /** The script a button runs — the key its copy is stored under. */
  const scriptFor = (action: string): string | undefined =>
    defaults?.scriptByButtonAction[action];
  const scriptDefaults = (action: string) =>
    defaults?.scripts.find((s) => s.action === scriptFor(action));

  const patch = (i: number, partial: Partial<ScenarioButton>) =>
    setButtons((prev) => prev.map((b, idx) => (idx === i ? { ...b, ...partial } : b)));

  /**
   * Editing one language of a label that is still a plain string seeds every
   * language with that string first. Otherwise typing a Korean label would
   * silently blank the text the other five languages were showing.
   */
  const setLabel = (i: number, text: string) =>
    setButtons((prev) =>
      prev.map((b, idx) => {
        if (idx !== i) return b;
        const base =
          typeof b.label === 'string'
            ? Object.fromEntries(LANGUAGES.map((l) => [l.session, b.label as string]))
            : { ...(b.label ?? {}) };
        return { ...b, label: { ...base, [labelLang]: text } };
      }),
    );
  /**
   * The question, per language, with the same seeding rule as the label: typing
   * one language must not blank the five the button was already answering in.
   * An empty value is removed entirely so the button falls back to its label.
   */
  const setMessage = (i: number, text: string) =>
    setButtons((prev) =>
      prev.map((b, idx) => {
        if (idx !== i) return b;
        const base =
          typeof b.message === 'string'
            ? Object.fromEntries(LANGUAGES.map((l) => [l.session, b.message as string]))
            : { ...(b.message ?? {}) };
        const next = { ...base, [labelLang]: text };
        const anyFilled = Object.values(next).some((v) => (v ?? '').trim());
        return { ...b, message: anyFilled ? next : undefined };
      }),
    );
  const removeAt = (i: number) => setButtons((prev) => prev.filter((_, idx) => idx !== i));
  const move = (i: number, dir: -1 | 1) =>
    setButtons((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const add = () =>
    setButtons((prev) => [
      ...prev,
      {
        id: `btn_${Date.now()}_${prev.length}`,
        label: '',
        action: SCENARIO_ACTIONS[0],
        enabled: true,
      },
    ]);

  const save = () =>
    updateConfig.mutate(
      {
        scenario_buttons: buttons.filter((b) => scenarioLabelText(b.label, labelLang).trim().length > 0),
        scenario_overrides: overrides,
        note: note.trim() || undefined,
      },
      { onSuccess: () => setNote('') },
    );

  return (
    <Card
      title={`${t('scenarioButtons')} · ${t('agentScope.subtitle')}`}
      action={
        <Button size="sm" variant="secondary" onClick={add} disabled={isLoading || !!error}>
          <Plus className="h-4 w-4" /> {t('addButton')}
        </Button>
      }
    >
      {isLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}
      {!isLoading && error && (
        <p className="text-sm text-error">{error instanceof Error ? error.message : tc('empty')}</p>
      )}
      {!isLoading && !error && (
        <div className="space-y-3">
          <p className="text-xs text-gray-400">{t('scenarioHint')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-gray-500">{t('labelLanguage')}</span>
            <LanguageTabs value={labelLang} onChange={setLabelLang} />
            <span className="text-[11px] text-gray-400">{t('labelLanguageHint')}</span>
          </div>
          {buttons.length === 0 && <p className="text-sm text-gray-400">{t('noFunctions')}</p>}
          {buttons.map((btn, i) => (
            <div
              key={btn.id}
              className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-100 p-3"
            >
              <div className="min-w-[160px] flex-1">
                <Label>{t('label')}</Label>
                <Input
                  value={scenarioLabelText(btn.label, labelLang)}
                  aria-label={t('label')}
                  onChange={(e) => setLabel(i, e.target.value)}
                />
              </div>
              {/* Which script this button actually runs. The names differ
                  ("Delivery status" runs `shipping_policy`), and not knowing
                  that is what made edits to this button disappear. */}
              <p className="w-full -mt-1 text-[11px] text-gray-400">
                {scriptFor(btn.action)
                  ? t('scriptRuns', { script: scriptFor(btn.action) })
                  : t('scriptNone')}
              </p>
              <div className="min-w-[180px] flex-1">
                <Label>{t('action')}</Label>
                <Select value={btn.action} onChange={(e) => patch(i, { action: e.target.value })}>
                  {SCENARIO_ACTIONS.map((a) => (
                    <option key={a} value={a}>
                      {t(`action_${a}`)}
                    </option>
                  ))}
                </Select>
              </div>
              {/* Only a "send a message" button asks something; for scripted
                  actions the script owns the wording. */}
              {btn.action === 'message' && (
                <div className="w-full">
                  <Label>{t('buttonMessage')}</Label>
                  <Input
                    value={scenarioLabelText(btn.message, labelLang)}
                    aria-label={t('buttonMessage')}
                    placeholder={scenarioLabelText(btn.label, labelLang)}
                    onChange={(e) => setMessage(i, e.target.value)}
                  />
                  <p className="mt-0.5 text-[11px] text-gray-400">{t('buttonMessageHint')}</p>
                </div>
              )}
              {/* Who sees the chip (PLN-261001 W4): the API filters by the
                  session's identity, so a guest-only chip disappears the
                  moment the visitor signs in — and vice versa. */}
              <div className="min-w-[150px]">
                <Label>{t('audience')}</Label>
                <Select
                  value={btn.audience ?? 'all'}
                  aria-label={t('audience')}
                  onChange={(e) => patch(i, { audience: e.target.value as ScenarioAudience })}
                >
                  {SCENARIO_AUDIENCES.map((a) => (
                    <option key={a} value={a}>
                      {t(`audience_${a}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <label className="flex h-9 items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={btn.enabled}
                  onChange={(e) => patch(i, { enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                />
                {t('enabled')}
              </label>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(editing === btn.action ? null : btn.action)}
                >
                  {t('editReply')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('moveUp')}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('moveDown')}
                  disabled={i === buttons.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                {/* Agent scope, LEFT of delete (REQ-260825 R5): which agents show this button. */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setScopeFor(i)}
                  title={t('agentScope.title')}
                >
                  {t('agentScope.button')}
                  {(btn.agentIds?.length ?? 0) > 0 ? ` (${btn.agentIds!.length})` : ''}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t('remove')}
                  onClick={() => removeAt(i)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {editing === btn.action && (
                <div className="w-full">
                  <ScenarioReplyEditor
                    action={btn.action}
                    script={scriptDefaults(btn.action)}
                    scriptActions={defaults?.scripts.map((sc) => sc.action) ?? []}
                    value={overrides[scriptFor(btn.action) ?? btn.action] ?? {}}
                    onChange={(next) =>
                      setOverrides((prev) => ({
                        ...prev,
                        [scriptFor(btn.action) ?? btn.action]: next,
                      }))
                    }
                  />
                </div>
              )}
            </div>
          ))}
          {/* Agent-scope modal (REQ-260825 R5): visibility only — behaviour never differs. */}
          <Modal
            open={scopeFor != null}
            onClose={() => setScopeFor(null)}
            title={t('agentScope.title')}
            size="sm"
            footer={<Button size="sm" onClick={() => setScopeFor(null)}>{tc('confirm')}</Button>}
          >
            {scopeFor != null && buttons[scopeFor] && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500">
                  {t('agentScope.hint', {
                    label:
                      scenarioLabelText(buttons[scopeFor].label, labelLang) || t('label'),
                  })}
                </p>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    checked={(buttons[scopeFor].agentIds?.length ?? 0) === 0}
                    onChange={() => patch(scopeFor, { agentIds: [] })}
                  />
                  {t('agentScope.all')}
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="radio"
                    checked={(buttons[scopeFor].agentIds?.length ?? 0) > 0}
                    onChange={() => {
                      const first = (agents ?? [])[0];
                      if (first) patch(scopeFor, { agentIds: [first.id] });
                    }}
                  />
                  {t('agentScope.selected')}
                </label>
                <div className="ml-6 space-y-1">
                  {(agents ?? []).map((a) => {
                    const ids = buttons[scopeFor].agentIds ?? [];
                    const checked = ids.includes(a.id);
                    return (
                      <label key={a.id} className="flex items-center gap-2 text-sm text-gray-600">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            patch(scopeFor, {
                              agentIds: e.target.checked
                                ? [...ids, a.id]
                                : ids.filter((v) => v !== a.id),
                            })
                          }
                        />
                        {a.name}
                        {a.isDefault && (
                          <span className="text-xs text-gray-400">{t('agents.default')}</span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <p className="text-[11px] text-gray-400">{t('agentScope.saveHint')}</p>
              </div>
            )}
          </Modal>
          <ChangeNoteRow
            value={note}
            onChange={setNote}
            onSave={save}
            saving={updateConfig.isPending}
          />
        </div>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* d. AI functions (engine + params)                                          */
/* -------------------------------------------------------------------------- */

function AiFunctionsSection() {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const { data: settings, isLoading, error } = useAiSettings();
  const update = useUpdateAiSetting();

  return (
    <Card title={`${t('aiFunctions')} · ${t('agents.shared')}`}>
      {isLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}
      {!isLoading && error && (
        <p className="text-sm text-error">{error instanceof Error ? error.message : tc('empty')}</p>
      )}
      {!isLoading && !error && (!settings || settings.length === 0) && (
        <p className="text-sm text-gray-400">{t('noFunctions')}</p>
      )}
      <div className="divide-y divide-gray-100">
        {settings?.map((s) => (
          <FunctionRow
            key={s.function}
            setting={s}
            onSave={(engineId, params) =>
              update.mutate({ fn: s.function, engineId, params })
            }
            saving={update.isPending}
          />
        ))}
      </div>
    </Card>
  );
}

function asNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function FunctionRow({
  setting,
  onSave,
  saving,
}: {
  setting: AiFunctionSetting;
  onSave: (engineId: string, params: Record<string, unknown>) => void;
  saving: boolean;
}) {
  const { t } = useTranslation('aiSetting');
  const label = FUNCTION_KEYS.has(setting.function)
    ? t(`functions.${setting.function}`)
    : setting.function;

  const [engineId, setEngineId] = useState(setting.engineId ?? '');
  const [temperature, setTemperature] = useState(asNumber(setting.params?.temperature));
  const [maxTokens, setMaxTokens] = useState(asNumber(setting.params?.max_tokens));

  useEffect(() => {
    setEngineId(setting.engineId ?? '');
    setTemperature(asNumber(setting.params?.temperature));
    setMaxTokens(asNumber(setting.params?.max_tokens));
  }, [setting]);

  const save = () => {
    const params: Record<string, unknown> = {};
    if (temperature.trim() !== '') params.temperature = Number(temperature);
    if (maxTokens.trim() !== '') params.max_tokens = Number(maxTokens);
    onSave(engineId, params);
  };

  return (
    <div className="space-y-3 py-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-800">{label}</p>
          {/* An unset function still runs on something. Saying which, and why,
              is what keeps a silent stub fallback from looking like nothing. */}
          {setting.source !== 'explicit' ? (
            <p className="text-xs text-gray-500">
              <Badge tone={setting.effectiveProvider === 'stub' ? 'warning' : 'gray'}>
                {t(`routing_${setting.source}`)}
              </Badge>{' '}
              {t('effectiveEngine', { name: setting.effectiveEngineName ?? '—' })}
              {setting.inheritedFrom && FUNCTION_KEYS.has(setting.inheritedFrom)
                ? ` (${t(`functions.${setting.inheritedFrom}`)})`
                : ''}
            </p>
          ) : (
            <p className="text-xs text-gray-400">
              {t('enginesAvailable', { count: setting.availableEngines.length })}
            </p>
          )}
        </div>
        <div className="w-64">
          <Label>{t('selectEngine')}</Label>
          <Select value={engineId} disabled={saving} onChange={(e) => setEngineId(e.target.value)}>
            <option value="" disabled>
              {t('selectEngine')}
            </option>
            {setting.availableEngines.map((eng) => (
              <option key={eng.id} value={eng.id}>
                {eng.name}
                {eng.model ? ` (${eng.model})` : ''}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <Label>{t('temperature')}</Label>
          <Input
            type="number"
            step={0.1}
            min={0}
            max={1}
            value={temperature}
            disabled={saving}
            onChange={(e) => setTemperature(e.target.value)}
          />
        </div>
        <div className="w-40">
          <Label>{t('maxTokens')}</Label>
          <Input
            type="number"
            step={1}
            min={0}
            value={maxTokens}
            disabled={saving}
            onChange={(e) => setMaxTokens(e.target.value)}
          />
        </div>
        <Button size="sm" disabled={saving || !engineId} onClick={save} className={cn('ml-auto')}>
          {t('save')}
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* e. Moderation rules (unchanged behaviour)                                  */
/* -------------------------------------------------------------------------- */

const RULE_SCOPES = ['both', 'ai', 'agent'] as const;
const RULE_TYPES = ['word', 'phrase', 'regex', 'context'] as const;
/** warn is intentionally not offered: the pipeline treats it the same as block. */
const RULE_ACTIONS = ['block', 'mask', 'rephrase'] as const;

const ACTION_TONES: Record<string, 'error' | 'warning' | 'info' | 'gray'> = {
  block: 'error',
  warn: 'error', // legacy rows — behaves like block
  mask: 'info',
  rephrase: 'warning',
};

function ModerationSection() {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const { data: rules, isLoading, error } = useModerationRules();
  const createRule = useCreateRule();
  const deleteRule = useDeleteRule();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<string>('both');
  const [type, setType] = useState<string>('word');
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState<string>('block');

  const close = () => {
    setOpen(false);
    setScope('both');
    setType('word');
    setPattern('');
    setAction('block');
  };

  const submit = async () => {
    if (!pattern.trim()) return;
    await createRule.mutateAsync({ scope, type, pattern_or_prompt: pattern.trim(), action });
    close();
  };

  const columns: Column<ModerationRule>[] = [
    {
      key: 'pattern',
      header: t('pattern'),
      render: (r) => <span className="break-all font-mono text-xs">{r.pattern}</span>,
    },
    {
      key: 'type',
      header: t('ruleType'),
      render: (r) => <Badge tone="gray">{t(`type_${r.type}`, r.type)}</Badge>,
    },
    { key: 'scope', header: t('scope'), render: (r) => t(`scope_${r.scope}`, r.scope) },
    {
      key: 'action',
      header: t('action'),
      render: (r) => (
        <Badge tone={ACTION_TONES[r.action] ?? 'gray'}>{t(r.action, r.action)}</Badge>
      ),
    },
    {
      key: 'createdAt',
      header: t('created'),
      render: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      render: (r) => (
        <Button
          variant="danger"
          size="sm"
          disabled={deleteRule.isPending}
          onClick={() => {
            if (window.confirm(t('deleteRuleConfirm'))) deleteRule.mutate(r.id);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  return (
    <Card
      title={`${t('moderationRules')} · ${t('agents.shared')}`}
      action={
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> {t('addRule')}
        </Button>
      }
    >
      <Table
        columns={columns}
        data={rules}
        loading={isLoading}
        error={error instanceof Error ? error.message : null}
        emptyMessage={t('noRules')}
        rowKey={(r) => r.id}
      />

      <Modal
        open={open}
        onClose={close}
        title={t('addModerationRule')}
        footer={
          <>
            <Button variant="secondary" onClick={close}>
              {tc('cancel')}
            </Button>
            <Button onClick={submit} disabled={createRule.isPending || !pattern.trim()}>
              {t('addRule')}
            </Button>
          </>
        }
      >
        <FormRow label={t('ruleType')}>
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            {RULE_TYPES.map((v) => (
              <option key={v} value={v}>
                {t(`type_${v}`)}
              </option>
            ))}
          </Select>
        </FormRow>
        <FormRow label={type === 'context' ? t('contextPromptLabel') : t('patternLabel')}>
          <Input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={type === 'context' ? t('contextPromptPlaceholder') : 'e.g. \\bbadword\\b'}
          />
        </FormRow>
        <FormRow label={t('scope')}>
          <Select value={scope} onChange={(e) => setScope(e.target.value)}>
            {RULE_SCOPES.map((v) => (
              <option key={v} value={v}>
                {t(`scope_${v}`)}
              </option>
            ))}
          </Select>
        </FormRow>
        <FormRow label={t('action')}>
          <Select value={action} onChange={(e) => setAction(e.target.value)}>
            {RULE_ACTIONS.map((v) => (
              <option key={v} value={v}>
                {t(v)}
              </option>
            ))}
          </Select>
        </FormRow>
      </Modal>
    </Card>
  );
}

/**
 * Live-support routing (business hours, break, off-hours mailbox) moved to the
 * tenant Settings page — it is an operations setting, not AI tuning, and two
 * editors over one config object drift apart (PLN-260806 D1).
 */
function HandoffMovedNotice() {
  const { t } = useTranslation('aiSetting');
  return (
    <Card title={t('handoff.title')}>
      <p className="text-sm text-gray-500">
        {t('handoff.movedToSettings')}{' '}
        <Link to="/settings" className="text-primary-600 underline underline-offset-2">
          {t('handoff.openSettings')}
        </Link>
      </p>
    </Card>
  );
}
