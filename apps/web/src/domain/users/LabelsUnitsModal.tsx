import { Fragment, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { MapPin, Trash2 } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Input } from '@/components/Field';
import { Modal } from '@/components/Modal';
import { cn } from '@/lib/cn';
import { toast } from '@/store/toast-store';
import { useTenantKey } from '@/lib/use-tenant-key';
import { aiSettingsService } from '../ai-settings/ai-settings.service';
import { useJobLabels, useOrgMutations, useUnits } from './users.hooks';
import { RegionScopeEditor, RegionScopeSummary } from './RegionScopeEditor';
import type { RegionScopeBody } from './users.service';

/** The three label codes the permission matrix keys on (permission-matrix.ts). */
const PERMISSION_LABEL_CODES = new Set(['consult', 'accounting', 'operations']);
const CODE_PATTERN = /^[a-z0-9_]{1,24}$/;

type Tab = 'labels' | 'units';
type Row = { id: string; code: string; name: string; memberCount: number; regions: string[]; provinces: string[] };

/**
 * Per-tenant job labels and units: rename in place, add at the bottom
 * (PLN-261019-Users-Unit-Labels-Routing-Conditions P2, wireframe 4-3).
 * Codes never change. Delete (PLN-261021-Users-Labels-Units-Delete) confirms in
 * place with the release count; the permission labels cannot be deleted, and the
 * server refuses a row a routing rule still uses (E2007, rule names in details).
 */
export function LabelsUnitsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('users');
  const { t: tc } = useTranslation('common');
  const [tab, setTab] = useState<Tab>('labels');
  const labels = useJobLabels();
  const units = useUnits();
  const { createLabel, renameLabel, createUnit, renameUnit, deleteLabel, deleteUnit, setLabelScope, setUnitScope } =
    useOrgMutations();
  // Province suggestions = the tenant's province → region map (PLN-261022); empty is fine (free entry).
  const tenantKey = useTenantKey();
  const aiConfig = useQuery({ queryKey: ['ai-config', tenantKey], queryFn: aiSettingsService.getConfig, enabled: open });
  const provinceOptions = Object.keys(aiConfig.data?.handoffConfig?.provinceRegions ?? {});

  const rows: Row[] = tab === 'labels' ? (labels.data ?? []) : (units.data ?? []);
  const loading = tab === 'labels' ? labels.isLoading : units.isLoading;
  const rename = tab === 'labels' ? renameLabel : renameUnit;
  const create = tab === 'labels' ? createLabel : createUnit;
  const remove = tab === 'labels' ? deleteLabel : deleteUnit;
  const setScope = tab === 'labels' ? setLabelScope : setUnitScope;

  // Draft names keyed by row id; a row is "dirty" when its draft differs.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  // The row awaiting delete confirmation; the modal body shows the confirm panel meanwhile.
  const [pendingDelete, setPendingDelete] = useState<Row | null>(null);
  // The row whose covered places are being edited (one at a time).
  const [scopeRowId, setScopeRowId] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setDrafts({});
    setNewCode('');
    setNewName('');
    setPendingDelete(null);
    setScopeRowId(null);
  }, [open, tab]);

  const onSaveScope = async (r: Row, next: RegionScopeBody) => {
    try {
      await setScope.mutateAsync({ id: r.id, ...next });
      setScopeRowId(null);
      toast.success(t('scopeSaved', { name: r.name }));
    } catch (e) {
      toast.error((e as Error).message || t('scopeSaveError'), { sticky: true });
    }
  };

  const draftOf = (r: Row) => drafts[r.id] ?? r.name;
  const dirty = (r: Row) => draftOf(r).trim() !== r.name && draftOf(r).trim().length > 0;

  const onRename = async (r: Row) => {
    const name = draftOf(r).trim();
    try {
      await rename.mutateAsync({ id: r.id, name });
      setDrafts((d) => {
        const next = { ...d };
        delete next[r.id];
        return next;
      });
      toast.success(t('orgRenamed', { name }));
    } catch (e) {
      toast.error((e as Error).message || t('orgSaveError'), { sticky: true });
    }
  };

  // The permission labels are never deletable (the server refuses too, E2006).
  const deleteLocked = (r: Row) => tab === 'labels' && PERMISSION_LABEL_CODES.has(r.code);
  const deleteHint = (r: Row) => (deleteLocked(r) ? t('permissionLabelNoDelete') : tc('delete'));
  const onDelete = async (r: Row) => {
    try {
      await remove.mutateAsync(r.id);
      setPendingDelete(null);
      toast.success(t('orgDeleted', { name: r.name }));
    } catch (e) {
      const err = e as Error & { code?: string; details?: Record<string, string[]> };
      setPendingDelete(null);
      const message =
        err.code === 'E2007'
          ? t('orgInUseByRule', { rules: (err.details?.rules ?? []).join(', ') })
          : err.code === 'E2006'
            ? t('permissionLabelNoDelete')
            : err.message || t('orgDeleteError');
      toast.error(message, { sticky: true });
    }
  };

  const codeValid = CODE_PATTERN.test(newCode);
  const codeTaken = rows.some((r) => r.code === newCode);
  const canAdd = codeValid && !codeTaken && newName.trim().length > 0 && newName.trim().length <= 64;
  const onAdd = async () => {
    if (!canAdd) return;
    const name = newName.trim();
    try {
      await create.mutateAsync({ code: newCode, name });
      setNewCode('');
      setNewName('');
      toast.success(t('orgCreated', { name }));
    } catch (e) {
      toast.error((e as Error).message || t('orgSaveError'), { sticky: true });
    }
  };

  const tabBtn = (key: Tab, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === key}
      onClick={() => setTab(key)}
      className={cn(
        'rounded-md px-3 py-1.5 text-sm font-medium',
        tab === key ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
      )}
    >
      {label}
    </button>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t('manageLabelsUnits')}
      footer={
        pendingDelete ? (
          <>
            <Button variant="ghost" disabled={remove.isPending} onClick={() => setPendingDelete(null)}>
              {tc('cancel')}
            </Button>
            <Button variant="danger" disabled={remove.isPending} onClick={() => onDelete(pendingDelete)}>
              {tc('delete')}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            {tc('close')}
          </Button>
        )
      }
    >
      {pendingDelete ? (
        <div role="alertdialog" aria-labelledby="org-delete-title" className="space-y-2 text-sm">
          <p id="org-delete-title" className="text-base font-semibold text-gray-900">
            {t('orgDeleteTitle', { name: pendingDelete.name })}
          </p>
          <p className="text-gray-700">{tab === 'labels' ? t('orgDeleteBodyLabel') : t('orgDeleteBodyUnit')}</p>
          {pendingDelete.memberCount > 0 && (
            <p className="text-gray-700">
              {tab === 'labels'
                ? t('orgDeleteReleaseLabel', { count: pendingDelete.memberCount })
                : t('orgDeleteReleaseUnit', { count: pendingDelete.memberCount })}
            </p>
          )}
          <p className="text-error">{t('orgDeleteIrreversible')}</p>
        </div>
      ) : (
        <>
          <div className="mb-3 flex gap-2" role="tablist">
            {tabBtn('labels', t('tabLabels'))}
            {tabBtn('units', t('tabUnits'))}
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('code')}</th>
                  <th className="px-3 py-2 font-medium">{t('name')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={3} className="px-3 py-3 text-gray-400">
                      {tc('loading')}
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={3} className="px-3 py-3 text-gray-400">
                      {tab === 'labels' ? t('noJobLabels') : t('noUnits')}
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <Fragment key={r.id}>
                  <tr className="border-t border-gray-100">
                    <td className="px-3 py-2 align-top font-mono text-xs text-gray-600">{r.code}</td>
                    <td className="px-3 py-2">
                      <Input
                        value={draftOf(r)}
                        maxLength={64}
                        onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && dirty(r)) void onRename(r);
                        }}
                      />
                      <div className="mt-1 flex items-center gap-1.5">
                        <MapPin className="h-3 w-3 text-gray-400" aria-hidden />
                        <RegionScopeSummary regions={r.regions ?? []} provinces={r.provinces ?? []} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        {tab === 'labels' && PERMISSION_LABEL_CODES.has(r.code) && (
                          <Badge tone="info">{t('permissionLinked')}</Badge>
                        )}
                        {r.memberCount > 0 && (
                          <span className="whitespace-nowrap text-xs text-gray-400">
                            {t('orgMembers', { count: r.memberCount })}
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={!dirty(r) || rename.isPending}
                          onClick={() => onRename(r)}
                        >
                          {tc('save')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-expanded={scopeRowId === r.id}
                          onClick={() => setScopeRowId(scopeRowId === r.id ? null : r.id)}
                        >
                          {t('scopeEdit')}
                        </Button>
                        <button
                          type="button"
                          aria-label={deleteHint(r)}
                          title={deleteHint(r)}
                          disabled={deleteLocked(r)}
                          onClick={() => setPendingDelete(r)}
                          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-error disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {scopeRowId === r.id && (
                    <tr className="bg-gray-50/60">
                      <td colSpan={3} className="px-3 pb-3">
                        <RegionScopeEditor
                          initial={{ regions: r.regions ?? [], provinces: r.provinces ?? [] }}
                          provinceOptions={provinceOptions}
                          saving={setScope.isPending}
                          onSave={(next) => void onSaveScope(r, next)}
                          onCancel={() => setScopeRowId(null)}
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
                <tr className="border-t border-gray-200 bg-gray-50/60">
                  <td className="px-3 py-2">
                    <Input
                      value={newCode}
                      placeholder={t('codePlaceholder')}
                      maxLength={24}
                      aria-label={t('code')}
                      onChange={(e) => setNewCode(e.target.value.trim().toLowerCase())}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      value={newName}
                      placeholder={t('namePlaceholder')}
                      maxLength={64}
                      aria-label={t('name')}
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void onAdd();
                      }}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" disabled={!canAdd || create.isPending} onClick={onAdd}>
                      {t('add')}
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {newCode && !codeValid && <p className="mt-1 text-xs text-error">{t('codeInvalid')}</p>}
          {codeTaken && <p className="mt-1 text-xs text-error">{t('codeTaken')}</p>}
          <p className="mt-3 text-xs text-gray-400">{t('codeHint')}</p>
          {tab === 'labels' && <p className="mt-1 text-xs text-gray-400">{t('permissionHint')}</p>}
        </>
      )}
    </Modal>
  );
}
