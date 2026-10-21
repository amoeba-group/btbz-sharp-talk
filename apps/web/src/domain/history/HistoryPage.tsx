import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { StatusBadge } from '@/components/StatusBadge';
import { Table } from '@/components/Table';
import type { Column } from '@/components/Table';
import { Pagination } from '@/components/Pagination';
import { Modal } from '@/components/Modal';
import { FormRow, Input, Select } from '@/components/Field';
import { useUsers } from '@/domain/users/users.hooks';
import { useConversations } from './history.hooks';
import { ConversationTranscript } from './ConversationTranscript';
import type { ConversationRow } from './history.service';

const PAGE_SIZE = 20;

type StatusFilter = '' | 'open' | 'resolved' | 'escalated' | 'ended';
type EscalatedFilter = 'all' | 'yes' | 'no';

function fmtDate(value?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export function HistoryPage() {
  const { t } = useTranslation('history');
  const { t: tc } = useTranslation('common');
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<StatusFilter>('');
  const [escalated, setEscalated] = useState<EscalatedFilter>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [agentId, setAgentId] = useState('');
  const [includePreview, setIncludePreview] = useState(false);
  const [segment, setSegment] = useState<'' | 'b2b' | 'b2c'>('');
  // Draft vs applied: typing in the search box must not refire a query (and an
  // audit-free but still paginated one) on every keystroke.
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ConversationRow | null>(null);

  const users = useUsers();
  const agents = (users.data ?? []).filter(
    (u) => u.labelCodes?.includes('consult') && u.status !== 'inactive',
  );

  const { data, isLoading, error } = useConversations({
    page,
    pageSize: PAGE_SIZE,
    status: status || undefined,
    escalated: escalated === 'all' ? undefined : escalated === 'yes',
    from: from || undefined,
    to: to || undefined,
    agentId: agentId || undefined,
    q: search || undefined,
    includePreview,
    segment: segment || undefined,
  });

  const reset = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const selectedAgent = agents.find((a) => a.id === agentId);

  const columns: Column<ConversationRow>[] = [
    { key: 'id', header: t('id'), render: (r) => <span className="font-mono">{r.id.slice(0, 8)}</span> },
    { key: 'customer', header: t('customer'), render: (r) => r.customerName ?? '—' },
    { key: 'agent', header: t('agent'), render: (r) => r.agentName ?? '—' },
    { key: 'status', header: t('status'), render: (r) => <StatusBadge status={r.status} /> },
    {
      key: 'escalated',
      header: t('escalated'),
      render: (r) =>
        r.escalated ? <Badge tone="error">{tc('yes')}</Badge> : <Badge tone="gray">{tc('no')}</Badge>,
    },
    {
      key: 'channel',
      header: t('channel'),
      render: (r) =>
        r.channel === 'preview' ? <Badge tone="warning">{t('previewChannel')}</Badge> : (r.channel ?? '—'),
    },
    { key: 'messages', header: t('messages'), render: (r) => r.messageCount ?? 0 },
    { key: 'startedAt', header: t('started'), render: (r) => fmtDate(r.startedAt) },
    { key: 'endedAt', header: t('ended'), render: (r) => fmtDate(r.endedAt) },
  ];

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <Card className="mb-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <FormRow label={t('from')}>
            <Input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
          </FormRow>
          <FormRow label={t('to')}>
            <Input type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} />
          </FormRow>
          <FormRow label={t('agent')}>
            <Select value={agentId} onChange={(e) => reset(setAgentId)(e.target.value)}>
              <option value="">{t('allAgents')}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name || a.email}
                </option>
              ))}
            </Select>
          </FormRow>
          <FormRow label={t('status')}>
            <Select
              value={status}
              onChange={(e) => reset(setStatus)(e.target.value as StatusFilter)}
            >
              <option value="">{t('allStatuses')}</option>
              <option value="open">{t('open')}</option>
              <option value="resolved">{t('resolved')}</option>
              <option value="escalated">{t('escalated')}</option>
              <option value="ended">{t('ended_status')}</option>
            </Select>
          </FormRow>
          <FormRow label={t('escalated')}>
            <Select
              value={escalated}
              onChange={(e) => reset(setEscalated)(e.target.value as EscalatedFilter)}
            >
              <option value="all">{tc('all')}</option>
              <option value="yes">{tc('yes')}</option>
              <option value="no">{tc('no')}</option>
            </Select>
          </FormRow>
          <FormRow label={t('segment')}>
            <Select value={segment} onChange={(e) => reset(setSegment)(e.target.value as '' | 'b2b' | 'b2c')}>
              <option value="">{tc('all')}</option>
              <option value="b2b">{t('segmentB2b')}</option>
              <option value="b2c">{t('segmentB2c')}</option>
            </Select>
          </FormRow>
          <FormRow label={t('searchMessages')}>
            <div className="flex gap-2">
              <Input
                value={searchDraft}
                placeholder={t('searchPlaceholder')}
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    setSearch(searchDraft.trim());
                    setPage(1);
                  }
                }}
              />
              <Button
                size="sm"
                onClick={() => {
                  setSearch(searchDraft.trim());
                  setPage(1);
                }}
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>
          </FormRow>
        </div>

        <label className="mt-3 flex items-center gap-2 text-xs text-gray-500">
          <input
            type="checkbox"
            checked={includePreview}
            onChange={(e) => reset(setIncludePreview)(e.target.checked)}
          />
          {t('includePreview')}
        </label>
      </Card>

      {selectedAgent && (
        <Card className="mb-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-gray-700">
              <span className="font-medium">{selectedAgent.name || selectedAgent.email}</span>
              {' · '}
              {t('agentTotal', { count: data?.total ?? 0 })}
            </span>
            <Button size="sm" variant="ghost" onClick={() => reset(setAgentId)('')}>
              {tc('clear')}
            </Button>
          </div>
        </Card>
      )}

      <Table
        columns={columns}
        data={data?.items}
        loading={isLoading}
        error={error ? (error as Error).message : null}
        emptyMessage={t('empty')}
        rowKey={(r) => r.id}
        onRowClick={(r) => setSelected(r)}
      />

      <Pagination page={page} pageSize={PAGE_SIZE} total={data?.total ?? 0} onPageChange={setPage} />

      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${t('detailTitle')} · ${selected.id.slice(0, 8)}` : t('detailTitle')}
        size="lg"
      >
        {selected && (
          <ConversationTranscript
            conversationId={selected.id}
            onOpenSource={(documentId) => navigate(`/knowledge?doc=${documentId}`)}
          />
        )}
      </Modal>
    </div>
  );
}
