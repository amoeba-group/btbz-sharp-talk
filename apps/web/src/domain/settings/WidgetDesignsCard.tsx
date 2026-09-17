import { useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Modal } from '@/components/Modal';
import { FormRow, Input, Select } from '@/components/Field';
import { apiBaseUrl, saveBlob } from '@/lib/api-client';
import { toast } from '@/store/toast-store';
import {
  DESIGN_LIMITS,
  FONT_PRESET,
  FONT_STACKS,
  RADIUS_PX,
  radiusVars,
} from '../../../../../packages/types/src/common/widget-theme';
import type { WidgetRadius } from '../../../../../packages/types/src/common/widget-theme';
import { useTenantAssets, useWidgetDesignAction, useWidgetDesigns, useWidgetTheme } from './settings.hooks';
import { settingsService } from './settings.service';
import type { WidgetDesignDraft, WidgetDesignItem, WidgetDesignRevision } from './settings.service';

const WIDGET_URL = (
  (import.meta.env.VITE_WIDGET_URL as string | undefined) || 'https://shoptalk.amoeba.site/widget'
).replace(/\/+$/, '');

const EMPTY: WidgetDesignDraft = {
  fontPreset: FONT_PRESET.PRETENDARD,
  fontAssetUuid: null,
  baseSize: DESIGN_LIMITS.baseSize.default,
  radius: 'md',
  panelWidth: DESIGN_LIMITS.panel.width.default,
  panelHeight: DESIGN_LIMITS.panel.height.default,
  launcherIconUuid: null,
  quickReplyStyle: 'chip',
  customCss: '',
};

function toDraft(d: WidgetDesignItem['design']): WidgetDesignDraft {
  return {
    fontPreset: d.font?.preset ?? EMPTY.fontPreset,
    fontAssetUuid: d.font?.asset?.uuid ?? null,
    baseSize: d.font?.baseSize ?? EMPTY.baseSize,
    radius: d.radius ?? EMPTY.radius,
    panelWidth: d.panel?.width ?? EMPTY.panelWidth,
    panelHeight: d.panel?.height ?? EMPTY.panelHeight,
    launcherIconUuid: d.launcherIcon?.uuid ?? null,
    quickReplyStyle: d.quickReplyStyle === 'card' ? 'card' : 'chip',
    customCss: d.customCss ?? '',
  };
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Custom widget library (PLN-260910 P3 D-12′): named designs kept per tenant,
 * one of which may be "in use". No custom in use = the basic widget from the
 * theme card. The editor previews statically; the real-widget preview opens
 * the deployed widget with a signed token so nothing shoppers see changes.
 */
export function WidgetDesignsCard() {
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('common');
  const designs = useWidgetDesigns();
  const theme = useWidgetTheme();
  const act = useWidgetDesignAction();
  const fontAssets = useTenantAssets('font');
  const iconAssets = useTenantAssets('icon');

  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<{ id: string | null; name: string; note: string; draft: WidgetDesignDraft } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const cssAllowed = !!theme.data?.customCssEnabled;
  const [cssCheck, setCssCheck] = useState<{ css: string; dropped: string[] } | null>(null);
  const [history, setHistory] = useState<{ item: WidgetDesignItem; rows: WidgetDesignRevision[] } | null>(null);
  const openHistory = async (d: WidgetDesignItem) => {
    try {
      setHistory({ item: d, rows: await settingsService.widgetDesignRevisions(d.id) });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const checkCss = async (css: string) => {
    try {
      setCssCheck(await settingsService.sanitizeCustomCss(css));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const [importing, setImporting] = useState(false);

  const exportPackage = async (d: WidgetDesignItem) => {
    try {
      const { blob, filename } = await settingsService.exportWidgetDesign(d.id);
      saveBlob(blob, filename || `${d.name}.sharptalk-widget.json`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  const importPackage = async (file: File) => {
    setImporting(true);
    try {
      const row = await settingsService.importWidgetDesign(file);
      toast.success(t('widgetDesigns.done.import', { name: row.name }));
      designs.refetch();
    } catch (e) {
      toast.error((e as Error).message, { sticky: true });
    } finally {
      setImporting(false);
    }
  };

  const items = (designs.data?.items ?? []).filter((d) => showArchived || d.status !== 'archived');
  const active = designs.data?.items.find((d) => d.active) ?? null;

  const openEditor = (d?: WidgetDesignItem) =>
    setEditing(d ? { id: d.id, name: d.name, note: d.note ?? '', draft: toDraft(d.design) } : { id: null, name: '', note: '', draft: { ...EMPTY } });

  const openPreview = async (d: WidgetDesignItem) => {
    const shop = theme.data?.shopDomain;
    if (!shop) {
      toast.error(t('widgetDesigns.previewNoShop'));
      return;
    }
    try {
      const { token } = await settingsService.widgetDesignPreviewToken(d.id);
      setPreviewUrl(`${WIDGET_URL}/?shop=${encodeURIComponent(shop)}&preview=${encodeURIComponent(token)}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const saveEditor = (andApply: boolean) => {
    if (!editing || !editing.name.trim()) return;
    const draft = {
      ...editing.draft,
      panelWidth: clamp(editing.draft.panelWidth, DESIGN_LIMITS.panel.width.min, DESIGN_LIMITS.panel.width.max),
      panelHeight: clamp(editing.draft.panelHeight, DESIGN_LIMITS.panel.height.min, DESIGN_LIMITS.panel.height.max),
    };
    const after = (saved: { id: string }) => {
      if (andApply) act.mutate({ kind: 'apply', id: saved.id });
      setEditing(null);
    };
    if (editing.id) {
      const isLive = active?.id === editing.id;
      if (isLive && !window.confirm(t('widgetDesigns.editLiveConfirm'))) return;
      act.mutate({ kind: 'update', id: editing.id, name: editing.name.trim(), note: editing.note.trim() || null, design: draft }, { onSuccess: (r) => after(r as { id: string }) });
    } else {
      act.mutate({ kind: 'create', name: editing.name.trim(), design: draft, note: editing.note.trim() || undefined }, { onSuccess: (r) => after(r as { id: string }) });
    }
  };

  const summary = (d: WidgetDesignItem) => {
    const f = d.design.font;
    const fontName =
      f?.preset === 'custom'
        ? (fontAssets.data?.items ?? []).find((a) => a.uuid === f.asset?.uuid)?.label || t('widgetTheme.fontCustom')
        : f?.preset === 'system'
          ? t('widgetTheme.fontSystem')
          : f?.preset === 'noto-sans-kr' ? 'Noto Sans KR' : f?.preset === 'inter' ? 'Inter' : 'Pretendard';
    return `${fontName} ${f?.baseSize ?? DESIGN_LIMITS.baseSize.default}px · ${d.design.panel?.width ?? DESIGN_LIMITS.panel.width.default}×${d.design.panel?.height ?? DESIGN_LIMITS.panel.height.default}`;
  };

  const ed = editing;
  const fontFile = ed?.draft.fontPreset === 'custom' && ed.draft.fontAssetUuid
    ? (fontAssets.data?.items ?? []).find((a) => a.uuid === ed.draft.fontAssetUuid) ?? null
    : null;
  const iconFile = ed?.draft.launcherIconUuid
    ? (iconAssets.data?.items ?? []).find((a) => a.uuid === ed.draft.launcherIconUuid) ?? null
    : null;
  const previewFont = ed
    ? ed.draft.fontPreset === 'custom'
      ? fontFile ? `'IvyPreviewFont', ${FONT_STACKS.pretendard}` : FONT_STACKS.pretendard
      : FONT_STACKS[ed.draft.fontPreset as keyof typeof FONT_STACKS] ?? FONT_STACKS.pretendard
    : FONT_STACKS.pretendard;
  const brand = theme.data?.theme?.brand ?? theme.data?.defaultBrand ?? '#2B7FFF';

  return (
    <Card
      title={t('widgetDesigns.title')}
      action={
        <div className="flex items-center gap-2">
          <input
            ref={importInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importPackage(f);
              e.target.value = '';
            }}
          />
          <Button variant="ghost" size="sm" disabled={importing} onClick={() => importInput.current?.click()}>
            {importing ? tc('loading') : t('widgetDesigns.import')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => openEditor()}>
            {t('widgetDesigns.create')}
          </Button>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-md bg-gray-50 px-3 py-2 text-sm">
        <span className="text-gray-600">{t('widgetDesigns.current')}</span>
        {active ? (
          <>
            <Badge tone="success">{t('widgetDesigns.customInUse', { name: active.name })}</Badge>
            <Button
              variant="ghost"
              size="sm"
              disabled={act.isPending}
              onClick={() => {
                if (window.confirm(t('widgetDesigns.revertConfirm'))) act.mutate({ kind: 'revert' });
              }}
            >
              {t('widgetDesigns.revert')}
            </Button>
          </>
        ) : (
          <Badge tone="gray">{t('widgetDesigns.basicInUse')}</Badge>
        )}
        <label className="ml-auto flex items-center gap-1 text-xs text-gray-500">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
          {t('widgetDesigns.showArchived')}
        </label>
      </div>
      <p className="mb-3 text-xs text-gray-500">{t('widgetDesigns.hint')}</p>

      <ul className="divide-y divide-gray-100 rounded-md border border-gray-200">
        {items.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate font-medium text-gray-800">{d.name}</span>
                {d.active && <Badge tone="success">{t('widgetDesigns.inUse')}</Badge>}
                {d.status === 'archived' && <Badge tone="gray">{t('widgetDesigns.archived')}</Badge>}
              </span>
              <span className="block truncate text-xs text-gray-400">
                {summary(d)} · {new Date(d.updatedAt).toLocaleDateString()}
                {d.note ? ` · ${d.note}` : ''}
              </span>
            </span>
            {d.status !== 'archived' && !d.active && (
              <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ kind: 'apply', id: d.id })}>
                {t('widgetDesigns.use')}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => void openPreview(d)}>
              {t('widgetDesigns.preview')}
            </Button>
            {d.status !== 'archived' && (
              <Button variant="ghost" size="sm" onClick={() => openEditor(d)}>
                {tc('edit')}
              </Button>
            )}
            <Button variant="ghost" size="sm" disabled={act.isPending} onClick={() => act.mutate({ kind: 'duplicate', id: d.id })}>
              {t('widgetDesigns.duplicate')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void exportPackage(d)}>
              {t('widgetDesigns.export')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void openHistory(d)}>
              {t('widgetDesigns.history')}
            </Button>
            {d.status === 'archived' ? (
              <Button variant="ghost" size="sm" disabled={act.isPending} onClick={() => act.mutate({ kind: 'restore', id: d.id })}>
                {t('widgetDesigns.restore')}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" disabled={act.isPending || d.active} onClick={() => act.mutate({ kind: 'archive', id: d.id })}>
                {t('widgetDesigns.archive')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={act.isPending || d.active}
              onClick={() => {
                if (window.confirm(t('widgetDesigns.deleteConfirm', { name: d.name }))) act.mutate({ kind: 'delete', id: d.id });
              }}
            >
              {tc('delete')}
            </Button>
          </li>
        ))}
        {!designs.isLoading && !items.length && (
          <li className="px-3 py-6 text-center text-xs text-gray-400">{t('widgetDesigns.empty')}</li>
        )}
      </ul>

      {/* ---- editor ---- */}
      <Modal
        open={!!ed}
        onClose={() => setEditing(null)}
        title={ed?.id ? t('widgetDesigns.editTitle') : t('widgetDesigns.createTitle')}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>{tc('cancel')}</Button>
            <Button variant="secondary" disabled={!ed?.name.trim() || act.isPending} onClick={() => saveEditor(false)}>
              {t('widgetDesigns.save')}
            </Button>
            <Button disabled={!ed?.name.trim() || act.isPending} onClick={() => saveEditor(true)}>
              {t('widgetDesigns.saveAndUse')}
            </Button>
          </>
        }
      >
        {ed && (
          <div className="flex flex-wrap gap-6">
            <div className="min-w-[260px] flex-1 space-y-1">
              <FormRow label={t('widgetDesigns.name')}>
                <Input value={ed.name} maxLength={64} onChange={(e) => setEditing({ ...ed, name: e.target.value })} />
              </FormRow>
              <FormRow label={t('widgetTheme.font')}>
                <div className="flex flex-wrap gap-2">
                  <Select value={ed.draft.fontPreset} onChange={(e) => setEditing({ ...ed, draft: { ...ed.draft, fontPreset: e.target.value } })} className="w-44">
                    <option value="pretendard">Pretendard</option>
                    <option value="noto-sans-kr">Noto Sans KR</option>
                    <option value="inter">Inter</option>
                    <option value="system">{t('widgetTheme.fontSystem')}</option>
                    {(fontAssets.data?.items.length ?? 0) > 0 && <option value="custom">{t('widgetTheme.fontCustom')}</option>}
                  </Select>
                  {ed.draft.fontPreset === 'custom' && (
                    <Select value={ed.draft.fontAssetUuid ?? ''} onChange={(e) => setEditing({ ...ed, draft: { ...ed.draft, fontAssetUuid: e.target.value || null } })} className="w-44">
                      <option value="">—</option>
                      {(fontAssets.data?.items ?? []).map((a) => (
                        <option key={a.uuid} value={a.uuid}>{a.label || a.filename}</option>
                      ))}
                    </Select>
                  )}
                  <Select value={String(ed.draft.baseSize)} onChange={(e) => setEditing({ ...ed, draft: { ...ed.draft, baseSize: Number(e.target.value) } })} className="w-24">
                    {[13, 14, 15, 16].map((n) => <option key={n} value={n}>{n}px</option>)}
                  </Select>
                </div>
              </FormRow>
              <p className="mb-2 text-xs text-gray-400">{t('widgetTheme.fontHint')}</p>
              <FormRow label={t('widgetTheme.radius')}>
                <Select value={ed.draft.radius} onChange={(e) => setEditing({ ...ed, draft: { ...ed.draft, radius: e.target.value } })} className="w-44">
                  <option value="sm">{t('widgetTheme.radiusSm')}</option>
                  <option value="md">{t('widgetTheme.radiusMd')}</option>
                  <option value="lg">{t('widgetTheme.radiusLg')}</option>
                </Select>
              </FormRow>
              <FormRow label={t('widgetDesigns.quickReplyStyle')}>
                <Select value={ed.draft.quickReplyStyle ?? 'chip'} onChange={(e) => setEditing({ ...ed, draft: { ...ed.draft, quickReplyStyle: e.target.value as 'chip' | 'card' } })} className="w-44">
                  <option value="chip">{t('widgetDesigns.quickReplyChip')}</option>
                  <option value="card">{t('widgetDesigns.quickReplyCard')}</option>
                </Select>
              </FormRow>
              <FormRow label={t('widgetTheme.panel')}>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <input type="number" min={DESIGN_LIMITS.panel.width.min} max={DESIGN_LIMITS.panel.width.max} step={4} value={ed.draft.panelWidth}
                    onChange={(e) => setEditing({ ...ed, draft: { ...ed.draft, panelWidth: Number(e.target.value) } })}
                    className="w-24 rounded-lg border border-gray-200 px-2 py-1.5" />
                  ×
                  <input type="number" min={DESIGN_LIMITS.panel.height.min} max={DESIGN_LIMITS.panel.height.max} step={4} value={ed.draft.panelHeight}
                    onChange={(e) => setEditing({ ...ed, draft: { ...ed.draft, panelHeight: Number(e.target.value) } })}
                    className="w-24 rounded-lg border border-gray-200 px-2 py-1.5" />
                  px
                </div>
              </FormRow>
              <p className="mb-2 text-xs text-gray-400">
                {t('widgetTheme.panelHint', { wmin: DESIGN_LIMITS.panel.width.min, wmax: DESIGN_LIMITS.panel.width.max, hmin: DESIGN_LIMITS.panel.height.min, hmax: DESIGN_LIMITS.panel.height.max })}
              </p>
              <FormRow label={t('widgetTheme.iconFile')}>
                <Select value={ed.draft.launcherIconUuid ?? ''} onChange={(e) => setEditing({ ...ed, draft: { ...ed.draft, launcherIconUuid: e.target.value || null } })} className="w-44">
                  <option value="">{t('widgetDesigns.iconDefault')}</option>
                  {(iconAssets.data?.items ?? []).map((a) => (
                    <option key={a.uuid} value={a.uuid}>{a.label || a.filename}</option>
                  ))}
                </Select>
              </FormRow>
              {cssAllowed && (
                <FormRow label={t('widgetDesigns.customCss')}>
                  <textarea
                    value={ed.draft.customCss ?? ''}
                    rows={6}
                    spellCheck={false}
                    placeholder={'.st-header { background-color: #111; color: #fff }\n.st-message-user { border-radius: 20px }'}
                    onChange={(e) => {
                      setCssCheck(null);
                      setEditing({ ...ed, draft: { ...ed.draft, customCss: e.target.value } });
                    }}
                    className="w-full rounded-lg border border-gray-200 px-2 py-1.5 font-mono text-xs"
                  />
                  <div className="mt-1 flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => void checkCss(ed.draft.customCss ?? '')}>
                      {t('widgetDesigns.customCssCheck')}
                    </Button>
                    <span className="text-[11px] text-gray-400">{t('widgetDesigns.customCssHint')}</span>
                  </div>
                  {cssCheck && (
                    <div className="mt-1 rounded-md bg-gray-50 p-2 text-[11px]">
                      <div className="text-gray-600">{t('widgetDesigns.customCssKept', { n: cssCheck.css ? cssCheck.css.split('\n').length : 0 })}</div>
                      {cssCheck.dropped.length > 0 && (
                        <ul className="mt-1 list-disc pl-4 text-amber-700">
                          {cssCheck.dropped.slice(0, 10).map((d, i) => <li key={i}>{d}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
                </FormRow>
              )}
              <FormRow label={t('widgetDesigns.note')}>
                <Input value={ed.note} maxLength={255} onChange={(e) => setEditing({ ...ed, note: e.target.value })} />
              </FormRow>
            </div>

            {/* Static preview: font, size, corners, icon on the brand colour. */}
            <div className="w-[220px]">
              <div className="mb-2 text-xs font-medium text-gray-500">{t('widgetTheme.preview')}</div>
              {fontFile && (
                <style>{`@font-face{font-family:'IvyPreviewFont';src:url("${apiBaseUrl()}${fontFile.url.slice('/api/v1'.length)}");font-display:swap;}`}</style>
              )}
              {/* The shell followed 모서리 already; the bubbles did not, which is the
                  same gap the widget itself had (FIX-260917). Both now read the one
                  scale the widget reads — see radiusVars(). */}
              <div className="overflow-hidden border border-gray-200 shadow-sm"
                style={{ fontFamily: previewFont, fontSize: `${ed.draft.baseSize / DESIGN_LIMITS.baseSize.default}em`, borderRadius: RADIUS_PX[ed.draft.radius as keyof typeof RADIUS_PX] ?? 12, ...radiusVars(ed.draft.radius as WidgetRadius) } as CSSProperties}>
                <div className="px-3 py-2.5 text-sm font-bold" style={{ backgroundColor: brand, color: '#fff' }}>ivyusa</div>
                <div className="space-y-2 bg-white px-3 py-3">
                  <div className="w-4/5 rounded-st-lg bg-gray-100 px-3 py-2 text-xs text-gray-800">{t('widgetTheme.previewBubble')}</div>
                  <div className="flex justify-end">
                    <span className="rounded-st-lg px-3 py-2 text-xs font-medium" style={{ backgroundColor: brand, color: '#fff' }}>{t('widgetTheme.previewUser')}</span>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex justify-end">
                <span className="flex h-10 w-10 items-center justify-center rounded-full shadow-lg" style={{ backgroundColor: brand }}>
                  {iconFile ? <img src={`${apiBaseUrl()}${iconFile.url.slice('/api/v1'.length)}`} alt="" className="h-6 w-6 object-contain" /> : <span className="text-white">💬</span>}
                </span>
              </div>
              <p className="mt-2 text-[11px] text-gray-400">{t('widgetDesigns.editorPreviewHint')}</p>
            </div>
          </div>
        )}
      </Modal>

      {/* ---- change history ---- */}
      <Modal open={!!history} onClose={() => setHistory(null)} title={t('widgetDesigns.historyTitle', { name: history?.item.name ?? '' })} size="lg"
        footer={<Button variant="ghost" onClick={() => setHistory(null)}>{tc('close')}</Button>}>
        {history && (
          <ul className="max-h-[60vh] divide-y divide-gray-100 overflow-auto text-sm">
            {history.rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <span className="w-10 tabular-nums text-xs text-gray-400">#{r.revisionNo}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{summary({ ...history.item, design: r.design })}</span>
                  <span className="block text-xs text-gray-400">{new Date(r.createdAt).toLocaleString()}{r.note ? ` · ${r.note}` : ''}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={act.isPending}
                  onClick={() => {
                    if (history.item.active && !window.confirm(t('widgetDesigns.editLiveConfirm'))) return;
                    act.mutate({ kind: 'restoreRevision', id: history.item.id, revisionId: r.id }, { onSuccess: () => setHistory(null) });
                  }}
                >
                  {t('widgetDesigns.restoreRevision')}
                </Button>
              </li>
            ))}
            {!history.rows.length && <li className="py-6 text-center text-xs text-gray-400">{t('widgetDesigns.historyEmpty')}</li>}
          </ul>
        )}
      </Modal>

      {/* ---- real-widget preview ---- */}
      <Modal open={!!previewUrl} onClose={() => setPreviewUrl(null)} title={t('widgetDesigns.previewTitle')} size="lg"
        footer={<Button variant="ghost" onClick={() => setPreviewUrl(null)}>{tc('close')}</Button>}>
        {previewUrl && (
          <>
            <p className="mb-2 text-xs text-gray-500">{t('widgetDesigns.previewHint')}</p>
            <iframe title="widget-preview" src={previewUrl} className="h-[720px] w-full rounded-md border border-gray-200 bg-white" />
          </>
        )}
      </Modal>
    </Card>
  );
}
