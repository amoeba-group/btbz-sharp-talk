import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Smartphone, Trash2 } from 'lucide-react';
import { MOBILE_APP_DEFAULTS, MOBILE_SDK_VERSIONS, type MobileAppConfig } from '@sharptalk/types';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { FormRow, Input, Select } from '@/components/Field';
import { cn } from '@/lib/cn';
import { WIDGET_URL } from '@/lib/widget-url';
import { useAiAgents } from '../ai-settings/ai-agents.hooks';
import { useMobileApp, useSaveMobileApp, useWidgetAccess } from './settings.hooks';

/**
 * The host MOBILE APP surface (PLN-261015 S9 + S8): the app-only look, which
 * agent each app screen opens, the minimum SDK, and a live phone preview.
 *
 * Everything here is stored once and read by the widget when it opens inside the
 * app, so a change reaches the next screen the app opens — no app release.
 */

/** Two-way pill switch used for the small enumerations. */
function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-lg border border-gray-300">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'px-3 py-1.5 text-sm',
            value === o.value ? 'bg-primary-600 font-medium text-white' : 'bg-white text-gray-600 hover:bg-gray-50',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const PREVIEW_LANGS = ['vi', 'en', 'ko', 'ja', 'zh', 'es'] as const;

export function MobileAppSection() {
  const { t } = useTranslation('settings');
  const { data, isLoading } = useMobileApp();
  const agents = useAiAgents();
  const access = useWidgetAccess();
  const save = useSaveMobileApp();

  const [draft, setDraft] = useState<MobileAppConfig | null>(null);
  const current = draft ?? data?.config ?? MOBILE_APP_DEFAULTS;
  const dirty = draft !== null;
  const patch = (next: Partial<MobileAppConfig>) => setDraft({ ...current, ...next });
  const patchApp = (next: Partial<MobileAppConfig['app']>) => patch({ app: { ...current.app, ...next } });

  const agentList = agents.data ?? [];
  const defaultAgent = agentList.find((a) => a.isDefault)?.code ?? agentList[0]?.code ?? '';
  const shop = access.data?.shopDomain ?? '';

  // ── preview ────────────────────────────────────────────────────────────────
  const [surface, setSurface] = useState<'app' | 'web'>('app');
  const [previewAgent, setPreviewAgent] = useState('');
  const [lang, setLang] = useState<(typeof PREVIEW_LANGS)[number]>('vi');
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const agentCode = previewAgent || defaultAgent;

  const previewUrl = useMemo(() => {
    if (!shop) return null;
    const q = new URLSearchParams({ shop, embed: '1' });
    if (surface === 'app') {
      q.set('mode', 'app');
      q.set('appPreview', '1');
    }
    if (agentCode) q.set('agent', agentCode);
    return `${WIDGET_URL}/?${q.toString()}`;
  }, [shop, surface, agentCode]);

  // The unsaved draft goes into the phone as the admin edits; the widget only
  // honours it in a page opened as a preview.
  useEffect(() => {
    if (!loaded || surface !== 'app') return;
    frame.current?.contentWindow?.postMessage({ type: 'ivy:command', action: 'app-config', config: current }, '*');
  }, [loaded, surface, current]);
  useEffect(() => {
    if (!loaded) return;
    frame.current?.contentWindow?.postMessage({ type: 'ivy:command', action: 'locale', locale: lang }, '*');
  }, [loaded, lang]);
  useEffect(() => setLoaded(false), [previewUrl]);

  const entryAt = (i: number, next: Partial<MobileAppConfig['entries'][number]>) =>
    patch({ entries: current.entries.map((e, k) => (k === i ? { ...e, ...next } : e)) });
  const addEntry = () => {
    const used = new Set(current.entries.map((e) => e.screen));
    let n = current.entries.length + 1;
    while (used.has(`screen-${n}`)) n += 1;
    patch({ entries: [...current.entries, { screen: `screen-${n}`, agentCode: defaultAgent, contextLabel: null }] });
  };

  const simulatorUrl = `${WIDGET_URL}/webview-test.html?${new URLSearchParams({ ...(shop ? { shop } : {}), ...(defaultAgent ? { agent: defaultAgent } : {}) }).toString()}`;

  if (isLoading) return <p className="text-sm text-gray-400">…</p>;

  return (
    <section aria-labelledby="mobile-app-title" className="space-y-6">
      <div>
        <h2 id="mobile-app-title" className="flex items-center gap-2 text-base font-semibold text-gray-800">
          <Smartphone className="h-4 w-4 text-primary-500" aria-hidden="true" />
          {t('mobileApp.title')}
        </h2>
        <p className="mt-1 text-sm text-gray-500">{t('mobileApp.subtitle')}</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card title={t('mobileApp.appearance.title')}>
            <p className="mb-4 text-sm text-gray-500">{t('mobileApp.appearance.desc')}</p>
            <FormRow label={t('mobileApp.appearance.font')}>
              <Seg
                label={t('mobileApp.appearance.font')}
                value={current.app.font}
                onChange={(v) => patchApp({ font: v })}
                options={[
                  { value: 'system', label: t('mobileApp.appearance.fontSystem') },
                  { value: 'web', label: t('mobileApp.appearance.fontWeb') },
                ]}
              />
            </FormRow>
            <FormRow label={t('mobileApp.appearance.fontSize')}>
              <Select
                className="w-32"
                value={current.app.fontSize}
                onChange={(e) => patchApp({ fontSize: Number(e.target.value) })}
              >
                {[13, 14, 15, 16].map((n) => (
                  <option key={n} value={n}>
                    {n} px
                  </option>
                ))}
              </Select>
            </FormRow>
            <FormRow label={t('mobileApp.appearance.menuStyle')}>
              <Seg
                label={t('mobileApp.appearance.menuStyle')}
                value={current.app.menuStyle}
                onChange={(v) => patchApp({ menuStyle: v })}
                options={[
                  { value: 'card', label: t('mobileApp.appearance.menuCard') },
                  { value: 'chip', label: t('mobileApp.appearance.menuChip') },
                ]}
              />
            </FormRow>
            <FormRow label={t('mobileApp.appearance.header')}>
              <Seg
                label={t('mobileApp.appearance.header')}
                value={current.app.header}
                onChange={(v) => patchApp({ header: v })}
                options={[
                  { value: 'native', label: t('mobileApp.appearance.headerNative') },
                  { value: 'widget', label: t('mobileApp.appearance.headerWidget') },
                ]}
              />
              <p className="mt-1 text-xs text-gray-400">{t('mobileApp.appearance.headerHint')}</p>
            </FormRow>
            <FormRow label={t('mobileApp.appearance.brand')}>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={current.app.brand !== null}
                    onChange={(e) => patchApp({ brand: e.target.checked ? '#F26A1B' : null })}
                  />
                  {t('mobileApp.appearance.brandOwn')}
                </label>
                {current.app.brand !== null && (
                  <>
                    <input
                      type="color"
                      aria-label={t('mobileApp.appearance.brand')}
                      value={current.app.brand}
                      onChange={(e) => patchApp({ brand: e.target.value.toUpperCase() })}
                      className="h-8 w-10 cursor-pointer rounded border border-gray-300"
                    />
                    <span className="font-mono text-xs text-gray-500">{current.app.brand}</span>
                  </>
                )}
              </div>
              <p className="mt-1 text-xs text-gray-400">{t('mobileApp.appearance.brandHint')}</p>
            </FormRow>
          </Card>

          <Card title={t('mobileApp.entries.title')}>
            <p className="mb-4 text-sm text-gray-500">{t('mobileApp.entries.desc')}</p>
            {current.entries.length === 0 ? (
              <p className="mb-3 rounded-lg border border-dashed border-gray-300 p-4 text-center text-sm text-gray-400">
                {t('mobileApp.entries.empty')}
              </p>
            ) : (
              <div className="mb-3 space-y-2">
                {current.entries.map((e, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                    <Input
                      aria-label={t('mobileApp.entries.screen')}
                      value={e.screen}
                      onChange={(ev) => entryAt(i, { screen: ev.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                      placeholder="bookings"
                      className="font-mono"
                    />
                    <Select
                      aria-label={t('mobileApp.entries.agent')}
                      value={e.agentCode}
                      onChange={(ev) => entryAt(i, { agentCode: ev.target.value })}
                    >
                      {agentList.map((a) => (
                        <option key={a.code} value={a.code}>
                          {a.name}
                        </option>
                      ))}
                      {!agentList.some((a) => a.code === e.agentCode) && <option value={e.agentCode}>{e.agentCode}</option>}
                    </Select>
                    <Input
                      aria-label={t('mobileApp.entries.context')}
                      value={e.contextLabel ?? ''}
                      onChange={(ev) => entryAt(i, { contextLabel: ev.target.value || null })}
                      placeholder={t('mobileApp.entries.contextPlaceholder')}
                    />
                    <button
                      type="button"
                      onClick={() => patch({ entries: current.entries.filter((_, k) => k !== i) })}
                      aria-label={t('mobileApp.entries.remove')}
                      className="rounded p-2 text-gray-400 hover:bg-gray-100 hover:text-error"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <Button variant="secondary" size="sm" onClick={addEntry} disabled={current.entries.length >= 30}>
              <Plus className="mr-1 inline h-4 w-4" />
              {t('mobileApp.entries.add')}
            </Button>
          </Card>

          <Card title={t('mobileApp.sdk.title')}>
            <FormRow label={t('mobileApp.sdk.minSdk')}>
              <Select className="w-40" value={current.minSdk} onChange={(e) => patch({ minSdk: e.target.value })}>
                {MOBILE_SDK_VERSIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-gray-400">{t('mobileApp.sdk.hint')}</p>
            </FormRow>
            <div className="mt-2 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
              <span className="text-sm text-gray-600">{t('mobileApp.test.desc')}</span>
              <a href={simulatorUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-primary-600 hover:underline">
                {t('mobileApp.test.open')}
              </a>
            </div>
          </Card>

          <div className="flex items-center justify-end gap-3">
            {dirty && <span className="mr-auto text-sm text-gray-500">{t('mobileApp.unsaved')}</span>}
            <Button variant="secondary" disabled={!dirty || save.isPending} onClick={() => setDraft(null)}>
              {t('mobileApp.reset')}
            </Button>
            <Button
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate(current, { onSuccess: () => setDraft(null) })}
            >
              {t('mobileApp.save')}
            </Button>
          </div>
        </div>

        <Card title={t('mobileApp.preview.title')} className="h-fit xl:sticky xl:top-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Seg
              label={t('mobileApp.preview.title')}
              value={surface}
              onChange={setSurface}
              options={[
                { value: 'web', label: t('mobileApp.preview.web') },
                { value: 'app', label: t('mobileApp.preview.app') },
              ]}
            />
            <Select
              aria-label={t('mobileApp.preview.agent')}
              className="w-auto"
              value={agentCode}
              onChange={(e) => setPreviewAgent(e.target.value)}
            >
              {agentList.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label={t('mobileApp.preview.language')}
              className="w-auto"
              value={lang}
              onChange={(e) => setLang(e.target.value as (typeof PREVIEW_LANGS)[number])}
            >
              {PREVIEW_LANGS.map((l) => (
                <option key={l} value={l}>
                  {l.toUpperCase()}
                </option>
              ))}
            </Select>
          </div>
          {previewUrl ? (
            <div className="mx-auto w-[296px] rounded-[28px] bg-gray-900 p-2">
              <iframe
                ref={frame}
                key={previewUrl}
                title={t('mobileApp.preview.title')}
                src={previewUrl}
                onLoad={() => setLoaded(true)}
                className="h-[560px] w-full rounded-[20px] border-0 bg-white"
              />
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-gray-300 p-6 text-center text-sm text-gray-400">
              {t('mobileApp.preview.noShop')}
            </p>
          )}
          <p className="mt-3 text-xs text-gray-400">{t('mobileApp.preview.hint')}</p>
        </Card>
      </div>
    </section>
  );
}
