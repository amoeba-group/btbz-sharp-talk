import type { ReactNode } from 'react';
import { Download, ExternalLink, RefreshCw, Settings2, Store, Building2, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import type { PlatformConnection } from './platform-connections.hooks';
import { SELF_PLATFORM_PROVIDER } from './integration-providers';
import {
  useStorefront,
  useSyncCafe24Orders,
  useSyncCafe24Products,
  useSyncShopify,
  useTestCafe24,
  useTestShopify,
  useTestIntegration,
  useWidgetSettings,
} from './settings.hooks';
import { FulfillmentWebhookBlock } from './FulfillmentWebhookBlock';
import { platformSiteUrl } from './platform-site-url';

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

/**
 * "Open site ↗" — the platform's admin console in a new tab (PLN-261019-Cafe24
 * D5). Rendered only when the stored fields give a real target; never a guess.
 */
function OpenSiteLink({ href }: { href: string | null }) {
  const { t } = useTranslation('settings');
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
    >
      <ExternalLink className="h-4 w-4" />
      {t('platforms.openSite')}
    </a>
  );
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
  siteUrl,
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
  /** The platform's own admin/site; null hides the link. */
  siteUrl: string | null;
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

      <div className="mt-auto flex flex-wrap gap-2">
        {actions}
        <OpenSiteLink href={siteUrl} />
      </div>
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
      siteUrl={platformSiteUrl(connection, null)}
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

/** woocommerce / odoo / haravan / klaviyo / yotpo / gorgias — generic credential + probe. */
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
      siteUrl={platformSiteUrl(connection, null)}
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
 * Cafe24 (PLN-261019-Cafe24 D4). The mall is connected one of two ways and
 * the card follows the stored credential: an OAuth connection tests through
 * the token service and offers the order/catalogue pulls the old OAuth card
 * had; a manually typed token keeps the generic probe and no syncs (the
 * syncs need the OAuth refresh path). "Configure" is the caller's: it opens
 * the reconnect dialog for OAuth and the credential modal for manual.
 */
export function Cafe24ConnectedCard({
  connection,
  onConfigure,
}: {
  connection: PlatformConnection;
  onConfigure: () => void;
}) {
  const { t } = useTranslation('settings');
  const oauth = connection.mode === 'oauth';
  const testOAuth = useTestCafe24();
  const testManual = useTestIntegration('cafe24');
  const syncOrders = useSyncCafe24Orders();
  const syncProducts = useSyncCafe24Products();
  const test = oauth ? testOAuth : testManual;
  const mall = connection.fields.mall_id?.trim() || null;
  const subtitle = [
    mall ? `${mall}.cafe24.com` : null,
    connection.mode ? t(`cafe24.oauth.mode.${connection.mode}`) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Shell
      icon={<Store className="h-5 w-5" />}
      title={t('integrations.cafe24.title')}
      subtitle={subtitle || t('integrations.cafe24.subtitle')}
      badge={<StateBadge provider="cafe24" status={connection.status} />}
      detail={connection.detail}
      lastCheckedLabel={t('platforms.lastChecked')}
      lastCheckedAt={connection.lastCheckedAt}
      siteUrl={platformSiteUrl(connection, null)}
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
          {oauth && (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={syncOrders.isPending}
                onClick={() => syncOrders.mutate()}
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                {syncOrders.isPending ? t('integrations.syncing') : t('integrations.syncOrders')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={syncProducts.isPending}
                onClick={() => syncProducts.mutate()}
              >
                <Download className="mr-1.5 h-4 w-4" />
                {syncProducts.isPending ? t('integrations.syncing') : t('cafe24.oauth.syncProducts')}
              </Button>
            </>
          )}
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
      siteUrl={platformSiteUrl(connection, storefront)}
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
