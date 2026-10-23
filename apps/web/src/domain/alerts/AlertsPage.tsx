import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { Select } from '@/components/Field';
import { Pagination } from '@/components/Pagination';
import { Table } from '@/components/Table';
import type { Column } from '@/components/Table';
import { useAckAlert } from '../live-chat/live-chat.hooks';
import type { AgentAlert } from '../live-chat/live-chat.service';
import { useRoutingCategories, useCategoryName } from '../routing-categories/routing-categories.hooks';
import { useAlarmCenter } from './alerts.hooks';
import type { AlarmCenterParams } from './alerts.service';
import { reasonKey, useAlarmText } from './alarm-format';
import { AlertSettingsModal } from './AlertSettingsModal';

const PAGE_SIZE = 20;

/**
 * Alarm center (PLN-261024, wireframe 2-3): every alarm of the tenant with whom
 * it was addressed to, who acknowledged it, and a jump to the conversation.
 * Reached from the header bell; gated like Live Chat (same path prefix).
 */
export function AlertsPage() {
  const { t } = useTranslation('livechat');
  const navigate = useNavigate();
  const [scope, setScope] = useState<NonNullable<AlarmCenterParams['scope']>>('all');
  const [status, setStatus] = useState<NonNullable<AlarmCenterParams['status']>>('all');
  const [days, setDays] = useState(7);
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { data, isLoading, error } = useAlarmCenter({ scope, status, days, category: category || undefined, page, size: PAGE_SIZE });
  const categories = useRoutingCategories();
  const categoryName = useCategoryName();
  const { assignee } = useAlarmText();
  const ack = useAckAlert();
  const { t: ta } = useTranslation('aiSetting');

  const when = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleString(undefined, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const filter = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const columns: Column<AgentAlert>[] = [
    { key: 'at', header: t('alarmCenter.col.at'), render: (a) => <span className="whitespace-nowrap text-xs text-gray-600">{when(a.createdAt)}</span> },
    { key: 'conv', header: t('alarmCenter.col.conversation'), render: (a) => <span className="font-medium">#{a.conversationId}</span> },
    {
      key: 'hotel',
      header: t('alarmCenter.col.customer'),
      render: (a) => (
        <span className="text-xs text-gray-700">
          {a.hotel ?? '—'}
          {a.region && <span className="ml-1 text-gray-400">· {ta(`handoff.routing.customer.value.region.${a.region}`, { defaultValue: a.region })}</span>}
        </span>
      ),
    },
    { key: 'cat', header: t('alarmCenter.col.category'), render: (a) => (a.consultCategory ? categoryName(a.consultCategory) : '—') },
    { key: 'reason', header: t('alarmCenter.col.reason'), render: (a) => <span className="text-xs">{t(reasonKey(a.reason))}</span> },
    {
      key: 'assignee',
      header: t('alarmCenter.col.assignee'),
      render: (a) => (
        <span className="flex items-center gap-1 text-xs">
          {assignee(a)}
          {a.assignedToMe && <Badge tone="primary">{t('alarmCenter.toMe')}</Badge>}
        </span>
      ),
    },
    { key: 'rule', header: t('alarmCenter.col.rule'), render: (a) => <span className="text-xs text-gray-500">{a.ruleName ?? '—'}</span> },
    {
      key: 'status',
      header: t('alarmCenter.col.status'),
      render: (a) =>
        a.status === 'new' ? (
          <span className="flex items-center gap-2">
            <Badge tone="warning">{t('alarmCenter.statusNew')}</Badge>
            {a.canAck && (
              <button
                type="button"
                className="text-xs text-primary-600 hover:underline"
                onClick={(e) => {
                  e.stopPropagation();
                  ack.mutate(a.id);
                }}
              >
                {t('alarmCenter.ack')}
              </button>
            )}
          </span>
        ) : (
          <span className="text-xs text-gray-500">
            {t('alarmCenter.statusAcked', { name: a.ackedBy?.name ?? '—' })} {when(a.ackedAt)}
          </span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t('alarmCenter.title')} subtitle={t('alarmCenter.subtitle')} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-md border border-gray-200 p-0.5">
          {(['all', 'mine', 'broadcast'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => filter(setScope)(s)}
              className={
                scope === s ? 'rounded bg-primary-500 px-3 py-1 text-xs font-medium text-white' : 'rounded px-3 py-1 text-xs text-gray-600 hover:bg-gray-50'
              }
            >
              {t(`alarmCenter.scope_${s}`)}
            </button>
          ))}
        </div>
        <div className="w-36">
          <Select aria-label={t('alarmCenter.col.status')} value={status} onChange={(e) => filter(setStatus)(e.target.value as typeof status)}>
            <option value="all">{t('alarmCenter.statusAll')}</option>
            <option value="new">{t('alarmCenter.statusNew')}</option>
            <option value="acked">{t('alarmCenter.statusAckedShort')}</option>
          </Select>
        </div>
        <div className="w-32">
          <Select aria-label={t('alarmCenter.period')} value={days} onChange={(e) => filter(setDays)(Number(e.target.value))}>
            {[1, 7, 30, 90].map((d) => (
              <option key={d} value={d}>
                {t(`alarmCenter.period_${d}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select aria-label={t('alarmCenter.col.category')} value={category} onChange={(e) => filter(setCategory)(e.target.value)}>
            <option value="">{t('alarmCenter.categoryAll')}</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.code} value={c.code}>
                {categoryName(c.code)}
              </option>
            ))}
          </Select>
        </div>
        <div className="ml-auto">
          <Button size="sm" variant="secondary" onClick={() => setSettingsOpen(true)}>
            <Settings className="h-4 w-4" /> {t('alarmCenter.settings.title')}
          </Button>
        </div>
      </div>
      <Table
        columns={columns}
        data={data?.items ?? []}
        loading={isLoading}
        error={error ? (error as Error).message : undefined}
        emptyMessage={t('alarmCenter.empty')}
        rowKey={(a) => a.id}
        onRowClick={(a) => navigate(`/live-chat?c=${a.conversationId}`)}
      />
      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPageChange={setPage} />
      <AlertSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
