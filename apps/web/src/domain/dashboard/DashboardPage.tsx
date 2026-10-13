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
import { useAuthStore } from '@/store/auth-store';
import { canListOrders, makeCan } from '@/lib/rbac';
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
  const { t: tn } = useTranslation('nav');
  // What this rank may read (w3c, ops-manual finding 15): the KPI numbers need ANALYTICS_READ and the
  // order list the operations/sales-admin label. A staff member used to get six zeros (the 403s were
  // swallowed), which read as "nothing is happening"; now the numbers are not requested and the page
  // says why, with the screens the person does work in.
  const principal = useAuthStore((s) => s.principal);
  const can = makeCan(principal);
  const canStats = can('analytics_read');
  const canOrders = canListOrders(principal);
  const { data, isLoading } = useDashboard(canStats);
  const { data: integrations, isLoading: intLoading } = useIntegrationStatus();
  const { data: recentOrders, isLoading: ordLoading, isError: ordError } = useRecentOrders(canOrders);

  const shortcuts: Array<{ to: string; label: string }> = [
    ...(can('live_chat') ? [{ to: '/live-chat', label: tn('liveChat') }] : []),
    ...(can('history') ? [{ to: '/history', label: tn('history') }] : []),
    ...(can('orders') ? [{ to: '/orders', label: tn('orders') }] : []),
  ];

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      {!canStats && (
        <Card title={t('noStats.title')} className="mb-6">
          <p className="text-sm text-gray-600">{t('noStats.body')}</p>
          {shortcuts.length > 0 && (
            <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-gray-500">{t('noStats.goTo')}</span>
              {shortcuts.map((s) => (
                <Link
                  key={s.to}
                  to={s.to}
                  className="rounded-full border border-gray-200 px-3 py-1 font-medium text-primary-600 hover:bg-gray-50"
                >
                  {s.label}
                </Link>
              ))}
            </p>
          )}
        </Card>
      )}

      {canStats && (
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
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {canStats && (
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
        )}

        <Card title={t('integrationStatus')}>
          {intLoading && <p className="text-sm text-gray-400">{tc('loading')}</p>}
          {!intLoading && (!integrations || integrations.length === 0) && (
            <p className="text-sm text-gray-400">{t('noIntegrations')}</p>
          )}
          <ul className="space-y-3">
            {integrations?.map((it) => (
              <li key={it.name} className="text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-700">
                    {t(`integration.${it.name}`, { defaultValue: it.name })}
                  </span>
                  <StatusBadge status={it.status} />
                </div>
                {/* What the state means and when it was last true — an
                    "error" badge alone gave nothing to act on. */}
                {(it.detail || it.lastSyncAt) && (
                  <p className="mt-0.5 truncate text-xs text-gray-400" title={it.detail ?? undefined}>
                    {it.detail}
                    {it.detail && it.lastSyncAt ? ' · ' : ''}
                    {it.lastSyncAt ? new Date(it.lastSyncAt).toLocaleString() : ''}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {canOrders && (
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
      )}
    </div>
  );
}
