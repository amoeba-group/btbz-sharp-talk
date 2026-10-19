import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ShopifyConfigModal } from './ShopifyConfigModal';
import { IntegrationConfigModal } from './IntegrationConfigModal';
import { Cafe24ConnectModal } from './Cafe24ConnectModal';
import { PlatformSections } from './PlatformSections';
import {
  Cafe24ConnectedCard,
  GenericConnectedCard,
  SelfPlatformCard,
  ShopifyConnectedCard,
} from './ConnectedPlatformCard';
import { usePlatformConnections } from './platform-connections.hooks';
import {
  ECOMMERCE_PROVIDERS,
  PLATFORM_CHOICES,
  SELF_PLATFORM_PROVIDER,
  type PlatformChoice,
} from './integration-providers';

/** Platforms whose settings dialog is the generic credential modal. */
const GENERIC_PLATFORMS = [...ECOMMERCE_PROVIDERS, SELF_PLATFORM_PROVIDER] as const;

/** Manual guide languages that exist under public/manual (PLN-260826). */
const GUIDE_LANGS = ['ko', 'en', 'vi'] as const;

/**
 * Which dialog is open: a platform's settings, or the Cafe24 OAuth connect —
 * which doubles as "reconnect" for a mall already connected that way
 * (PLN-261019-Cafe24 D4), pre-filled with its mall id.
 */
type Dialog =
  | { kind: 'config'; provider: PlatformChoice }
  | { kind: 'cafe24-oauth'; reconnectMallId?: string }
  | null;

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
  const { connections, loading } = usePlatformConnections(PLATFORM_CHOICES);
  const [dialog, setDialog] = useState<Dialog>(null);

  // The credential guide is a static /manual page (works regardless of console
  // auth); fall back to Korean for any UI language it isn't translated into.
  const guideLang = (GUIDE_LANGS as readonly string[]).includes(i18n.language)
    ? i18n.language
    : 'ko';

  const close = () => setDialog(null);
  const configure = (provider: PlatformChoice) => setDialog({ kind: 'config', provider });
  // Adding Cafe24 starts OAuth (D6); every other platform opens its settings.
  const add = (provider: PlatformChoice) =>
    provider === 'cafe24' ? setDialog({ kind: 'cafe24-oauth' }) : configure(provider);
  // "Configure" on a Cafe24 mall connected through OAuth re-runs the consent
  // flow (scopes changed, token revoked); a typed token edits the credential.
  const configureCafe24 = (c: { mode: string | null; fields: Record<string, string | null> }) =>
    c.mode === 'oauth'
      ? setDialog({ kind: 'cafe24-oauth', reconnectMallId: c.fields.mall_id ?? '' })
      : configure('cafe24');

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

      <PlatformSections
        connections={connections}
        loading={loading}
        emptyHint={t('platforms.emptyHint')}
        renderCard={(c) =>
          c.provider === 'shopify' ? (
            <ShopifyConnectedCard key={c.provider} connection={c} onConfigure={() => configure(c.provider)} />
          ) : c.provider === SELF_PLATFORM_PROVIDER ? (
            <SelfPlatformCard key={c.provider} connection={c} onConfigure={() => configure(c.provider)} />
          ) : c.provider === 'cafe24' ? (
            <Cafe24ConnectedCard key={c.provider} connection={c} onConfigure={() => configureCafe24(c)} />
          ) : (
            <GenericConnectedCard key={c.provider} connection={c} onConfigure={() => configure(c.provider)} />
          )
        }
        onAdd={add}
      />

      <ShopifyConfigModal open={isOpen('shopify')} onClose={close} />
      {GENERIC_PLATFORMS.map((p) => (
        <IntegrationConfigModal key={p} provider={p} open={isOpen(p)} onClose={close} />
      ))}
      <Cafe24ConnectModal
        open={dialog?.kind === 'cafe24-oauth'}
        reconnectMallId={dialog?.kind === 'cafe24-oauth' ? dialog.reconnectMallId : undefined}
        onClose={close}
        onManual={() => configure('cafe24')}
      />
    </div>
  );
}
