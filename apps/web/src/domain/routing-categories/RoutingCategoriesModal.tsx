import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { Input } from '@/components/Field';
import { Modal } from '@/components/Modal';
import { toast } from '@/store/toast-store';
import { canonicalRegion } from '../../../../../packages/types/src/common/region';
import { useRoutingCategories, useRoutingCategoryMutations } from './routing-categories.hooks';
import type { RoutingCategory } from './routing-categories.service';

/** Stored code shape — the server folds with the same `canonicalRegion` and checks this too. */
const CODE_PATTERN = /^[a-z0-9_]{1,64}$/;

/**
 * Routing category management (PLN-261024 wireframe 2-3).
 *
 * Add and delete apply at once; renames and order are drafted and saved
 * together. The code is fixed after creation — it is what the host app sends
 * and what rules, teams, labels and companies store — so only the name and
 * the order are editable. A category in use cannot be deleted (E5107).
 */
export function RoutingCategoriesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('aiSetting');
  const { t: tc } = useTranslation('common');
  const { data, isLoading } = useRoutingCategories();
  const { create, update, remove } = useRoutingCategoryMutations();
  const [order, setOrder] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const rows = useMemo(() => data ?? [], [data]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  // Every opening (and every server refresh) starts from what is stored; drafts of rows still present survive a refresh.
  useEffect(() => {
    if (!open) return;
    setOrder(rows.map((r) => r.id));
    setNames((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => byId.has(id))));
  }, [open, rows, byId]);
  useEffect(() => {
    if (open) return;
    setNames({});
    setNewCode('');
    setNewName('');
    setPendingDelete(null);
  }, [open]);

  const builtIn = (code: string) => t(`handoff.routing.region.${code}`, { defaultValue: '' });
  const nameOf = (r: RoutingCategory) => names[r.id] ?? r.name ?? '';
  // Renumber only when the order really moved — stored numbers have gaps, so comparing them would always differ.
  const orderMoved = order.join(',') !== rows.map((r) => r.id).join(',');
  const changes = order
    .map((id, i) => {
      const r = byId.get(id);
      if (!r) return null;
      const sortOrder = (i + 1) * 10;
      const name = nameOf(r).trim();
      const item: { id: string; name?: string; sort_order?: number } = { id };
      if (name !== (r.name ?? '')) item.name = name;
      if (orderMoved && sortOrder !== r.sortOrder) item.sort_order = sortOrder;
      return item.name !== undefined || item.sort_order !== undefined ? item : null;
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
      await create.mutateAsync({ code: folded, name: newName.trim() || undefined });
      toast.success(t('handoff.routing.categories.created', { name: newName.trim() || builtIn(folded) || folded }));
      setNewCode('');
      setNewName('');
    } catch (e) {
      toast.error((e as Error).message || t('handoff.routing.categories.saveError'), { sticky: true });
    }
  };

  const onSave = async () => {
    if (!changes.length) return;
    try {
      await update.mutateAsync(changes);
      setNames({});
      toast.success(t('handoff.routing.categories.saved'));
    } catch (e) {
      toast.error((e as Error).message || t('handoff.routing.categories.saveError'), { sticky: true });
    }
  };

  const display = (r: RoutingCategory) => r.name || builtIn(r.code) || r.code;
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
          ...(d.companies?.length ? [t('handoff.routing.categories.whereCompanies', { count: Number(d.companies[0]) })] : []),
        ].join(', ');
        toast.error(t('handoff.routing.categories.inUse', { where }), { sticky: true });
      } else {
        toast.error(err.message || t('handoff.routing.categories.deleteError'), { sticky: true });
      }
    }
  };

  const usageText = (r: RoutingCategory) =>
    t('handoff.routing.categories.usage', {
      rules: r.usage.rules.length,
      units: r.usage.units.length,
      labels: r.usage.labels.length,
      companies: r.usage.companies,
    });
  const inUse = (r: RoutingCategory) =>
    r.usage.rules.length + r.usage.units.length + r.usage.labels.length + r.usage.companies > 0;

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
            return (
              <li key={id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                <code className="w-32 shrink-0 truncate text-xs text-gray-600" title={r.code}>
                  {r.code}
                </code>
                <div className="min-w-[140px] flex-1">
                  <Input
                    value={nameOf(r)}
                    maxLength={100}
                    placeholder={builtIn(r.code) || r.code}
                    aria-label={t('handoff.routing.categories.name')}
                    onChange={(e) => setNames((prev) => ({ ...prev, [id]: e.target.value }))}
                  />
                </div>
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
        <Button size="sm" variant="secondary" disabled={!canAdd} onClick={onAdd}>
          {t('handoff.routing.categories.add')}
        </Button>
      </div>
    </Modal>
  );
}
