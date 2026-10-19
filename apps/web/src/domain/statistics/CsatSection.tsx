import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Star } from 'lucide-react';
import { Card } from '@/components/Card';
import { Table } from '@/components/Table';
import type { Column } from '@/components/Table';
import { Pagination } from '@/components/Pagination';
import { useCsatAgents, useCsatConversations, useCsatSummary } from './statistics.hooks';
import type { CsatAgentRow, CsatConversationRow } from './statistics.service';

const PAGE_SIZE = 20;

/** ★4.2-style score; em-dash when nothing was rated. */
function score(avg: number | null | undefined): string {
  return avg == null ? '—' : avg.toFixed(2);
}

/**
 * Satisfaction statistics (PLN-260826-Dashboard-Integration-CSAT-Stats):
 * ratings collected by the widget at session end, viewed as a summary, a
 * per-agent table and a per-conversation list. The window (from/to) is owned
 * by the page — shared with the question-stats section.
 */
export function CsatSection({ from, to }: { from: string; to: string }) {
  const { t } = useTranslation('statistics');
  const navigate = useNavigate();

  const [rating, setRating] = useState('');
  const [agentId, setAgentId] = useState('');
  const [page, setPage] = useState(1);

  const summary = useCsatSummary(from, to);
  const agents = useCsatAgents(from, to);
  const conversations = useCsatConversations({
    from,
    to,
    rating: rating || undefined,
    agentId: agentId || undefined,
    page,
    size: PAGE_SIZE,
  });

  const dist = summary.data?.distribution;
  const maxBucket = dist ? Math.max(1, ...Object.values(dist)) : 1;
  const responseRate =
    summary.data && summary.data.ended > 0
      ? `${((summary.data.rated / summary.data.ended) * 100).toFixed(0)}%`
      : '—';

  const agentColumns: Column<CsatAgentRow>[] = [
    {
      key: 'agent',
      header: t('csat.agent'),
      render: (r) => (
        <span className={r.agentName ? 'text-gray-800' : 'text-gray-400'}>
          {r.agentName ?? t('csat.unassigned')}
        </span>
      ),
    },
    {
      key: 'rated',
      header: t('csat.rated'),
      render: (r) => <span className="tabular-nums">{r.rated}</span>,
    },
    {
      key: 'avg',
      header: t('csat.avg'),
      render: (r) => (
        <span className="flex items-center gap-1 tabular-nums">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          {score(r.avg)}
        </span>
      ),
    },
  ];

  const convColumns: Column<CsatConversationRow>[] = [
    {
      key: 'endedAt',
      header: t('csat.endedAt'),
      className: 'whitespace-nowrap',
      render: (r) => (r.endedAt ? new Date(r.endedAt).toLocaleDateString() : '—'),
    },
    {
      key: 'session',
      header: t('csat.session'),
      render: (r) => (
        <span className="text-gray-800">
          {r.alias || r.customerName || t('csat.sessionLabel', { id: String(r.id).slice(0, 6) })}
        </span>
      ),
    },
    {
      key: 'agent',
      header: t('csat.agent'),
      render: (r) => (
        <span className={r.agentName ? '' : 'text-gray-400'}>{r.agentName ?? '—'}</span>
      ),
    },
    {
      key: 'channel',
      header: t('csat.channel'),
      render: (r) => <span className="text-gray-500">{r.channel}</span>,
    },
    {
      key: 'rating',
      header: t('csat.rating'),
      render: (r) => (
        <span className="flex items-center gap-1 tabular-nums">
          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
          {r.rating ?? '—'}
        </span>
      ),
    },
    // Survey answers (PLN-261019); '—' on rating-mode rows.
    {
      key: 'resolved',
      header: t('csat.resolved'),
      render: (r) =>
        r.resolved == null ? (
          <span className="text-gray-300">—</span>
        ) : (
          <span className={r.resolved ? 'text-success' : 'text-error'}>
            {t(r.resolved ? 'csat.resolvedYes' : 'csat.resolvedNo')}
          </span>
        ),
    },
    {
      key: 'reason',
      header: t('csat.reason'),
      render: (r) => (
        <span className="text-gray-600">{r.reason ? t(`csat.reasons.${r.reason}`, { defaultValue: r.reason }) : '—'}</span>
      ),
    },
    {
      key: 'comment',
      header: t('csat.comment'),
      className: 'max-w-[16rem]',
      render: (r) => <span className="block truncate text-gray-500" title={r.comment ?? ''}>{r.comment ?? '—'}</span>,
    },
  ];
  const resolvedCounts = summary.data?.resolved;
  const reasons = summary.data?.reasons ?? {};
  const reasonTotal = Object.values(reasons).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card>
          <p className="text-xs text-gray-500">{t('csat.avgTitle')}</p>
          <p className="mt-1 flex items-center gap-1.5 text-2xl font-semibold text-gray-900">
            <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
            {score(summary.data?.avg)}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-gray-500">{t('csat.ratedTitle')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">
            {summary.data?.rated ?? '—'}
          </p>
        </Card>
        <Card>
          <p className="text-xs text-gray-500">{t('csat.responseRateTitle')}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{responseRate}</p>
          <p className="text-[11px] text-gray-400">
            {t('csat.responseRateHint', { ended: summary.data?.ended ?? 0 })}
          </p>
        </Card>
        <Card>
          <p className="mb-1 text-xs text-gray-500">{t('csat.distributionTitle')}</p>
          <div className="flex items-end gap-2">
            {(['1', '2', '3', '4', '5'] as const).map((k) => (
              <div key={k} className="flex flex-1 flex-col items-center gap-0.5">
                <span className="text-[10px] tabular-nums text-gray-500">{dist?.[k] ?? 0}</span>
                <div
                  className="w-full rounded-t bg-amber-400"
                  style={{ height: `${Math.round(((dist?.[k] ?? 0) / maxBucket) * 40) + 2}px` }}
                />
                <span className="text-[10px] text-gray-400">{k}★</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Survey mode (PLN-261019): shown once at least one survey answer exists. */}
      {((resolvedCounts && resolvedCounts.yes + resolvedCounts.no > 0) || reasonTotal > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <p className="text-xs text-gray-500">{t('csat.resolvedTitle')}</p>
            <p className="mt-1 text-sm text-gray-900">
              <span className="text-2xl font-semibold tabular-nums text-success">{resolvedCounts?.yes ?? 0}</span>{' '}
              <span className="text-gray-500">{t('csat.resolvedYes')}</span>
              <span className="mx-3 text-gray-300">|</span>
              <span className="text-2xl font-semibold tabular-nums text-error">{resolvedCounts?.no ?? 0}</span>{' '}
              <span className="text-gray-500">{t('csat.resolvedNo')}</span>
            </p>
          </Card>
          <Card>
            <p className="mb-1 text-xs text-gray-500">{t('csat.reasonsTitle')}</p>
            <ul className="space-y-1 text-sm">
              {Object.entries(reasons)
                .sort((a, b) => b[1] - a[1])
                .map(([k, n]) => (
                  <li key={k} className="flex items-center gap-2">
                    <span className="w-40 truncate text-gray-700">{t(`csat.reasons.${k}`, { defaultValue: k })}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded bg-gray-100">
                      <div className="h-full bg-error/70" style={{ width: `${reasonTotal ? Math.round((n / reasonTotal) * 100) : 0}%` }} />
                    </div>
                    <span className="w-12 text-right tabular-nums text-gray-500">{reasonTotal ? Math.round((n / reasonTotal) * 100) : 0}%</span>
                  </li>
                ))}
            </ul>
          </Card>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <Card className="xl:col-span-2" title={t('csat.byAgentTitle')}>
          <Table<CsatAgentRow>
            columns={agentColumns}
            data={agents.data}
            loading={agents.isLoading}
            error={agents.error ? (agents.error as Error).message : null}
            emptyMessage={t('csat.empty')}
            rowKey={(r) => String(r.agentId ?? 'none')}
          />
        </Card>

        <Card
          className="xl:col-span-3"
          title={t('csat.bySessionTitle')}
          action={
            <div className="flex items-center gap-2">
              <select
                value={rating}
                onChange={(e) => {
                  setRating(e.target.value);
                  setPage(1);
                }}
                aria-label={t('csat.ratingFilter')}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 outline-none focus:border-primary-400"
              >
                <option value="">{t('csat.ratingAll')}</option>
                {['5', '4', '3', '2', '1'].map((v) => (
                  <option key={v} value={v}>
                    {v}★
                  </option>
                ))}
              </select>
              <select
                value={agentId}
                onChange={(e) => {
                  setAgentId(e.target.value);
                  setPage(1);
                }}
                aria-label={t('csat.agentFilter')}
                className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 outline-none focus:border-primary-400"
              >
                <option value="">{t('csat.agentAll')}</option>
                {(agents.data ?? [])
                  .filter((a) => a.agentId != null)
                  .map((a) => (
                    <option key={a.agentId} value={String(a.agentId)}>
                      {a.agentName ?? a.agentId}
                    </option>
                  ))}
              </select>
            </div>
          }
        >
          <Table<CsatConversationRow>
            columns={convColumns}
            data={conversations.data?.items}
            loading={conversations.isLoading}
            error={conversations.error ? (conversations.error as Error).message : null}
            emptyMessage={t('csat.empty')}
            rowKey={(r) => String(r.id)}
            onRowClick={(r) => navigate(`/live-chat?conversation=${r.id}`)}
          />
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={conversations.data?.total ?? 0}
            onPageChange={setPage}
          />
        </Card>
      </div>
    </div>
  );
}
