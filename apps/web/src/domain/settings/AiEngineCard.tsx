import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Modal } from '@/components/Modal';
import { FormRow, Input, Select } from '@/components/Field';
import { EngineHealthBadge, isEngineFailing, shortTime } from '@/components/EngineHealthBadge';
import { ChevronDown, ChevronRight, Lock } from 'lucide-react';
import {
  useAiEngines,
  useAiStatus,
  useApplyAiEngine,
  useDeleteAiEngine,
  useSaveAiEngine,
  useSetAiEngineDefault,
  useTestAiEngine,
} from './settings.hooks';
import type { AiStatusFunction, TenantAiEngine } from './settings.service';

/** The functions a customer's conversation runs through — what "AI status" means to them. */
const CUSTOMER_FACING = ['chat', 'rag', 'moderation'];

/** Severity order for picking the one state the summary leads with. */
const SEVERITY = ['credit', 'auth', 'no_key', 'model', 'unreachable', 'stub', 'rate_limit', 'disabled', 'unknown', 'ok'];

/** Key prefixes the providers issue; a mismatch is warned about, never blocked (proxies differ). */
const KEY_PREFIX: Record<string, string> = { anthropic: 'sk-ant-', openai: 'sk-' };

/**
 * The tenant's AI engines (PLN-260824) + what is answering right now
 * (PLN-261007).
 *
 * The 2026-10-06 go2joy outage — credit exhausted, every customer reply
 * replaced by the stub's canned line for six hours — was visible nowhere on
 * this page. The summary at the top answers "is my AI working, and on what",
 * and the selector applies an engine (own, or a platform one the operator
 * opened) to every function in one step.
 */
export function AiEngineCard() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const engines = useAiEngines();
  const status = useAiStatus();
  const save = useSaveAiEngine();
  const setDefault = useSetAiEngineDefault();
  const test = useTestAiEngine();
  const remove = useDeleteAiEngine();
  const apply = useApplyAiEngine();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<TenantAiEngine | null>(null);
  const [name, setName] = useState('');
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [choice, setChoice] = useState('');

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? '');
    setProvider(editing?.provider ?? (engines.data?.providers[0] ?? 'anthropic'));
    setModel(editing?.model ?? '');
    setEndpoint(editing?.endpoint ?? '');
    setApiKey('');
  }, [open, editing, engines.data?.providers]);

  const all = useMemo(
    () => [...(engines.data?.own ?? []), ...(engines.data?.platform ?? [])],
    [engines.data],
  );
  const selectable = all.filter((e) => e.selectable);

  // The engine every customer-facing function runs on, when they agree.
  const functions = status.data?.functions ?? [];
  const facing = functions.filter((f) => CUSTOMER_FACING.includes(f.function));
  const healthOf = (f: AiStatusFunction) => f.engine?.health ?? 'stub';
  const worst = facing
    .map((f) => ({ f, h: healthOf(f) }))
    .sort((a, b) => SEVERITY.indexOf(a.h) - SEVERITY.indexOf(b.h))[0];
  const todayCalls = functions.reduce((n, f) => n + f.todayCalls, 0);
  const todayFailures = functions.reduce((n, f) => n + f.todayFailures, 0);
  const current = worst?.f.engine ?? null;
  const currentHealth = worst?.h ?? 'unknown';

  useEffect(() => {
    // Preselect what is running now, so "apply" is never a surprise.
    if (!choice && current && selectable.some((e) => e.id === current.id)) setChoice(current.id);
  }, [choice, current, selectable]);

  const switchToPlatform = () => {
    const p = selectable.find((e) => e.platform && e.health !== 'credit');
    if (p) setChoice(p.id);
    const el = document.getElementById('ai-engine-choice');
    el?.focus();
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const applyChoice = () => {
    const target = all.find((e) => e.id === choice);
    if (!target) return;
    if (!window.confirm(t('aiEngines.applyConfirm', { name: target.name }))) return;
    apply.mutate(choice);
  };

  const keyWarning =
    apiKey.trim() && KEY_PREFIX[provider] && !apiKey.trim().startsWith(KEY_PREFIX[provider])
      ? t('aiEngines.keyPrefixWarn', { prefix: KEY_PREFIX[provider] })
      : null;

  const row = (e: TenantAiEngine, platform: boolean) => (
    <li key={e.id} className="border-b border-gray-100 py-2 last:border-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="font-medium">
            {platform ? <Lock className="mr-1 inline h-3 w-3 text-gray-400" /> : null}
            {e.name}
          </span>
          <span className="ml-2 text-xs text-gray-500">
            {e.provider} / {e.model}
          </span>
        </span>
        <EngineHealthBadge health={e.health} />
        {e.isDefault && !platform ? <Badge tone="primary">{t('aiEngines.default')}</Badge> : null}
        {!platform ? (
          <>
            {!e.isDefault && e.status === 'enabled' ? (
              <Button size="sm" variant="secondary" onClick={() => setDefault.mutate(e.id)}>
                {t('aiEngines.makeDefault')}
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" disabled={test.isPending} onClick={() => test.mutate(e.id)}>
              {t('aiEngines.test')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditing(e);
                setOpen(true);
              }}
            >
              {tc('edit')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => remove.mutate(e.id)}>
              {tc('delete')}
            </Button>
          </>
        ) : e.selectable ? (
          <Button size="sm" variant="secondary" onClick={() => setChoice(e.id)}>
            {t('aiEngines.choose')}
          </Button>
        ) : e.provider !== 'stub' ? (
          <span className="text-xs text-gray-400">{t('aiEngines.needsOperator')}</span>
        ) : null}
      </div>
      {isEngineFailing(e.health) && e.lastErrorDetail ? (
        <p className="mt-1 break-all text-xs text-red-600">
          {shortTime(e.lastErrorAt)} · {e.lastErrorDetail}
        </p>
      ) : null}
    </li>
  );

  return (
    <Card
      title={t('aiEngines.title')}
      action={
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          {t('aiEngines.add')}
        </Button>
      }
    >
      {/* ---- What is answering right now (PLN-261007 S6) ---- */}
      <section
        className={`mb-4 rounded-lg border p-3 text-sm ${
          isEngineFailing(currentHealth) || currentHealth === 'stub'
            ? 'border-red-200 bg-red-50'
            : 'border-gray-200 bg-gray-50'
        }`}
        aria-live="polite"
      >
        <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">{t('aiEngines.status.title')}</h4>
        {status.isLoading ? (
          <p className="text-gray-500">{tc('loading')}</p>
        ) : (
          <>
            <p className="flex flex-wrap items-center gap-2 font-medium">
              <EngineHealthBadge health={currentHealth} />
              <span>{t(`aiEngines.status.headline.${currentHealth}`, { defaultValue: '' })}</span>
            </p>
            {current ? (
              <p className="mt-1 text-xs text-gray-600">
                {t('aiEngines.status.using', {
                  name: current.name,
                  owner: current.platform ? t('aiEngines.platformShort') : t('aiEngines.mineShort'),
                  model: `${current.provider} / ${current.model}`,
                })}
                {' · '}
                {t('aiEngines.status.lastOk', { at: shortTime(current.lastOkAt) })}
                {' · '}
                {t('aiEngines.status.lastError', { at: shortTime(current.lastErrorAt) })}
              </p>
            ) : null}
            <p className="mt-1 text-xs text-gray-600">
              {t('aiEngines.status.today', { calls: todayCalls, failures: todayFailures })}
            </p>
            {isEngineFailing(currentHealth) || currentHealth === 'stub' ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-red-700">
                <span>{t(`aiEngines.status.action.${currentHealth}`, { defaultValue: t('aiEngines.status.action.default') })}</span>
                {selectable.some((e) => e.platform) ? (
                  <Button size="sm" variant="secondary" onClick={switchToPlatform}>
                    {t('aiEngines.status.switchToPlatform')}
                  </Button>
                ) : null}
              </div>
            ) : null}

            <button
              type="button"
              className="mt-2 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
              onClick={() => setDetailsOpen((v) => !v)}
              aria-expanded={detailsOpen}
            >
              {detailsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {t('aiEngines.status.details')}
            </button>
            {detailsOpen ? (
              <ul className="mt-1 space-y-1 text-xs">
                {functions.map((f) => (
                  <li key={f.function} className="flex flex-wrap items-center gap-2">
                    <span className="w-32 text-gray-600">{t(`aiEngines.functions.${f.function}`, { defaultValue: f.function })}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {f.engine ? f.engine.name : t('aiEngines.status.noEngine')}
                      <span className="ml-1 text-gray-400">
                        {f.engine ? (f.engine.platform ? t('aiEngines.platformShort') : t('aiEngines.mineShort')) : ''}
                      </span>
                    </span>
                    <EngineHealthBadge health={healthOf(f)} />
                    <span className="text-gray-400">
                      {f.todayCalls}/{f.todayFailures}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </section>

      {/* ---- Apply one engine to every function (PLN-261007 S5/S6) ---- */}
      <div className="mb-4">
        <label className="mb-1 block text-xs font-semibold uppercase text-gray-500" htmlFor="ai-engine-choice">
          {t('aiEngines.useEngine')}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            id="ai-engine-choice"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            className="min-w-0 flex-1"
          >
            <option value="">{t('aiEngines.pickEngine')}</option>
            {all
              .filter((e) => e.provider !== 'stub')
              .map((e) => (
                <option key={e.id} value={e.id} disabled={!e.selectable}>
                  {e.name} · {e.platform ? t('aiEngines.platformShort') : t('aiEngines.mineShort')} ·{' '}
                  {t(`aiEngines.healthText.${e.health}`, { defaultValue: e.health })}
                  {!e.selectable ? ` (${t('aiEngines.needsOperator')})` : ''}
                </option>
              ))}
          </Select>
          <Button size="sm" disabled={!choice || apply.isPending} onClick={applyChoice}>
            {apply.isPending ? tc('loading') : t('aiEngines.applyAll')}
          </Button>
        </div>
        <p className="mt-1 text-xs text-gray-500">{t('aiEngines.platformBilling')}</p>
      </div>

      <p className="mb-3 text-xs text-gray-500">{t('aiEngines.hint')}</p>

      {engines.isLoading ? <p className="text-sm text-gray-500">{tc('loading')}</p> : null}
      {engines.error ? <p className="text-sm text-red-600">{(engines.error as Error).message}</p> : null}

      {engines.data?.own.length ? (
        <>
          <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">{t('aiEngines.mine')}</h4>
          <ul className="mb-4 text-sm">{engines.data.own.map((e) => row(e, false))}</ul>
        </>
      ) : (
        <p className="mb-4 text-sm text-gray-500">{t('aiEngines.empty')}</p>
      )}

      {engines.data?.platform.length ? (
        <>
          <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">{t('aiEngines.platform')}</h4>
          <ul className="text-sm">{engines.data.platform.map((e) => row(e, true))}</ul>
          <p className="mt-2 text-xs text-gray-500">{t('aiEngines.platformHint')}</p>
        </>
      ) : null}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? t('aiEngines.edit') : t('aiEngines.add')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button
              disabled={!name.trim() || !model.trim() || save.isPending}
              onClick={() =>
                save.mutate(
                  {
                    id: editing?.id,
                    name: name.trim(),
                    provider,
                    model: model.trim(),
                    endpoint: endpoint.trim() || undefined,
                    // Sent only when typed: an empty box means "keep the stored
                    // key", since the form can never show it.
                    ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
                  },
                  { onSuccess: () => setOpen(false) },
                )
              }
            >
              {save.isPending ? tc('loading') : tc('save')}
            </Button>
          </>
        }
      >
        {/* No <form>: a password manager pairs a form's text and password
            fields as login + password. On 2026-10-06 it saved the console
            login e-mail into "endpoint" and the password into "API key". */}
        <div className="space-y-3">
          <FormRow label={t('aiEngines.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} autoComplete="off" />
          </FormRow>
          <FormRow label={t('aiEngines.provider')}>
            <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
              {(engines.data?.providers ?? []).map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </FormRow>
          <FormRow label={t('aiEngines.model')}>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="claude-opus-4-8"
              maxLength={64}
              autoComplete="off"
            />
          </FormRow>
          <FormRow label={t('aiEngines.endpoint')}>
            <Input
              type="url"
              inputMode="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              maxLength={255}
              placeholder="https://"
              autoComplete="off"
              name="ai-engine-endpoint"
              data-1p-ignore
              data-lpignore="true"
            />
            <p className="mt-1 text-xs text-gray-500">{t('aiEngines.endpointHint')}</p>
          </FormRow>
          <FormRow label={t('aiEngines.apiKey')}>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={editing?.hasApiKey ? t('aiEngines.keyStored') : ''}
              maxLength={512}
              // `off` is ignored by Chrome on password fields; `new-password`
              // is what stops it offering the console login here.
              autoComplete="new-password"
              name="ai-engine-api-key"
              data-1p-ignore
              data-lpignore="true"
            />
            {keyWarning ? <p className="mt-1 text-xs text-amber-700">{keyWarning}</p> : null}
            <p className="mt-1 text-xs text-gray-500">{t('aiEngines.apiKeyHint')}</p>
          </FormRow>
          {/* Who pays is a consequence of this field, so it is stated next to it. */}
          <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">{t('aiEngines.billingNote')}</p>
        </div>
      </Modal>
    </Card>
  );
}
