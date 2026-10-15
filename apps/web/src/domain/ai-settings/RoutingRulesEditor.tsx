import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Input, Label, Select } from '@/components/Field';
import { cn } from '@/lib/cn';
import { ROUTING_MODE } from './ai-settings.service';
import type { RoutingMode } from './ai-settings.service';

/** Region values the Hotel Admin signs (PLN-261015 D2); free text is not offered on purpose. */
export const ROUTING_REGIONS = ['north', 'central', 'south'] as const;
const LABELS = ['consult', 'accounting', 'operations'] as const;

/** Editable row — keywords as the comma-joined string the operator types. */
export interface RoutingRuleRow {
  name: string;
  regions: string[];
  keywords: string;
  labels: string[];
  assignees: string[];
  mode: RoutingMode;
}

export const emptyRoutingRow = (): RoutingRuleRow => ({
  name: '',
  regions: [],
  keywords: '',
  labels: [],
  assignees: [],
  mode: ROUTING_MODE.LEAST_LOADED,
});

/**
 * Region × topic routing rules (PLN-261015 D3, wireframe §6.5.2).
 *
 * Order matters — the first rule whose filters all match decides who is paged —
 * so rows can be moved. An empty filter means "any", which is how the operator
 * writes a catch-all at the bottom.
 */
export function RoutingRulesEditor({
  rows,
  onChange,
  agents,
}: {
  rows: RoutingRuleRow[];
  onChange: (rows: RoutingRuleRow[]) => void;
  agents: Array<{ id: string; email: string; name?: string | null }>;
}) {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const patch = (i: number, next: Partial<RoutingRuleRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...next } : r)));
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= rows.length) return;
    const next = [...rows];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const chip = (on: boolean) =>
    cn(
      'rounded-full border px-2.5 py-1 text-xs',
      on ? 'border-primary-500 bg-primary-500 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50',
    );

  return (
    <div className="border-t border-gray-100 pt-4">
      <Label>{t('handoff.routing.title')}</Label>
      <p className="mb-2 mt-0.5 text-[11px] text-gray-400">{t('handoff.routing.hint')}</p>
      <div className="space-y-3">
        {rows.map((row, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-gray-500">#{i + 1}</span>
              <div className="min-w-[180px] flex-1">
                <Input
                  value={row.name}
                  placeholder={t('handoff.routing.namePh')}
                  onChange={(e) => patch(i, { name: e.target.value })}
                />
              </div>
              <Select
                aria-label={t('handoff.routing.mode')}
                value={row.mode}
                onChange={(e) => patch(i, { mode: e.target.value as RoutingMode })}
              >
                {Object.values(ROUTING_MODE).map((m) => (
                  <option key={m} value={m}>
                    {t(`handoff.routing.modes.${m}`)}
                  </option>
                ))}
              </Select>
              <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => move(i, -1)}>
                ↑
              </button>
              <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => move(i, 1)}>
                ↓
              </button>
              <button
                type="button"
                className="text-xs font-medium text-red-500 hover:underline"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                {tc('delete')}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 shrink-0 text-xs text-gray-500">{t('handoff.routing.regions')}</span>
              {ROUTING_REGIONS.map((r) => (
                <button key={r} type="button" className={chip(row.regions.includes(r))} onClick={() => patch(i, { regions: toggle(row.regions, r) })}>
                  {t(`handoff.routing.region.${r}`)}
                </button>
              ))}
              {row.regions.length === 0 && <span className="text-[11px] text-gray-400">{t('handoff.routing.any')}</span>}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 shrink-0 text-xs text-gray-500">{t('handoff.routing.topic')}</span>
              <div className="min-w-[220px] flex-1">
                <Input
                  value={row.keywords}
                  placeholder={t('handoff.routing.keywordsPh')}
                  onChange={(e) => patch(i, { keywords: e.target.value })}
                />
              </div>
              {LABELS.map((l) => (
                <button key={l} type="button" className={chip(row.labels.includes(l))} onClick={() => patch(i, { labels: toggle(row.labels, l) })}>
                  {t(`handoff.denyLabel.${l}`)}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 shrink-0 text-xs text-gray-500">{t('handoff.routing.agents')}</span>
              {agents.length === 0 && <span className="text-xs text-gray-400">{t('handoff.noAgents')}</span>}
              {agents.map((u) => (
                <button key={u.id} type="button" className={chip(row.assignees.includes(u.id))} onClick={() => patch(i, { assignees: toggle(row.assignees, u.id) })}>
                  {u.email}
                </button>
              ))}
              {row.assignees.length === 0 && <span className="text-[11px] text-warning">{t('handoff.routing.noAssignee')}</span>}
            </div>
          </div>
        ))}
      </div>
      <Button size="sm" variant="secondary" className="mt-2" onClick={() => onChange([...rows, emptyRoutingRow()])}>
        {t('handoff.routing.add')}
      </Button>
    </div>
  );
}
