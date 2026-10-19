import { useState } from 'react';
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
import { resolveAssigneeGroup } from '../../../../../packages/types/src/common/routing-assignee';

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
  /** Explicitly chosen agents (user ids). */
  assignees: string[];
  /** Group selector — unit ids / label codes, resolved at handoff time. */
  assigneeUnits: string[];
  assigneeLabels: string[];
  mode: RoutingMode;
}

/** What the assignee block needs to know about a tenant user. */
export interface AssigneeAgent {
  id: string;
  email: string;
  name?: string | null;
  status?: string;
  unitId?: string | null;
  unitName?: string | null;
  labelCodes?: string[];
}

/** A rule pages someone when it names an agent or a group (server rule, mirrored). */
export const rowHasAssignee = (r: RoutingRuleRow) =>
  r.assignees.length > 0 || r.assigneeUnits.length > 0 || r.assigneeLabels.length > 0;

type AgentView = 'all' | 'unit' | 'label';

export const emptyRoutingRow = (): RoutingRuleRow => ({
  name: '',
  regions: [],
  keywords: '',
  labels: [],
  conditions: [],
  assignees: [],
  assigneeUnits: [],
  assigneeLabels: [],
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
  units,
  languages,
  manageHref,
}: {
  rows: RoutingRuleRow[];
  onChange: (rows: RoutingRuleRow[]) => void;
  /** Active tenant users (the assignee candidates) with their unit and labels. */
  agents: AssigneeAgent[];
  /** Tenant job labels — code + the tenant's own name (PLN-261019 P3). */
  labels: Array<{ code: string; name: string }>;
  /** Tenant units (teams) — the group selector's unit chips. */
  units: Array<{ id: string; name: string }>;
  /** Language codes the tenant's widget offers — the `language` condition's options. */
  languages: string[];
  /** Where "manage labels & units" goes (undefined = link hidden, e.g. non-master). */
  manageHref?: string;
}) {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const [view, setView] = useState<AgentView>('all');
  const labelName = (code: string) => labels.find((l) => l.code === code)?.name ?? code;
  const unitName = (id: string) => units.find((u) => u.id === id)?.name ?? `#${id}`;
  /** Group members right now — the same resolver the API runs at handoff time. */
  const groupMembers = (row: RoutingRuleRow) =>
    resolveAssigneeGroup(agents, { unitIds: row.assigneeUnits, labelCodes: row.assigneeLabels });
  const hasConsult = (a: AssigneeAgent) => (a.labelCodes ?? []).includes('consult');
  /** Agents grouped for the [by unit] / [by label] views; a multi-label user appears under each label. */
  const grouped = (): Array<{ key: string; title: string; members: AssigneeAgent[] }> => {
    if (view === 'all') return [{ key: 'all', title: '', members: agents }];
    const buckets = new Map<string, AssigneeAgent[]>();
    const push = (key: string, a: AssigneeAgent) => buckets.set(key, [...(buckets.get(key) ?? []), a]);
    for (const a of agents) {
      if (view === 'unit') push(a.unitId ?? '', a);
      else if ((a.labelCodes ?? []).length) a.labelCodes!.forEach((c) => push(c, a));
      else push('', a);
    }
    const order = view === 'unit' ? [...units.map((u) => u.id), ''] : [...labels.map((l) => l.code), ''];
    return order
      .filter((k) => buckets.has(k))
      .map((k) => ({ key: k || 'none', title: k ? (view === 'unit' ? unitName(k) : labelName(k)) : '—', members: buckets.get(k)! }));
  };
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

            <div className="space-y-2 border-t border-gray-100 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-16 shrink-0 text-xs text-gray-500">{t('handoff.routing.agents')}</span>
                <span className="text-[11px] text-gray-400">{t('handoff.routing.assignee.view')}</span>
                {(['all', 'unit', 'label'] as AgentView[]).map((v) => (
                  <button key={v} type="button" className={chip(view === v)} onClick={() => setView(v)}>
                    {t(`handoff.routing.assignee.view_${v}`)}
                  </button>
                ))}
                {manageHref && (
                  <a href={manageHref} className="ml-auto text-xs text-primary-600 hover:underline">
                    {t('handoff.routing.assignee.manageLink')}
                  </a>
                )}
              </div>

              {/* Group selector: units × labels, resolved when the handoff happens. */}
              <div className="flex flex-wrap items-start gap-1.5">
                <span className="w-16 shrink-0 pt-1 text-xs text-gray-500">{t('handoff.routing.assignee.group')}</span>
                <div className="flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="w-10 text-[11px] text-gray-400">{t('handoff.routing.assignee.units')}</span>
                    {units.length === 0 && <span className="text-[11px] text-gray-400">—</span>}
                    {units.map((u) => (
                      <button key={u.id} type="button" className={chip(row.assigneeUnits.includes(u.id))} onClick={() => patch(i, { assigneeUnits: toggle(row.assigneeUnits, u.id) })}>
                        {u.name}
                      </button>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="w-10 text-[11px] text-gray-400">{t('handoff.routing.assignee.labels')}</span>
                    {labels.map((l) => (
                      <button key={l.code} type="button" className={chip(row.assigneeLabels.includes(l.code))} onClick={() => patch(i, { assigneeLabels: toggle(row.assigneeLabels, l.code) })}>
                        {l.name}
                      </button>
                    ))}
                  </div>
                  {(row.assigneeUnits.length > 0 || row.assigneeLabels.length > 0) && (() => {
                    const ids = groupMembers(row);
                    const members = ids.map((id) => agents.find((a) => a.id === id)).filter((a): a is AssigneeAgent => !!a);
                    return ids.length === 0 ? (
                      <p className="text-[11px] text-warning">{t('handoff.routing.assignee.previewNone')}</p>
                    ) : (
                      <p className="text-[11px] text-gray-500">
                        {t('handoff.routing.assignee.preview', { count: ids.length })}{' '}
                        {members.map((a) => (
                          <span key={a.id} className="mr-1.5">
                            {a.email}
                            {!hasConsult(a) && <span title={t('handoff.routing.assignee.noConsult')}>⚠</span>}
                          </span>
                        ))}
                      </p>
                    );
                  })()}
                </div>
              </div>

              {/* Explicit people, grouped by the chosen view. */}
              <div className="flex flex-wrap items-start gap-1.5">
                <span className="w-16 shrink-0 pt-1 text-xs text-gray-500">{t('handoff.routing.assignee.people')}</span>
                <div className="flex-1 space-y-1">
                  {agents.length === 0 && <span className="text-xs text-gray-400">{t('handoff.noAgents')}</span>}
                  {grouped().map((g) => (
                    <div key={g.key} className="flex flex-wrap items-center gap-1.5">
                      {g.title && <span className="text-[11px] font-medium text-gray-500">▸ {g.title} ({g.members.length})</span>}
                      {g.members.map((u) => (
                        <button key={`${g.key}-${u.id}`} type="button" className={chip(row.assignees.includes(u.id))} onClick={() => patch(i, { assignees: toggle(row.assignees, u.id) })}>
                          {u.email}
                          {!hasConsult(u) && <span title={t('handoff.routing.assignee.noConsult')}>⚠</span>}
                        </button>
                      ))}
                    </div>
                  ))}
                  {/* Stored assignees outside the agent list (deactivated, or
                      removed) stay visible so they can be seen and removed —
                      a hidden assignee would still be paged. */}
                  {row.assignees.filter((id) => !agents.some((u) => u.id === id)).length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {row.assignees
                        .filter((id) => !agents.some((u) => u.id === id))
                        .map((id) => (
                          <button key={id} type="button" className={chip(true)} title={t('handoff.routing.unlisted')} onClick={() => patch(i, { assignees: toggle(row.assignees, id) })}>
                            #{id} ×
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              </div>
              {!rowHasAssignee(row) && <p className="text-[11px] text-warning">{t('handoff.routing.assignee.needOne')}</p>}
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
