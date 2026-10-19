import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Input, Label, Select } from '@/components/Field';
import { cn } from '@/lib/cn';
import { ROUTING_MODE } from './ai-settings.service';
import type { RoutingMode } from './ai-settings.service';
import {
  ROUTING_CONDITION_ENUM_VALUES,
  ROUTING_CONDITION_FIELDS,
  routingConditionDef,
} from '../../../../../packages/types/src/common/routing-condition';
import { languageByCode } from '../../../../../packages/types/src/common/language';

/** Region values the Hotel Admin signs (PLN-261015 D2); free text is not offered on purpose. */
export const ROUTING_REGIONS = ['north', 'central', 'south'] as const;

/**
 * One customer-information condition as edited (PLN-261019 P4): enum fields
 * keep chosen `values`; text fields keep the comma-joined `text` the operator
 * types, split on save.
 */
export interface RoutingConditionRow {
  field: string;
  values: string[];
  text: string;
}

/** Editable row — keywords as the comma-joined string the operator types. */
export interface RoutingRuleRow {
  name: string;
  regions: string[];
  keywords: string;
  labels: string[];
  conditions: RoutingConditionRow[];
  assignees: string[];
  mode: RoutingMode;
}

export const emptyRoutingRow = (): RoutingRuleRow => ({
  name: '',
  regions: [],
  keywords: '',
  labels: [],
  conditions: [],
  assignees: [],
  mode: ROUTING_MODE.LEAST_LOADED,
});

const isEnumField = (field: string) => routingConditionDef(field)?.kind === 'enum';

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
  labels,
  languages,
}: {
  rows: RoutingRuleRow[];
  onChange: (rows: RoutingRuleRow[]) => void;
  agents: Array<{ id: string; email: string; name?: string | null }>;
  /** Tenant job labels — code + the tenant's own name (PLN-261019 P3). */
  labels: Array<{ code: string; name: string }>;
  /** Language codes the tenant's widget offers — the `language` condition's options. */
  languages: string[];
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
  // --- customer-information conditions (PLN-261019 P4) ---
  const patchCond = (i: number, c: number, next: Partial<RoutingConditionRow>) =>
    patch(i, { conditions: rows[i].conditions.map((x, k) => (k === c ? { ...x, ...next } : x)) });
  const removeCond = (i: number, c: number) => patch(i, { conditions: rows[i].conditions.filter((_, k) => k !== c) });
  const addCond = (i: number, field: string) => {
    if (!field || rows[i].conditions.some((x) => x.field === field)) return;
    patch(i, { conditions: [...rows[i].conditions, { field, values: [], text: '' }] });
  };
  const enumOptions = (field: string): string[] =>
    field === 'language' ? languages : [...(ROUTING_CONDITION_ENUM_VALUES[field as keyof typeof ROUTING_CONDITION_ENUM_VALUES] ?? [])];
  const valueLabel = (field: string, v: string) =>
    field === 'language' ? (languageByCode(v)?.nativeLabel ?? v.toUpperCase()) : t(`handoff.routing.customer.value.${field}.${v}`, { defaultValue: v });
  const fieldLabel = (field: string) => t(`handoff.routing.customer.field.${field}`, { defaultValue: field });

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
              <div className="w-64 shrink-0">
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
              </div>
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
              {labels.map((l) => (
                <button key={l.code} type="button" className={chip(row.labels.includes(l.code))} onClick={() => patch(i, { labels: toggle(row.labels, l.code) })}>
                  {l.name}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-start gap-1.5">
              <span className="w-16 shrink-0 pt-1 text-xs text-gray-500">{t('handoff.routing.customer.title')}</span>
              <div className="min-w-[220px] flex-1 space-y-1.5">
                {row.conditions.map((c, k) => {
                  const def = routingConditionDef(c.field);
                  return (
                    <div key={c.field} className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-gray-600">{fieldLabel(c.field)}</span>
                      <span className="text-[11px] text-gray-400">
                        {def ? t(def.op === 'contains' ? 'handoff.routing.customer.opContains' : 'handoff.routing.customer.opIn') : t('handoff.routing.customer.unknownField')}
                      </span>
                      {def && isEnumField(c.field) ? (
                        enumOptions(c.field).map((v) => (
                          <button key={v} type="button" className={chip(c.values.includes(v))} onClick={() => patchCond(i, k, { values: toggle(c.values, v) })}>
                            {valueLabel(c.field, v)}
                          </button>
                        ))
                      ) : def ? (
                        <div className="min-w-[200px] flex-1">
                          <Input
                            value={c.text}
                            placeholder={t('handoff.routing.customer.textPh')}
                            onChange={(e) => patchCond(i, k, { text: e.target.value })}
                          />
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="text-xs text-gray-500 hover:underline"
                        aria-label={t('handoff.routing.customer.remove')}
                        onClick={() => removeCond(i, k)}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-center gap-2">
                  <div className="w-56">
                    <Select
                      aria-label={t('handoff.routing.customer.add')}
                      value=""
                      onChange={(e) => addCond(i, e.target.value)}
                    >
                      <option value="">{t('handoff.routing.customer.add')}</option>
                      {ROUTING_CONDITION_FIELDS.filter((f) => !row.conditions.some((c) => c.field === f.field)).map((f) => (
                        <option key={f.field} value={f.field}>
                          {fieldLabel(f.field)}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <span className="text-[11px] text-gray-400">{t('handoff.routing.customer.hint')}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-16 shrink-0 text-xs text-gray-500">{t('handoff.routing.agents')}</span>
              {agents.length === 0 && <span className="text-xs text-gray-400">{t('handoff.noAgents')}</span>}
              {agents.map((u) => (
                <button key={u.id} type="button" className={chip(row.assignees.includes(u.id))} onClick={() => patch(i, { assignees: toggle(row.assignees, u.id) })}>
                  {u.email}
                </button>
              ))}
              {/* Stored assignees outside the agent list (no consult label, or
                  deactivated) stay visible so they can be seen and removed —
                  a hidden assignee would still be paged. */}
              {row.assignees
                .filter((id) => !agents.some((u) => u.id === id))
                .map((id) => (
                  <button key={id} type="button" className={chip(true)} title={t('handoff.routing.unlisted')} onClick={() => patch(i, { assignees: toggle(row.assignees, id) })}>
                    #{id} ×
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
