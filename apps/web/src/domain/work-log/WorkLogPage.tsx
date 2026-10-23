import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Table } from '@/components/Table';
import type { Column } from '@/components/Table';
import { Pagination } from '@/components/Pagination';
import { FormRow, Input, Select } from '@/components/Field';
import { useUsers } from '@/domain/users/users.hooks';
import { useWorkLog } from './work-log.hooks';
import { AGENT_ACTIONS, HOST_ACTIONS } from './work-log.service';
import type { WorkLogEntry } from './work-log.service';

const PAGE_SIZE = 20;

function fmtTime(value?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

/** `conversation:77` → `conversation 77`, so the column reads as prose. */
function fmtTarget(target?: string | null): string {
  if (!target) return '—';
  const [kind, id] = target.split(':');
  return id ? `${kind} ${id}` : target;
}

/**
 * Agent work log (SCR-104 §3). A filtered view of the audit trail — the same
 * store the platform audit page reads — so console actions land here without
 * a second write path.
 */
export function WorkLogPage() {
  const { t } = useTranslation('workLog');
  const { t: tc } = useTranslation('common');

  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const users = useUsers();
  const { data, isLoading, error } = useWorkLog({
    page,
    pageSize: PAGE_SIZE,
    action: action || undefined,
    actorId: actorId || undefined,
    from: from || undefined,
    to: to || undefined,
  });

  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const columns: Column<WorkLogEntry>[] = [
    { key: 'createdAt', header: t('time'), render: (r) => fmtTime(r.createdAt) },
    {
      key: 'actor',
      header: t('agent'),
      render: (r) =>
        r.actorType === 'host' ? (
          // A Hotel Admin user (PLN-261022 P6): the name comes from the session it
          // signed in on; a claimed (unsigned) sign-in says so.
          <span className="flex flex-wrap items-center gap-1">
            <span>{r.actorName ?? t('hostUser')}</span>
            <Badge tone="gray">{t('hostBadge')}</Badge>
            {r.metadata?.level === 'claimed' && <Badge tone="warning">{t('unverified')}</Badge>}
          </span>
        ) : (
          r.actorName ?? (r.actorId ? `#${r.actorId}` : '—')
        ),
    },
    {
      key: 'action',
      header: t('action'),
      // Unknown/legacy actions fall back to the raw key rather than a blank
      // cell, so an action added server-side is still readable here.
      render: (r) => <Badge tone="info">{t(`actions.${r.action}`, { defaultValue: r.action })}</Badge>,
    },
    { key: 'target', header: t('target'), render: (r) => <span className="font-mono text-xs">{fmtTarget(r.target)}</span> },
    {
      key: 'result',
      header: t('result'),
      render: (r) =>
        r.result === 'success' ? (
          <Badge tone="success">{t('success')}</Badge>
        ) : (
          <Badge tone="error">{r.result ?? '—'}</Badge>
        ),
    },
  ];

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <FormRow label={t('from')}>
            <Input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
          </FormRow>
          <FormRow label={t('to')}>
            <Input type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} />
          </FormRow>
          <FormRow label={t('agent')}>
            <Select value={actorId} onChange={(e) => reset(setActorId)(e.target.value)}>
              <option value="">{tc('all')}</option>
              {(users.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || u.email}
                </option>
              ))}
            </Select>
          </FormRow>
          <FormRow label={t('action')}>
            <Select value={action} onChange={(e) => reset(setAction)(e.target.value)}>
              <option value="">{t('allActions')}</option>
              {[...AGENT_ACTIONS, ...HOST_ACTIONS].map((a) => (
                <option key={a} value={a}>
                  {t(`actions.${a}`, { defaultValue: a })}
                </option>
              ))}
            </Select>
          </FormRow>
        </div>
      </Card>

      <Table
        columns={columns}
        data={data?.items}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        emptyMessage={t('empty')}
        rowKey={(r) => r.id}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPageChange={setPage} />

      <p className="mt-3 text-xs text-gray-400">{t('notice')}</p>
    </div>
  );
}
