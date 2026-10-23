import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Field';
import { toast } from '@/store/toast-store';
import { REGION_CODES } from '../../../../../packages/types/src/common/region';
import { languageByCode } from '../../../../../packages/types/src/common/language';
import { aiSettingsService } from './ai-settings.service';
import type { RoutingRule, RoutingSimulation, RoutingSkipReason } from './ai-settings.service';
import type { AssigneeAgent } from './RoutingRulesEditor';

/**
 * "Who would this reach?" (PLN-261024 D6, wireframe 2-5).
 *
 * Runs the rules as currently edited — not yet saved — through the server's own
 * matching and group resolution, so the answer is what a real handoff would do.
 * Nobody is paged. Business hours are ignored: the question is who, not when.
 */
export function RoutingSimulator({
  rules,
  fallbackAssignees,
  agents,
  categories,
  languages,
}: {
  rules: RoutingRule[];
  fallbackAssignees: string[];
  agents: AssigneeAgent[];
  categories: Array<{ code: string; name: string }>;
  languages: string[];
}) {
  const { t } = useTranslation('aiSetting');
  const [category, setCategory] = useState('');
  const [region, setRegion] = useState('');
  const [province, setProvince] = useState('');
  const [language, setLanguage] = useState('');
  const run = useMutation({
    mutationFn: () =>
      aiSettingsService.simulateRouting({
        rules,
        assignee_user_ids: fallbackAssignees.map(Number).filter(Number.isFinite),
        context: {
          consult_category: category || undefined,
          region: region || undefined,
          province: province.trim() || undefined,
          language: language || undefined,
        },
      }),
    onError: (e: Error) => toast.error(e.message || t('handoff.routing.sim.error'), { sticky: true }),
  });

  const nameOf = (id: number) => {
    const a = agents.find((x) => String(x.id) === String(id));
    return a ? a.name?.trim() || a.email : `#${id}`;
  };
  const reasonText = (r?: RoutingSkipReason) => {
    if (!r) return '';
    if (r.startsWith('condition:')) {
      const field = r.slice('condition:'.length);
      return t('handoff.routing.sim.reason.condition', {
        field: t(`handoff.routing.customer.field.${field}`, { defaultValue: field }),
      });
    }
    return t(`handoff.routing.sim.reason.${r}`);
  };
  const res: RoutingSimulation | undefined = run.data;

  return (
    <div className="mb-3 rounded-lg border border-primary-100 bg-primary-50/40 p-3" data-testid="routing-simulator">
      <p className="mb-2 text-xs font-semibold text-gray-700">{t('handoff.routing.sim.title')}</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="w-44 text-[11px] text-gray-500">
          {t('handoff.routing.regions')}
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t('handoff.routing.sim.none')}</option>
            {categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="w-36 text-[11px] text-gray-500">
          {t('handoff.routing.customer.field.region')}
          <Select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">{t('handoff.routing.sim.none')}</option>
            {REGION_CODES.map((r) => (
              <option key={r} value={r}>
                {t(`handoff.routing.customer.value.region.${r}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="w-40 text-[11px] text-gray-500">
          {t('handoff.routing.customer.field.province')}
          <Input value={province} maxLength={120} placeholder="Hồ Chí Minh" onChange={(e) => setProvince(e.target.value)} />
        </label>
        <label className="w-32 text-[11px] text-gray-500">
          {t('handoff.routing.customer.field.language')}
          <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">{t('handoff.routing.sim.none')}</option>
            {languages.map((l) => (
              <option key={l} value={l.toUpperCase()}>
                {languageByCode(l)?.nativeLabel ?? l.toUpperCase()}
              </option>
            ))}
          </Select>
        </label>
        <Button size="sm" disabled={run.isPending} onClick={() => run.mutate()}>
          {t('handoff.routing.sim.run')}
        </Button>
      </div>
      {res && (
        <div className="mt-2 space-y-0.5 text-xs" data-testid="routing-simulator-result">
          {res.result.ruleIndex != null ? (
            <p className="font-medium text-gray-800">
              → #{res.result.ruleIndex + 1} {res.result.ruleName} → {res.result.targetUserIds.map(nameOf).join(', ')}
            </p>
          ) : (
            <p className="font-medium text-gray-800">
              →{' '}
              {res.result.targetUserIds.length
                ? t('handoff.routing.sim.fallback', { names: res.result.targetUserIds.map(nameOf).join(', ') })
                : t('handoff.routing.sim.broadcast')}
            </p>
          )}
          {res.steps
            .filter((s) => s.outcome === 'skipped')
            .map((s) => (
              <p key={s.index} className="text-gray-500">
                {t('handoff.routing.sim.skipped', { n: s.index + 1, name: s.name, reason: reasonText(s.reason) })}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
