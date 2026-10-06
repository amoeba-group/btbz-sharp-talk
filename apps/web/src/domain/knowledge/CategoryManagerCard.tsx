import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Modal } from '@/components/Modal';
import { FormRow, Input, Select } from '@/components/Field';
import { Globe, Lock } from 'lucide-react';
import { useAiAgents } from '../ai-settings/ai-agents.hooks';
import {
  useCategoryRows,
  useSetCategoryAgents,
  useCreateCategory,
  useMergeCategories,
  useRemoveCategory,
  useRenameCategory,
  useSetCategoryGuestVisible,
  useSetCategoryHidden,
} from './knowledge.hooks';
import type { KbCategoryRow } from './knowledge.service';

/**
 * Category management (PLN-260824 B축).
 *
 * Categories were always free text, so a tenant could already create them; what
 * was missing was every way to fix one afterwards. The list also carried
 * another shop's policy tags as suggestions — of the nineteen hardcoded ones,
 * one tenant used eighteen and another used one.
 *
 * Catalogue-derived rows are shown but locked. Product sync compares a
 * document's stored category to decide the document is unchanged, so a rename
 * there is undone at the next sync; refusing the edit is more honest than
 * explaining the bounce-back afterwards (D8).
 */
export function CategoryManagerCard() {
  const { t } = useTranslation('knowledge');
  const { t: tc } = useTranslation('common');
  // Group tab (PLN-260829 D2-a): every management action needs a group
  // context, so there is no "all" tab here — counsel is the landing tab.
  const [group, setGroup] = useState('counsel');
  const rows = useCategoryRows(group);
  const createCategory = useCreateCategory();
  const renameCategory = useRenameCategory();
  const mergeCategories = useMergeCategories();
  const setHidden = useSetCategoryHidden();
  const setGuestVisible = useSetCategoryGuestVisible();
  const setAgents = useSetCategoryAgents();
  // Only agents that can actually answer are offered: scoping a category to a
  // deactivated agent reads as a narrowing nobody satisfies.
  const agents = (useAiAgents().data ?? []).filter((a) => a.active);
  const removeCategory = useRemoveCategory();

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<KbCategoryRow | null>(null);
  const [renameTo, setRenameTo] = useState('');
  const [scoping, setScoping] = useState<KbCategoryRow | null>(null);
  const [scopeIds, setScopeIds] = useState<number[]>([]);
  const [merging, setMerging] = useState(false);
  const [mergeFrom, setMergeFrom] = useState<string[]>([]);
  const [mergeInto, setMergeInto] = useState('');

  const all = rows.data ?? [];
  const owned = all.filter((c) => c.origin !== 'catalog');
  const derived = all.filter((c) => c.origin === 'catalog');
  // A row id like `unregistered:faq` describes a string documents carry that no
  // row owns yet — it can be read but not acted on until it is registered.
  const editable = owned.filter((c) => !c.id.startsWith('unregistered:'));

  const row = (c: KbCategoryRow, locked: boolean) => (
    <li key={c.id} className="flex items-center gap-2 border-b border-gray-100 py-2 last:border-0">
      <span className="min-w-0 flex-1 truncate">
        {locked ? <Lock className="mr-1 inline h-3 w-3 text-gray-400" /> : null}
        <span className={c.hidden ? 'text-gray-400 line-through' : ''}>{c.label ?? c.name}</span>
        {c.label ? <span className="ml-1 text-xs text-gray-400">({c.name})</span> : null}
      </span>
      <Badge tone={c.documentCount ? 'gray' : 'warning'}>
        {t('categoryDocs', { count: c.documentCount })}
      </Badge>
      {/* Guest visibility (PLN-261001 W3): the one axis a login-guidance agent
          may answer an unidentified visitor from. Default off, and opening a
          category that already holds documents asks first — those documents
          become readable without signing in the moment this flips. */}
      {!locked && !c.id.startsWith('unregistered:') ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={setGuestVisible.isPending}
          title={t('categoryGuestVisibleHint')}
          aria-pressed={!!c.guestVisible}
          onClick={() => {
            const next = !c.guestVisible;
            if (
              next &&
              c.documentCount > 0 &&
              !window.confirm(t('categoryGuestVisibleConfirm', { count: c.documentCount }))
            ) {
              return;
            }
            setGuestVisible.mutate({ id: c.id, guestVisible: next });
          }}
        >
          <Globe
            className={`mr-1 inline h-3 w-3 ${c.guestVisible ? 'text-success' : 'text-gray-400'}`}
          />
          {c.guestVisible ? t('categoryGuestVisibleOnLabel') : t('categoryGuestVisibleOffLabel')}
        </Button>
      ) : null}
      {/* Agent scope (REQ-260826 R2). Hidden when the tenant runs a single
          agent — a choice with one option is noise, and most tenants have
          exactly one — but never hidden from a category that already carries a
          scope, or deactivating agents would strand a narrowing nobody can
          reach to undo. */}
      {(agents.length > 1 || (c.agentIds?.length ?? 0) > 0) &&
      !locked &&
      !c.id.startsWith('unregistered:') ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setScoping(c);
            setScopeIds(c.agentIds ?? []);
          }}
        >
          {c.agentIds?.length
            ? t('categoryAgentsSome', { count: c.agentIds.length, total: agents.length })
            : t('categoryAgentsAll')}
        </Button>
      ) : null}
      {!locked && !c.id.startsWith('unregistered:') ? (
        <>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setRenaming(c);
              setRenameTo(c.name);
            }}
          >
            {t('categoryRename')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setHidden.mutate({ id: c.id, hidden: !c.hidden })}
          >
            {c.hidden ? t('categoryShow') : t('categoryHide')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={c.documentCount > 0 || removeCategory.isPending}
            title={c.documentCount > 0 ? t('categoryDeleteBlocked') : undefined}
            onClick={() => removeCategory.mutate(c.id)}
          >
            {tc('delete')}
          </Button>
        </>
      ) : null}
    </li>
  );

  return (
    <Card
      title={t('categories')}
      action={
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => setMerging(true)}>
            {t('categoryMerge')}
          </Button>
          <Button size="sm" onClick={() => setAdding(true)}>
            {t('categoryAdd')}
          </Button>
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap gap-1 border-b border-gray-200">
        {(['counsel', 'product', 'operation'] as const).map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => {
              setGroup(g);
              // Selections are rows of the previous tab — stale ids would act
              // on a category the operator can no longer see.
              setMergeFrom([]);
              setMergeInto('');
              setRenaming(null);
              setScoping(null);
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              group === g
                ? 'border-primary-600 font-medium text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t(`group.${g}`)}
          </button>
        ))}
      </div>
      {rows.isLoading ? <p className="text-sm text-gray-500">{tc('loading')}</p> : null}
      {rows.error ? (
        <p className="text-sm text-red-600">{(rows.error as Error).message}</p>
      ) : null}

      {owned.length ? (
        <>
          <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">
            {t('categoryMine')}
          </h4>
          <ul className="mb-4 text-sm">{owned.map((c) => row(c, false))}</ul>
        </>
      ) : null}

      {derived.length ? (
        <>
          <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">
            {t('categoryFromCatalog')}
          </h4>
          <ul className="text-sm">{derived.map((c) => row(c, true))}</ul>
          <p className="mt-2 text-xs text-gray-500">{t('categoryFromCatalogHint')}</p>
        </>
      ) : null}

      {!rows.isLoading && !all.length ? (
        <p className="text-sm text-gray-500">{t('categoryEmpty')}</p>
      ) : null}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title={t('categoryAdd')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setAdding(false)}>
              {tc('cancel')}
            </Button>
            <Button
              disabled={!newName.trim() || createCategory.isPending}
              onClick={() =>
                createCategory.mutate(
                  { name: newName.trim(), doc_group: group },
                  {
                    onSuccess: () => {
                      setNewName('');
                      setAdding(false);
                    },
                  },
                )
              }
            >
              {tc('save')}
            </Button>
          </>
        }
      >
        <FormRow label={t('categoryName')}>
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={64} />
        </FormRow>
      </Modal>

      <Modal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title={t('categoryRename')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenaming(null)}>
              {tc('cancel')}
            </Button>
            <Button
              disabled={!renameTo.trim() || renameCategory.isPending}
              onClick={() =>
                renaming &&
                renameCategory.mutate(
                  { id: renaming.id, name: renameTo.trim() },
                  { onSuccess: () => setRenaming(null) },
                )
              }
            >
              {tc('save')}
            </Button>
          </>
        }
      >
        <FormRow label={t('categoryName')}>
          <Input value={renameTo} onChange={(e) => setRenameTo(e.target.value)} maxLength={64} />
        </FormRow>
        {/* Say how many documents move: the rename is not just a label edit. */}
        <p className="text-xs text-gray-500">
          {t('categoryRenameHint', { count: renaming?.documentCount ?? 0 })}
        </p>
      </Modal>

      <Modal
        open={merging}
        onClose={() => setMerging(false)}
        title={t('categoryMerge')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMerging(false)}>
              {tc('cancel')}
            </Button>
            <Button
              disabled={!mergeFrom.length || !mergeInto || mergeCategories.isPending}
              onClick={() =>
                mergeCategories.mutate(
                  { fromIds: mergeFrom, intoId: mergeInto },
                  {
                    onSuccess: () => {
                      setMergeFrom([]);
                      setMergeInto('');
                      setMerging(false);
                    },
                  },
                )
              }
            >
              {t('categoryMerge')}
            </Button>
          </>
        }
      >
        <FormRow label={t('categoryMergeFrom')}>
          <ul className="max-h-52 overflow-y-auto text-sm">
            {editable.map((c) => (
              <li key={c.id} className="py-1">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={mergeFrom.includes(c.id)}
                    onChange={(e) =>
                      setMergeFrom((prev) =>
                        e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id),
                      )
                    }
                  />
                  <span>{c.label ?? c.name}</span>
                  <span className="text-xs text-gray-500">
                    {t('categoryDocs', { count: c.documentCount })}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </FormRow>
        <FormRow label={t('categoryMergeInto')}>
          <Select value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
            <option value="">—</option>
            {editable
              .filter((c) => !mergeFrom.includes(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label ?? c.name}
                </option>
              ))}
          </Select>
        </FormRow>
        <p className="text-xs text-gray-500">{t('categoryMergeHint')}</p>
      </Modal>

      {/* Agent scope (REQ-260826 R2). Same radio + checkbox shape as the
          scenario-button scope in /ai-setting — an operator who has met one has
          met both, and the two mean the same thing: empty list = every agent. */}
      <Modal
        open={!!scoping}
        onClose={() => setScoping(null)}
        title={t('categoryAgentsTitle')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setScoping(null)}>
              {tc('cancel')}
            </Button>
            <Button
              disabled={setAgents.isPending}
              onClick={() =>
                scoping &&
                setAgents.mutate(
                  { id: scoping.id, agentIds: scopeIds },
                  { onSuccess: () => setScoping(null) },
                )
              }
            >
              {tc('save')}
            </Button>
          </>
        }
      >
        {scoping ? (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">
              {t('categoryAgentsHint', {
                name: scoping.label ?? scoping.name,
                count: scoping.documentCount,
              })}
            </p>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="radio" checked={scopeIds.length === 0} onChange={() => setScopeIds([])} />
              {t('categoryAgentsAllOption')}
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                checked={scopeIds.length > 0}
                onChange={() => {
                  const first = agents[0];
                  if (first) setScopeIds([first.id]);
                }}
              />
              {t('categoryAgentsSomeOption')}
            </label>
            <div className="ml-6 space-y-1">
              {agents.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={scopeIds.includes(a.id)}
                    onChange={(e) =>
                      setScopeIds((prev) =>
                        e.target.checked ? [...prev, a.id] : prev.filter((v) => v !== a.id),
                      )
                    }
                  />
                  {a.name}
                  {a.isDefault ? (
                    <span className="text-xs text-gray-400">{t('categoryAgentsDefault')}</span>
                  ) : null}
                </label>
              ))}
            </div>
            {/* Stated rather than left to be discovered: an agent added next
                month sees none of the scoped categories until someone comes
                back here. */}
            <p className="text-[11px] text-warning">{t('categoryAgentsNewAgentWarning')}</p>
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
