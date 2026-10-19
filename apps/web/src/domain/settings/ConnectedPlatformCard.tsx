import type { ReactNode } from 'react';
import { ExternalLink, RefreshCw, Settings2, Store, Building2, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import type { PlatformConnection } from './platform-connections.hooks';
import { SELF_PLATFORM_PROVIDER } from './integration-providers';
import {
  useStorefront,
  useSyncShopify,
  useTestShopify,
  useTestIntegration,
  useWidgetSettings,
} from './settings.hooks';
import { FulfillmentWebhookBlock } from './FulfillmentWebhookBlock';

function fmtDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

/**
 * Badge for a configured platform (PLN-261019 §2.4). Only a real test or sync
 * makes it "connected"; a saved-but-unverified credential says so. The tenant's
 * own platform has nothing to verify, so it reads "registered".
 */
function StateBadge({ provider, status }: { provider: string; status: string | null }) {
  const { t } = useTranslation('settings');
  if (provider === SELF_PLATFORM_PROVIDER) {
    return <Badge tone="info">{t('integrations.state.registered')}</Badge>;
  }
  if (status === 'connected') return <Badge tone="success">{t('integrations.state.connected')}</Badge>;
  if (status === 'error') return <Badge tone="error">{t('integrations.state.error')}</Badge>;
  return <Badge>{t('integrations.state.unknown')}</Badge>;
}

function Shell({
  icon,
  title,
  subtitle,
  badge,
  detail,
  lastCheckedLabel,
  lastCheckedAt,
  body,
  actions,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string | null;
  badge: ReactNode;
  detail: string | null;
  lastCheckedLabel: string;
  lastCheckedAt: string | null;
  body?: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-500/10 text-primary-600">
            {icon}
          </div>
          <div className="min-w-0 leading-tight">
            <p className="font-semibold text-gray-900">{title}</p>
            {subtitle && <p className="mt-0.5 truncate text-xs text-gray-500">{subtitle}</p>}
          </div>
        </div>
        {badge}
      </div>

      {detail && (
        <p className="mb-2 truncate text-xs text-gray-500" title={detail}>
          {detail}
        </p>
      )}
      {body}
      <p className="mb-4 text-xs text-gray-400">
        {lastCheckedLabel}: {fmtDate(lastCheckedAt)}
      </p>

      <div className="mt-auto flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

/** Shopify — its own endpoint, test + order sync (REQ-260826 flow kept). */
export function ShopifyConnectedCard({
  connection,
  onConfigure,
}: {
  connection: PlatformConnection;
  onConfigure: () => void;
}) {
  const { t } = useTranslation('settings');
  const test = useTestShopify();
  const sync = useSyncShopify();
  return (
    <Shell
      icon={<Store className="h-5 w-5" />}
      title={t('integrations.shopify.title')}
      subtitle={connection.identity ?? t('shopify.shopDomainPlaceholder')}
      badge={<StateBadge provider="shopify" status={connection.status} />}
      detail={connection.detail}
      lastCheckedLabel={t('platforms.lastChecked')}
      lastCheckedAt={connection.lastCheckedAt}
      actions={
        <>
          <Button variant="secondary" size="sm" onClick={onConfigure}>
            <Settings2 className="mr-1.5 h-4 w-4" />
            {t('configure')}
          </Button>
          <Button variant="secondary" size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
            <Zap className="mr-1.5 h-4 w-4" />
            {test.isPending ? t('shopify.testing') : t('shopify.testConnection')}
          </Button>
          <Button variant="secondary" size="sm" disabled={sync.isPending} onClick={() => sync.mutate()}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            {sync.isPending ? t('shopify.syncing') : t('shopify.syncNow')}
          </Button>
        </>
      }
    />
  );
}

/** cafe24 / woocommerce / odoo / haravan — generic credential + probe. */
export function GenericConnectedCard({
  connection,
  onConfigure,
}: {
  connection: PlatformConnection;
  onConfigure: () => void;
}) {
  const { t } = useTranslation('settings');
  const test = useTestIntegration(connection.provider);
  return (
    <Shell
      icon={<Store className="h-5 w-5" />}
      title={t(`integrations.${connection.provider}.title`)}
      subtitle={connection.identity ?? t(`integrations.${connection.provider}.subtitle`)}
      badge={<StateBadge provider={connection.provider} status={connection.status} />}
      detail={connection.detail}
      lastCheckedLabel={t('platforms.lastChecked')}
      lastCheckedAt={connection.lastCheckedAt}
      actions={
        <>
          <Button variant="secondary" size="sm" onClick={onConfigure}>
            <Settings2 className="mr-1.5 h-4 w-4" />
            {t('configure')}
          </Button>
          <Button variant="secondary" size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
            <Zap className="mr-1.5 h-4 w-4" />
            {test.isPending ? t('integrations.testing') : t('integrations.testConnection')}
          </Button>
        </>
      }
    />
  );
}

/**
 * The tenant's own platform (PLN-261019 D4/D5). Registration is the whole
 * connection. The order-fulfillment webhook (what the old "self-developed
 * integration" card was) lives here and only when the store takes orders —
 * a hotel partner desk like go2joy has nothing to send it.
 */
export function SelfPlatformCard({
  connection,
  onConfigure,
}: {
  connection: PlatformConnection;
  onConfigure: () => void;
}) {
  const { t } = useTranslation('settings');
  const { data: widget } = useWidgetSettings();
  const { data: store } = useStorefront();
  const commerce = widget?.commerceEnabled ?? true;
  const storefront = store?.storefrontUrl ?? null;
  const subtitle = [t('integrations.self.title'), storefront].filter(Boolean).join(' · ');
  return (
    <Shell
      icon={<Building2 className="h-5 w-5" />}
      title={connection.identity ?? t('integrations.self.title')}
      subtitle={subtitle}
      badge={<StateBadge provider={connection.provider} status={connection.status} />}
      detail={null}
      lastCheckedLabel={t('platforms.registeredAt')}
      lastCheckedAt={connection.lastCheckedAt}
      body={
        commerce ? (
          <div className="mb-4 rounded-lg border border-gray-100 bg-gray-50 p-4">
            <FulfillmentWebhookBlock />
          </div>
        ) : (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-600">
            <span>{t('platforms.selfNoCommerce')}</span>
            <Link
              to="/settings/widget"
              className="inline-flex items-center gap-1 font-medium text-primary-700 hover:underline"
            >
              {t('platforms.openWidgetSettings')}
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        )
      }
      actions={
        <Button variant="secondary" size="sm" onClick={onConfigure}>
          <Settings2 className="mr-1.5 h-4 w-4" />
          {t('configure')}
        </Button>
      }
    />
  );
}
