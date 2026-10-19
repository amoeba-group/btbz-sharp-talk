import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IntegrationConfigModal } from './IntegrationConfigModal';
import { GenericConnectedCard } from './ConnectedPlatformCard';
import { PlatformSections } from './PlatformSections';
import { usePlatformConnections } from './platform-connections.hooks';
import { MARKETING_CHOICES, type GenericIntegrationProvider } from './integration-providers';

/**
 * Tenant settings — marketing · helpdesk (PLN-261019 S4). Same two-section
 * layout as the platforms tab: Klaviyo / Yotpo / Gorgias appear as cards only
 * once a credential is saved; otherwise as "add" chips.
 */
export function SettingsMarketingPage() {
  const { t } = useTranslation('settings');
  const { connections, loading } = usePlatformConnections(MARKETING_CHOICES);
  const [configuring, setConfiguring] = useState<GenericIntegrationProvider | null>(null);

  return (
    <div className="space-y-8">
      {/* The tab already names the section; this says what it is for. */}
      <p className="text-sm text-gray-500">{t('groups.marketing.subtitle')}</p>

      <PlatformSections
        connections={connections}
        loading={loading}
        emptyHint={t('platforms.emptyHintMarketing')}
        renderCard={(c) => (
          <GenericConnectedCard
            key={c.provider}
            connection={c}
            onConfigure={() => setConfiguring(c.provider as GenericIntegrationProvider)}
          />
        )}
        onAdd={(p) => setConfiguring(p as GenericIntegrationProvider)}
      />

      {MARKETING_CHOICES.map((p) => (
        <IntegrationConfigModal
          key={p}
          provider={p as GenericIntegrationProvider}
          open={configuring === p}
          onClose={() => setConfiguring(null)}
        />
      ))}
    </div>
  );
}
