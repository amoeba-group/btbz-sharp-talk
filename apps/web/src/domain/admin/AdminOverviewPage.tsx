import { useQuery } from '@tanstack/react-query';
import { Building2, CheckCircle2, Eye, MessageSquare, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { KpiCard } from '@/components/KpiCard';
import { StatusBadge } from '@/components/StatusBadge';
import { Table } from '@/components/Table';
import type { Column } from '@/components/Table';
import { DateRangePicker, useDateRange } from '@/components/DateRangePicker';
import { dashboardService } from '@/domain/dashboard/dashboard.service';
import { useTenants } from './admin.hooks';
import { adminService } from './admin.service';
import type { TenantJourneyRow } from './admin.service';

export function AdminOverviewPage() {
  const { t } = useTranslation('overview');
  const { t: tc } = useTranslation('common');
  const tenantsQuery = useTenants({ page: 1, pageSize: 20 });
  const integrationsQuery = useQuery({
    queryKey: ['admin', 'integrations'],
    queryFn: () => dashboardService.integrations(),
  });
  const dateRange = useDateRange('d30');
  const { from, to } = dateRange.range;
  const journeyQuery = useQuery({
    queryKey: ['admin', 'tenant-journey', from, to],
    queryFn: () => adminService.tenantJourney(from, to),
  });
  const rows = journeyQuery.data ?? [];
  // "Active" means used in this window, not merely existing — the number the
  // platform operator is actually asking for.
  const activeTenants = rows.filter((r) => r.impressions > 0 || r.conversations > 0).length;
  const totalImpressions = rows.reduce((n, r) => n + r.impressions, 0);
  const totalConversations = rows.reduce((n, r) => n + r.conversations, 0);
  const shown = (v: number) => (journeyQuery.isLoading ? '—' : v.toLocaleString());
  const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '—');

  const columns: Column<TenantJourneyRow>[] = [
    {
      key: 'name',
      header: t('journey.tenant'),
      render: (r) => (
        <span className={r.impressions === 0 && r.conversations === 0 ? 'text-gray-400' : ''}>
          {r.name}
        </span>
      ),
    },
    { key: 'impressions', header: t('journey.impressions'), render: (r) => <Num v={r.impressions} /> },
    {
      key: 'access',
      header: t('journey.access'),
      render: (r) => <Num v={r.openedSessions} sub={pct(r.openedSessions, r.impressions)} />,
    },
    {
      key: 'conversations',
      header: t('journey.conversations'),
      render: (r) => <Num v={r.conversations} sub={pct(r.conversations, r.openedSessions)} />,
    },
    // The four that are shares OF conversations, not further funnel stages.
    { key: 'aiHandled', header: t('journey.aiHandled'), render: (r) => <Num v={r.aiHandled} sub={pct(r.aiHandled, r.conversations)} /> },
    { key: 'escalated', header: t('journey.escalated'), render: (r) => <Num v={r.escalated} sub={pct(r.escalated, r.conversations)} /> },
    { key: 'rated', header: t('journey.rated'), render: (r) => <Num v={r.rated} sub={pct(r.rated, r.conversations)} /> },
    { key: 'ended', header: t('journey.ended'), render: (r) => <Num v={r.ended} sub={pct(r.ended, r.conversations)} /> },
  ];

  const totalTenants =
    tenantsQuery.data?.total !== undefined ? String(tenantsQuery.data.total) : '—';

  const integrations = integrationsQuery.data ?? [];

  return (
    <div>
      <PageHeader title={t('title')} />

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label={t('totalTenants')} value={totalTenants} icon={Building2} />
        <KpiCard
          label={t('activeTenants')}
          value={shown(activeTenants)}
          icon={CheckCircle2}
          hint={t('journey.activeHint')}
        />
        <KpiCard label={t('journey.impressions')} value={shown(totalImpressions)} icon={Eye} />
        <KpiCard label={t('conversations')} value={shown(totalConversations)} icon={MessageSquare} />
      </div>

      <Card title={t('journey.title')} className="mb-6">
        <div className="px-5 pt-4">
          <DateRangePicker {...dateRange} />
        </div>
        <Table
          columns={columns}
          data={rows}
          rowKey={(r) => String(r.tenantId)}
          loading={journeyQuery.isLoading}
          error={journeyQuery.error ? (journeyQuery.error as Error).message : null}
          emptyMessage={t('journey.empty')}
        />
        <ul className="space-y-1 px-5 pb-4 text-xs text-gray-500">
          <li>{t('journey.funnelNote')}</li>
          <li>{t('journey.collectionNote')}</li>
          <li>{t('journey.privacyNote')}</li>
        </ul>
      </Card>

      <Card title={t('integrationStatus')}>
        {integrationsQuery.isLoading ? (
          <div className="flex items-center justify-center py-8 text-gray-400">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {tc('loading')}
          </div>
        ) : integrations.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">{t('noIntegrations')}</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {integrations.map((i) => (
              <li key={i.name} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-sm font-medium text-gray-800">{i.name}</p>
                  {i.detail && <p className="text-xs text-gray-400">{i.detail}</p>}
                </div>
                <StatusBadge status={i.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Count with the share it represents underneath — the table reads as ratios. */
function Num({ v, sub }: { v: number; sub?: string }) {
  return (
    <span className="tabular-nums">
      {v.toLocaleString()}
      {sub && <span className="ml-1 text-xs text-gray-400">{sub}</span>}
    </span>
  );
}
