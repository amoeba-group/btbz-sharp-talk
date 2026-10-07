import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Table } from '@/components/Table';
import type { Column } from '@/components/Table';
import { Modal } from '@/components/Modal';
import { FormRow, Input, Select } from '@/components/Field';
import { EngineHealthBadge, isEngineFailing, shortTime } from '@/components/EngineHealthBadge';
import {
  useEngines,
  useCreateEngine,
  useUpdateEngine,
  useSetEngineEnabled,
  useTestEngine,
} from './admin.hooks';
import type { AiEngine } from './admin.service';

const PROVIDERS = ['openai', 'anthropic', 'google', 'azure'];

type OwnerFilter = 'all' | 'platform' | 'tenant';

/**
 * Platform AI engine catalog (FR-070) + health (PLN-261007 S7).
 *
 * Tenant engines are listed too, with their owner: the 2026-10-06 go2joy
 * credit outage was a tenant engine, and nothing on this page showed it.
 * The banner names every engine that cannot answer right now.
 */
export function AiEnginesPage() {
  const { t } = useTranslation('aiEngines');
  const { t: tc } = useTranslation('common');
  const { data, isLoading, error } = useEngines();
  const createEngine = useCreateEngine();
  const updateEngine = useUpdateEngine();
  const setEnabled = useSetEngineEnabled();
  const testEngine = useTestEngine();

  const [owner, setOwner] = useState<OwnerFilter>('all');
  const [failingOnly, setFailingOnly] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');

  const [editing, setEditing] = useState<AiEngine | null>(null);
  const [editName, setEditName] = useState('');
  const [editModel, setEditModel] = useState('');
  const [editApiKey, setEditApiKey] = useState('');
  const [editSelectable, setEditSelectable] = useState(false);

  const failing = useMemo(() => (data ?? []).filter((e) => e.enabled && isEngineFailing(e.health)), [data]);
  const credit = failing.filter((e) => e.health === 'credit');

  const rows = useMemo(
    () =>
      (data ?? [])
        .filter((e) => (owner === 'all' ? true : owner === 'platform' ? e.tenantId == null : e.tenantId != null))
        .filter((e) => (failingOnly ? isEngineFailing(e.health) || e.todayFailures > 0 : true)),
    [data, owner, failingOnly],
  );

  const resetCreate = () => {
    setName('');
    setProvider(PROVIDERS[0]);
    setModel('');
    setApiKey('');
  };

  const handleCreate = () => {
    createEngine.mutate(
      { name, provider, model, apiKey },
      {
        onSuccess: () => {
          setCreateOpen(false);
          resetCreate();
        },
      },
    );
  };

  const openEdit = (engine: AiEngine) => {
    setEditing(engine);
    setEditName(engine.name);
    setEditModel(engine.model ?? '');
    setEditApiKey('');
    setEditSelectable(engine.tenantSelectable);
  };

  const handleUpdate = () => {
    if (!editing) return;
    const body: { name?: string; model?: string; apiKey?: string; tenantSelectable?: boolean } = {
      name: editName,
      model: editModel,
    };
    if (editApiKey) body.apiKey = editApiKey;
    if (editing.tenantId == null && editing.provider !== 'stub') body.tenantSelectable = editSelectable;
    updateEngine.mutate({ id: editing.id, body }, { onSuccess: () => setEditing(null) });
  };

  const ownerLabel = (e: AiEngine) => (e.tenantId == null ? t('owner.platform') : (e.tenantSlug ?? `#${e.tenantId}`));

  const columns: Column<AiEngine>[] = [
    {
      key: 'name',
      header: t('name'),
      render: (r) => (
        <div className="min-w-0">
          <div className="font-medium">{r.name}</div>
          {isEngineFailing(r.health) && r.lastErrorDetail ? (
            <div className="max-w-md break-all text-xs text-red-600">{r.lastErrorDetail}</div>
          ) : null}
        </div>
      ),
    },
    {
      key: 'owner',
      header: t('owner.title'),
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1">
          <span>{ownerLabel(r)}</span>
          {r.isDefault ? <Badge tone="primary">{t('default')}</Badge> : null}
          {r.tenantId == null && r.tenantSelectable ? <Badge tone="info">{t('selectableBadge')}</Badge> : null}
        </div>
      ),
    },
    {
      key: 'model',
      header: t('model'),
      render: (r) => (
        <span className="text-xs">
          {r.provider ?? '—'} / {r.model ?? '—'}
        </span>
      ),
    },
    {
      key: 'health',
      header: t('status'),
      render: (r) => <EngineHealthBadge health={r.enabled ? r.health : 'disabled'} />,
    },
    { key: 'lastOk', header: t('lastOk'), render: (r) => shortTime(r.lastOkAt) },
    { key: 'lastError', header: t('lastError'), render: (r) => shortTime(r.lastErrorAt) },
    {
      key: 'today',
      header: t('today'),
      render: (r) => (
        <span className={r.todayFailures > 0 ? 'text-red-600' : ''}>
          {r.todayCalls} / {r.todayFailures}
        </span>
      ),
    },
    { key: 'apiKey', header: t('apiKey'), render: (r) => (r.hasKey ? '••••••••' : '—') },
    {
      key: 'actions',
      header: '',
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          {r.provider !== 'stub' ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={testEngine.isPending}
              onClick={() => testEngine.mutate(r.id)}
            >
              {t('test.button')}
            </Button>
          ) : null}
          <Button variant="secondary" size="sm" onClick={() => openEdit(r)}>
            {tc('edit')}
          </Button>
          <Button
            variant={r.enabled ? 'danger' : 'secondary'}
            size="sm"
            disabled={setEnabled.isPending}
            onClick={() => setEnabled.mutate({ id: r.id, enabled: !r.enabled })}
          >
            {r.enabled ? t('disable') : t('enable')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t('title')}
        action={<Button onClick={() => setCreateOpen(true)}>{t('addEngine')}</Button>}
      />

      {failing.length ? (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          <p className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            {credit.length
              ? t('banner.credit', { count: credit.length })
              : t('banner.failing', { count: failing.length })}
          </p>
          <ul className="mt-2 space-y-1">
            {failing.map((e) => (
              <li key={e.id}>
                · {e.name} — {ownerLabel(e)} — {t(`health.${e.health}`)} — {t('lastError')}{' '}
                {shortTime(e.lastErrorAt)}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">{credit.length ? t('banner.creditAction') : t('banner.failingAction')}</p>
        </div>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {(['all', 'platform', 'tenant'] as OwnerFilter[]).map((o) => (
          <Button key={o} size="sm" variant={owner === o ? 'primary' : 'secondary'} onClick={() => setOwner(o)}>
            {t(`filter.${o}`)}
          </Button>
        ))}
        <label className="ml-2 flex items-center gap-1 text-gray-600">
          <input type="checkbox" checked={failingOnly} onChange={(e) => setFailingOnly(e.target.checked)} />
          {t('filter.failingOnly')}
        </label>
      </div>

      <Table
        columns={columns}
        data={rows}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        rowKey={(r) => r.id}
        emptyMessage={t('empty')}
      />

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('addEngine')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={createEngine.isPending || !name || !model || !apiKey}>
              {tc('create')}
            </Button>
          </>
        }
      >
        <FormRow label={t('name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </FormRow>
        <FormRow label={t('provider')}>
          <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </FormRow>
        <FormRow label={t('model')}>
          <Input value={model} onChange={(e) => setModel(e.target.value)} autoComplete="off" />
        </FormRow>
        <FormRow label={t('apiKey')}>
          {/* `new-password`: Chrome ignores `off` on password fields and offers the console login. */}
          <Input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="new-password"
            name="admin-ai-engine-api-key"
            data-1p-ignore
            data-lpignore="true"
          />
        </FormRow>
      </Modal>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={t('editEngine')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)}>
              {tc('cancel')}
            </Button>
            <Button onClick={handleUpdate} disabled={updateEngine.isPending || !editName}>
              {tc('save')}
            </Button>
          </>
        }
      >
        <FormRow label={t('name')}>
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} autoComplete="off" />
        </FormRow>
        <FormRow label={t('model')}>
          <Input value={editModel} onChange={(e) => setEditModel(e.target.value)} autoComplete="off" />
        </FormRow>
        <FormRow label={t('apiKeyEdit')}>
          <Input
            type="password"
            value={editApiKey}
            onChange={(e) => setEditApiKey(e.target.value)}
            autoComplete="new-password"
            name="admin-ai-engine-api-key-edit"
            data-1p-ignore
            data-lpignore="true"
          />
        </FormRow>
        {editing && editing.tenantId == null && editing.provider !== 'stub' ? (
          <FormRow label={t('selectable.label')}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editSelectable}
                onChange={(e) => setEditSelectable(e.target.checked)}
              />
              {t('selectable.toggle')}
            </label>
            <p className="mt-1 text-xs text-gray-500">{t('selectable.hint')}</p>
          </FormRow>
        ) : null}
      </Modal>
    </div>
  );
}
