import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ShopifyConfigModal } from './ShopifyConfigModal';
import { IntegrationConfigModal } from './IntegrationConfigModal';
import { Cafe24ConnectModal } from './Cafe24ConnectModal';
import { AddPlatformButtons } from './AddPlatformButtons';
import {
  GenericConnectedCard,
  SelfPlatformCard,
  ShopifyConnectedCard,
} from './ConnectedPlatformCard';
import { usePlatformConnections } from './platform-connections.hooks';
import { ECOMMERCE_PROVIDERS, SELF_PLATFORM_PROVIDER, type PlatformChoice } from './integration-providers';

/** Platforms whose settings dialog is the generic credential modal. */
const GENERIC_PLATFORMS = [...ECOMMERCE_PROVIDERS, SELF_PLATFORM_PROVIDER] as const;

/** Manual guide languages that exist under public/manual (PLN-260826). */
const GUIDE_LANGS = ['ko', 'en', 'vi'] as const;

/** Which dialog is open: a platform's settings, or the Cafe24 OAuth connect. */
type Dialog = { kind: 'config'; provider: PlatformChoice } | { kind: 'cafe24-oauth' } | null;

/**
 * Tenant settings — platforms (PLN-261019).
 *
 * Two sections instead of one grid of five identical tiles: the platforms this
 * tenant actually holds a credential for, as cards with their real per-tenant
 * state; and every supported platform as an "add" chip. A tenant that runs its
 * own platform registers it the same way, so "we are not on Shopify" is a
 * card, not an absence.
 */
export function SettingsPlatformsPage() {
  const { t, i18n } = useTranslation('settings');
  const { connections, loading } = usePlatformConnections();
  const [dialog, setDialog] = useState<Dialog>(null);

  // The credential guide is a static /manual page (works regardless of console
  // auth); fall back to Korean for any UI language it isn't translated into.
  const guideLang = (GUIDE_LANGS as readonly string[]).includes(i18n.language)
    ? i18n.language
    : 'ko';

  const connected = connections.filter((c) => c.configured);
  const close = () => setDialog(null);
  const configure = (provider: PlatformChoice) => setDialog({ kind: 'config', provider });
  // Adding Cafe24 starts OAuth (D6); every other platform opens its settings.
  const add = (provider: PlatformChoice) =>
    provider === 'cafe24' ? setDialog({ kind: 'cafe24-oauth' }) : configure(provider);

  const isOpen = (provider: PlatformChoice) =>
    dialog?.kind === 'config' && dialog.provider === provider;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-gray-500">{t('groups.platforms.subtitle')}</p>
        <a
          href={`/manual/platform-integration.${guideLang}.html`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:border-primary-300 hover:text-primary-700"
        >
          <BookOpen className="h-4 w-4" />
          {t('integrationGuide')}
        </a>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">
          {t('platforms.connectedTitle')}{' '}
          <span className="font-normal text-gray-400">({loading ? '…' : connected.length})</span>
        </h2>
        {!loading && connected.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-8 text-center">
            <p className="text-sm font-medium text-gray-700">{t('platforms.emptyTitle')}</p>
            <p className="mt-1 text-xs text-gray-500">{t('platforms.emptyHint')}</p>
          </div>
        )}
        {connected.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {connected.map((c) =>
              c.provider === 'shopify' ? (
                <ShopifyConnectedCard key={c.provider} connection={c} onConfigure={() => configure(c.provider)} />
              ) : c.provider === SELF_PLATFORM_PROVIDER ? (
                <SelfPlatformCard key={c.provider} connection={c} onConfigure={() => configure(c.provider)} />
              ) : (
                <GenericConnectedCard key={c.provider} connection={c} onConfigure={() => configure(c.provider)} />
              ),
            )}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">{t('platforms.addTitle')}</h2>
        <p className="text-xs text-gray-500">{t('platforms.addHint')}</p>
        <AddPlatformButtons connections={connections} onAdd={add} />
      </section>

      <ShopifyConfigModal open={isOpen('shopify')} onClose={close} />
      {GENERIC_PLATFORMS.map((p) => (
        <IntegrationConfigModal key={p} provider={p} open={isOpen(p)} onClose={close} />
      ))}
      <Cafe24ConnectModal
        open={dialog?.kind === 'cafe24-oauth'}
        onClose={close}
        onManual={() => configure('cafe24')}
      />
    </div>
  );
}
