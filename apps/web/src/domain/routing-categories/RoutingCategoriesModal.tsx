import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Field';
import { Modal } from '@/components/Modal';
import { toast } from '@/store/toast-store';
import { cn } from '@/lib/cn';
import { canonicalRegion } from '../../../../../packages/types/src/common/region';
import { LANGUAGES } from '../../../../../packages/types/src/common/language';
import { useRoutingCategories, useRoutingCategoryMutations } from './routing-categories.hooks';
import type { RoutingCategory } from './routing-categories.service';

/** Stored code shape — the server folds with the same `canonicalRegion` and checks this too. */
const CODE_PATTERN = /^[a-z0-9_]{1,64}$/;

type Draft = { name?: string; visible?: boolean; names?: Record<string, string> };

const sameNames = (a: Record<string, string> | null | undefined, b: Record<string, string> | null | undefined) => {
  const clean = (n: Record<string, string> | null | undefined) =>
    JSON.stringify(Object.entries(n ?? {}).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]).sort());
  return clean(a) === clean(b);
};

/**
 * Consult category management (PLN-261024-Widget-Handoff-Consult-Category-Picker, wireframe 3-2).
 *
 * Add and delete apply at once; renames, visibility, per-language names and
 * order are drafted and saved together. The code is fixed after creation — it
 * is what rules, teams and labels store and what the widget sends back — so
 * only the rest is editable. A category in use cannot be deleted (E5107).
 */
export function RoutingCategoriesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const { data, isLoading } = useRoutingCategories();
  const { create, update, remove } = useRoutingCategoryMutations();
  const [order, setOrder] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newVisible, setNewVisible] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const rows = useMemo(() => data ?? [], [data]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // Every opening (and every server refresh) starts from what is stored; drafts of rows still present survive a refresh.
  useEffect(() => {
    if (!open) return;
    setOrder(rows.map((r) => r.id));
    setDrafts((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => byId.has(id))));
  }, [open, rows, byId]);
  useEffect(() => {
    if (open) return;
    setDrafts({});
    setExpanded(null);
    setNewCode('');
    setNewName('');
    setNewVisible(true);
    setPendingDelete(null);
  }, [open]);

  const draftOf = (r: RoutingCategory) => drafts[r.id] ?? {};
  const nameOf = (r: RoutingCategory) => draftOf(r).name ?? r.name ?? '';
  const visibleOf = (r: RoutingCategory) => draftOf(r).visible ?? r.visible;
  const namesOf = (r: RoutingCategory) => draftOf(r).names ?? r.names ?? {};
  const patch = (id: string, d: Draft) => setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...d } }));

  // Renumber only when the order really moved — stored numbers have gaps, so comparing them would always differ.
  const orderMoved = order.join(',') !== rows.map((r) => r.id).join(',');
  const changes = order
    .map((id, i) => {
      const r = byId.get(id);
      if (!r) return null;
      const item: { id: string; name?: string; sort_order?: number; visible?: boolean; names?: Record<string, string> } = { id };
      const name = nameOf(r).trim();
      if (name !== (r.name ?? '')) item.name = name;
      if (orderMoved && (i + 1) * 10 !== r.sortOrder) item.sort_order = (i + 1) * 10;
      if (visibleOf(r) !== r.visible) item.visible = visibleOf(r);
      if (!sameNames(namesOf(r), r.names)) item.names = namesOf(r);
      return Object.keys(item).length > 1 ? item : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const move = (i: number, dir: -1 | 1) =>
    setOrder((list) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const folded = canonicalRegion(newCode);
  const codeValid = CODE_PATTERN.test(folded);
  const codeTaken = rows.some((r) => r.code === folded);
  const canAdd = codeValid && !codeTaken && newName.trim().length <= 100 && !create.isPending;

  const onAdd = async () => {
    if (!canAdd) return;
    try {
      await create.mutateAsync({ code: folded, name: newName.trim() || undefined, visible: newVisible });
      toast.success(t('handoff.routing.categories.created', { name: newName.trim() || folded }));
      setNewCode('');
      setNewName('');
      setNewVisible(true);
    } catch (e) {
      toast.error((e as Error).message || t('handoff.routing.categories.saveError'), { sticky: true });
    }
  };

  const onSave = async () => {
    if (!changes.length) return;
    try {
      await update.mutateAsync(changes);
      setDrafts({});
      toast.success(t('handoff.routing.categories.saved'));
    } catch (e) {
      toast.error((e as Error).message || t('handoff.routing.categories.saveError'), { sticky: true });
    }
  };

  const display = (r: RoutingCategory) => r.name || r.code;
  const onDelete = async (r: RoutingCategory) => {
    setPendingDelete(null);
    try {
      await remove.mutateAsync(r.id);
      toast.success(t('handoff.routing.categories.deleted', { name: display(r) }));
    } catch (e) {
      const err = e as Error & { code?: string; details?: Record<string, string[]> };
      if (err.code === 'E5107') {
        const d = err.details ?? {};
        const where = [
          ...(d.rules ?? []).map((n) => t('handoff.routing.categories.whereRule', { name: n })),
          ...(d.units ?? []).map((n) => t('handoff.routing.categories.whereUnit', { name: n })),
          ...(d.labels ?? []).map((n) => t('handoff.routing.categories.whereLabel', { name: n })),
        ].join(', ');
        toast.error(t('handoff.routing.categories.inUse', { where }), { sticky: true });
      } else {
        toast.error(err.message || t('handoff.routing.categories.deleteError'), { sticky: true });
      }
    }
  };

  const usageText = (r: RoutingCategory) =>
    t('handoff.routing.categories.usage', { rules: r.usage.rules.length, units: r.usage.units.length, labels: r.usage.labels.length });
  const inUse = (r: RoutingCategory) => r.usage.rules.length + r.usage.units.length + r.usage.labels.length > 0;
  const namesSummary = (r: RoutingCategory) =>
    Object.entries(namesOf(r))
      .filter(([, v]) => v.trim())
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('handoff.routing.categories.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {tc('close')}
          </Button>
          <Button disabled={!changes.length || update.isPending} onClick={onSave}>
            {t('handoff.routing.categories.save')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-gray-500">{t('handoff.routing.categories.hint')}</p>
      {isLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}
      {!isLoading && !rows.length && <p className="mb-3 text-sm text-gray-400">{t('handoff.routing.categories.empty')}</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 text-sm">
          {order.map((id, i) => {
            const r = byId.get(id);
            if (!r) return null;
            const shown = visibleOf(r);
            return (
              <li key={id} className="px-3 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="w-28 shrink-0 truncate text-xs text-gray-600" title={r.code}>
                    {r.code}
                  </code>
                  <div className="min-w-[120px] flex-1">
                    <Input
                      value={nameOf(r)}
                      maxLength={100}
                      placeholder={r.code}
                      aria-label={t('handoff.routing.categories.name')}
                      onChange={(e) => patch(id, { name: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={shown}
                    onClick={() => patch(id, { visible: !shown })}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium',
                      shown ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-500',
                    )}
                  >
                    {shown ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    {shown ? t('handoff.routing.categories.visible') : t('handoff.routing.categories.hidden')}
                  </button>
                  <span className="shrink-0 text-[11px] text-gray-400">{usageText(r)}</span>
                  <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button type="button" className="text-xs text-gray-500 hover:underline" onClick={() => move(i, 1)}>
                    ↓
                  </button>
                  {pendingDelete === id ? (
                    <span className="flex items-center gap-1">
                      <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => onDelete(r)}>
                        {t('handoff.routing.categories.confirmDelete')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPendingDelete(null)}>
                        {tc('cancel')}
                      </Button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="text-xs font-medium text-red-500 hover:underline"
                      title={inUse(r) ? t('handoff.routing.categories.inUseHint') : undefined}
                      onClick={() => setPendingDelete(id)}
                    >
                      {tc('delete')}
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  className="mt-1 pl-[7.5rem] text-left text-[11px] text-gray-500 hover:underline"
                  aria-expanded={expanded === id}
                  onClick={() => setExpanded((cur) => (cur === id ? null : id))}
                >
                  {expanded === id ? '▾' : '▸'} {t('handoff.routing.categories.names')}
                  {namesSummary(r) && <span className="ml-1 text-gray-400">({namesSummary(r)})</span>}
                </button>
                {expanded === id && (
                  <div className="mt-1 grid grid-cols-1 gap-2 pl-[7.5rem] sm:grid-cols-2">
                    {LANGUAGES.map((l) => {
                      const key = l.code.toLowerCase();
                      return (
                        <label key={key} className="flex items-center gap-2 text-xs text-gray-600">
                          <span className="w-20 shrink-0">{l.nativeLabel}</span>
                          <Input
                            value={namesOf(r)[key] ?? ''}
                            maxLength={100}
                            placeholder={nameOf(r) || r.code}
                            onChange={(e) => patch(id, { names: { ...namesOf(r), [key]: e.target.value } })}
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-gray-100 pt-3">
        <div className="w-40">
          <Input
            value={newCode}
            maxLength={64}
            placeholder={t('handoff.routing.categories.codePh')}
            aria-label={t('handoff.routing.categories.code')}
            onChange={(e) => setNewCode(e.target.value)}
          />
          {newCode && !codeValid && <p className="mt-1 text-[11px] text-warning">{t('handoff.routing.categories.codeInvalid')}</p>}
          {codeTaken && <p className="mt-1 text-[11px] text-warning">{t('handoff.routing.categories.codeTaken')}</p>}
          {codeValid && !codeTaken && folded !== newCode && (
            <p className="mt-1 text-[11px] text-gray-400">{t('handoff.routing.categories.codeFolded', { code: folded })}</p>
          )}
        </div>
        <div className="min-w-[160px] flex-1">
          <Input
            value={newName}
            maxLength={100}
            placeholder={t('handoff.routing.categories.namePh')}
            aria-label={t('handoff.routing.categories.name')}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAdd();
              }
            }}
          />
        </div>
        <label className="flex items-center gap-1.5 pt-2 text-xs text-gray-600">
          <input type="checkbox" className="h-4 w-4" checked={newVisible} onChange={(e) => setNewVisible(e.target.checked)} />
          {t('handoff.routing.categories.newVisible')}
        </label>
        <Button size="sm" variant="secondary" disabled={!canAdd} onClick={onAdd}>
          {t('handoff.routing.categories.add')}
        </Button>
      </div>
    </Modal>
  );
}
