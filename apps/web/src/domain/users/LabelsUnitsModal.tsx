import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Input } from '@/components/Field';
import { Modal } from '@/components/Modal';
import { cn } from '@/lib/cn';
import { toast } from '@/store/toast-store';
import { useJobLabels, useOrgMutations, useUnits } from './users.hooks';

/** The three label codes the permission matrix keys on (permission-matrix.ts). */
const PERMISSION_LABEL_CODES = new Set(['consult', 'accounting', 'operations']);
const CODE_PATTERN = /^[a-z0-9_]{1,24}$/;

type Tab = 'labels' | 'units';
type Row = { id: string; code: string; name: string };

/**
 * Per-tenant job labels and units: rename in place, add at the bottom
 * (PLN-261019-Users-Unit-Labels-Routing-Conditions P2, wireframe 4-3).
 * Codes never change and nothing is deleted — a label code is the permission
 * axis and a unit has members.
 */
export function LabelsUnitsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('users');
  const { t: tc } = useTranslation('common');
  const [tab, setTab] = useState<Tab>('labels');
  const labels = useJobLabels();
  const units = useUnits();
  const { createLabel, renameLabel, createUnit, renameUnit } = useOrgMutations();

  const rows: Row[] = tab === 'labels' ? (labels.data ?? []) : (units.data ?? []);
  const loading = tab === 'labels' ? labels.isLoading : units.isLoading;
  const rename = tab === 'labels' ? renameLabel : renameUnit;
  const create = tab === 'labels' ? createLabel : createUnit;

  // Draft names keyed by row id; a row is "dirty" when its draft differs.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  useEffect(() => {
    if (!open) return;
    setDrafts({});
    setNewCode('');
    setNewName('');
  }, [open, tab]);

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
        <Button variant="ghost" onClick={onClose}>
          {tc('close')}
        </Button>
      }
    >
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
              <tr key={r.id} className="border-t border-gray-100">
                <td className="px-3 py-2 font-mono text-xs text-gray-600">{r.code}</td>
                <td className="px-3 py-2">
                  <Input
                    value={draftOf(r)}
                    maxLength={64}
                    onChange={(e) => setDrafts((d) => ({ ...d, [r.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && dirty(r)) void onRename(r);
                    }}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-2">
                    {tab === 'labels' && PERMISSION_LABEL_CODES.has(r.code) && (
                      <Badge tone="info">{t('permissionLinked')}</Badge>
                    )}
                    <Button size="sm" variant="secondary" disabled={!dirty(r) || rename.isPending} onClick={() => onRename(r)}>
                      {tc('save')}
                    </Button>
                  </div>
                </td>
              </tr>
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
    </Modal>
  );
}
