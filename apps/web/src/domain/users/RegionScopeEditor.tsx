import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Input } from '@/components/Field';
import { cn } from '@/lib/cn';
import { provinceKey } from '../../../../../packages/types/src/common/region';
import { useCategoryName, useRoutingCategories } from '../routing-categories/routing-categories.hooks';
import type { RegionScopeBody } from './users.service';

/** "North · North Center / Đà Nẵng" — the read-only line under a unit/label name. */
export function RegionScopeSummary({ regions, provinces }: RegionScopeBody) {
  const { t } = useTranslation('users');
  const categoryName = useCategoryName();
  if (!regions.length && !provinces.length) return <span className="text-[11px] text-gray-400">{t('scopeNone')}</span>;
  const parts = [regions.map(categoryName).join(' · '), provinces.join(', ')].filter(Boolean);
  return <span className="text-[11px] text-gray-600">{parts.join(' / ')}</span>;
}

/**
 * Inline editor for the places a unit or job label covers (PLN-261022 stage 1,
 * wireframe 2.6). Categories are the tenant's routing categories (PLN-261024),
 * a stored code no longer in the list stays visible so it can be removed; provinces are free entries
 * suggested from the tenant's province → region map, de-duplicated by the same
 * key the server uses (NFC, case-insensitive). Saving is the caller's.
 */
export function RegionScopeEditor({
  initial,
  provinceOptions,
  saving,
  onSave,
  onCancel,
}: {
  initial: RegionScopeBody;
  provinceOptions: string[];
  saving: boolean;
  onSave: (next: RegionScopeBody) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('users');
  const { t: tc } = useTranslation('common');
  const [regions, setRegions] = useState<string[]>(initial.regions);
  const [provinces, setProvinces] = useState<string[]>(initial.provinces);
  const [draft, setDraft] = useState('');
  const categories = useRoutingCategories();
  const categoryName = useCategoryName();
  const codes = (categories.data ?? []).map((c) => c.code);
  const stale = regions.filter((r) => !codes.includes(r));

  const toggleRegion = (code: string) =>
    setRegions((list) => (list.includes(code) ? list.filter((r) => r !== code) : [...list, code]));
  const addProvince = () => {
    const name = draft.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!name) return;
    // Pick the tenant's own spelling when the typed name matches one.
    const known = provinceOptions.find((p) => provinceKey(p) === provinceKey(name));
    const value = known ?? name;
    setProvinces((list) => (list.some((p) => provinceKey(p) === provinceKey(value)) ? list : [...list, value]));
    setDraft('');
  };
  const chip = (on: boolean) =>
    cn(
      'rounded-full border px-2.5 py-1 text-xs',
      on ? 'border-primary-500 bg-primary-500 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
    );
  const listId = 'region-scope-provinces';

  return (
    <div className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-24 shrink-0 text-xs text-gray-500">{t('scopeRegions')}</span>
        {codes.map((code) => (
          <button key={code} type="button" aria-pressed={regions.includes(code)} className={chip(regions.includes(code))} onClick={() => toggleRegion(code)}>
            {categoryName(code)}
          </button>
        ))}
        {stale.map((code) => (
          <button key={code} type="button" aria-pressed className={chip(true)} onClick={() => toggleRegion(code)}>
            {code} ×
          </button>
        ))}
        {!codes.length && !stale.length && <span className="text-[11px] text-gray-400">{t('scopeNoCategories')}</span>}
      </div>
      <div className="flex flex-wrap items-start gap-1.5">
        <span className="w-24 shrink-0 pt-1.5 text-xs text-gray-500">{t('scopeProvinces')}</span>
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            {provinces.map((p) => (
              <button
                key={p}
                type="button"
                className={chip(true)}
                aria-label={`${p} ×`}
                onClick={() => setProvinces((list) => list.filter((x) => x !== p))}
              >
                {p} ×
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              value={draft}
              list={listId}
              maxLength={120}
              placeholder={t('scopeProvincePh')}
              aria-label={t('scopeProvinces')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addProvince();
                }
              }}
            />
            <datalist id={listId}>
              {provinceOptions.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <Button size="sm" variant="secondary" className="shrink-0 whitespace-nowrap" disabled={!draft.trim()} onClick={addProvince}>
              {t('scopeAdd')}
            </Button>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400">{t('scopeHint')}</p>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          {tc('cancel')}
        </Button>
        <Button size="sm" disabled={saving} onClick={() => onSave({ regions, provinces })}>
          {tc('save')}
        </Button>
      </div>
    </div>
  );
}
