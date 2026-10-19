import {
  MessagesSquare,
  Bell,
  Bot,
  AlertTriangle,
  MessageCircle,
  ShoppingCart,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/PageHeader';
import { KpiCard } from '@/components/KpiCard';
import { Card } from '@/components/Card';
import { StatusBadge } from '@/components/StatusBadge';
import { useDashboard, useIntegrationStatus, useRecentOrders } from './dashboard.hooks';

function pct(value: number | undefined) {
  if (value == null) return '–';
  const n = value <= 1 ? value * 100 : value;
  return `${Math.round(n)}%`;
}

function money(value?: number, currency?: string) {
  if (typeof value !== 'number') return '—';
  return `${value.toLocaleString()} ${currency ?? ''}`.trim();
}

function fmtDate(value?: string) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString();
}

export function DashboardPage() {
  const { t } = useTranslation('dashboard');
  const { t: tc } = useTranslation('common');
  const { data, isLoading } = useDashboard();
  const { data: integrations, isLoading: intLoading } = useIntegrationStatus();
  const { data: recentOrders, isLoading: ordLoading, isError: ordError } = useRecentOrders();

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label={t('activeChats')}
          value={data?.activeChats ?? (isLoading ? '…' : 0)}
          icon={MessagesSquare}
          to="/live-chat"
        />
        <KpiCard
          label={t('todayNotifications')}
          value={data?.todayNotifications ?? (isLoading ? '…' : 0)}
          icon={Bell}
          to="/campaigns"
        />
        <KpiCard
          label={t('aiResolutionRate')}
          value={isLoading ? '…' : pct(data?.aiResolutionRate)}
          // The definition is on the card because it changed: it used to count
          // any ended, un-escalated conversation — including one the customer
          // walked away from — and it now matches the journey report exactly.
          hint={t('aiResolutionRateHint')}
          icon={Bot}
          to="/history"
        />
        <KpiCard
          label={t('unresolvedTopN')}
          value={data?.unresolvedTopN ?? (isLoading ? '…' : 0)}
          icon={AlertTriangle}
          to="/live-chat"
        />
        <KpiCard
          label={t('totalConversations')}
          value={data?.totalConversations ?? (isLoading ? '…' : 0)}
          icon={MessageCircle}
          to="/history"
        />
        <KpiCard
          label={t('totalOrders')}
          value={data?.totalOrders ?? (isLoading ? '…' : 0)}
          icon={ShoppingCart}
          to="/orders"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title={t('popularQuestions')} className="lg:col-span-2">
          {isLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}
          {!isLoading && (!data?.popularQuestions || data.popularQuestions.length === 0) && (
            <p className="text-sm text-gray-400">{tc('noData')}</p>
          )}
          <ul className="divide-y divide-gray-100">
            {data?.popularQuestions?.map((q, i) => (
              <li key={i} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-500">
                  {i + 1}
                </span>
                <span className="truncate text-gray-700">{q}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t('integrationStatus')}>
          {intLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}
          {!intLoading && (!integrations || integrations.length === 0) && (
            <p className="text-sm text-gray-400">{t('noIntegrations')}</p>
          )}
          <ul className="space-y-3">
            {integrations?.map((it) => {
              // The per-tenant endpoint names the row `provider`; reading
              // `name` here printed "integration.undefined" for every row.
              const key = it.provider ?? it.name ?? '';
              const when = it.lastTestedAt ?? it.lastSyncAt;
              return (
              <li key={key} className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-700">
                    {t(`integration.${key}`, { defaultValue: key })}
                  </span>
                  <StatusBadge
                    status={it.status}
                    label={t(`integrationState.${it.status}`, { defaultValue: it.status })}
                  />
                </div>
                {/* What the state means and when it was last true — an
                    "error" badge alone gave nothing to act on. */}
                {(it.detail || when) && (
                  <p className="mt-0.5 truncate text-xs text-gray-400" title={it.detail ?? undefined}>
                    {it.detail}
                    {it.detail && when ? ' · ' : ''}
                    {when ? new Date(when).toLocaleString() : ''}
                  </p>
                )}
              </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="mt-6">
        <Card
          title={t('recentOrders')}
          action={
            <Link to="/orders" className="text-sm font-medium text-primary-600 hover:underline">
              {t('viewOrders')}
            </Link>
          }
        >
          {ordLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}
          {!ordLoading && (ordError || !recentOrders || recentOrders.length === 0) && (
            <p className="text-sm text-gray-400">{t('noOrders')}</p>
          )}
          {!ordLoading && recentOrders && recentOrders.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs text-gray-500">
                    <th className="py-2 pr-4 font-medium">{t('orderNumber')}</th>
                    <th className="py-2 pr-4 font-medium">{t('status')}</th>
                    <th className="py-2 pr-4 font-medium">{t('amount')}</th>
                    <th className="py-2 pr-4 font-medium">{t('date')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recentOrders.map((o) => (
                    <tr key={o.id}>
                      <td className="py-2.5 pr-4 font-medium text-gray-800">#{o.orderNumber}</td>
                      <td className="py-2.5 pr-4">
                        <StatusBadge status={o.statusUi ?? o.statusInternal} />
                      </td>
                      <td className="py-2.5 pr-4 text-gray-700">{money(o.total, o.currency)}</td>
                      <td className="py-2.5 pr-4 text-gray-500">{fmtDate(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
