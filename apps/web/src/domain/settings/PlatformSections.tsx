import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AddPlatformButtons } from './AddPlatformButtons';
import type { PlatformConnection } from './platform-connections.hooks';
import type { PlatformChoice } from './integration-providers';

/**
 * The two-section layout shared by the platforms and marketing tabs
 * (PLN-261019 D3/S4): the platforms this tenant holds a credential for, as
 * cards with their real per-tenant state; then every offered platform as an
 * "add" chip, ticked when already connected.
 */
export function PlatformSections({
  connections,
  loading,
  emptyHint,
  renderCard,
  onAdd,
}: {
  connections: PlatformConnection[];
  loading: boolean;
  emptyHint: string;
  renderCard: (connection: PlatformConnection) => ReactNode;
  onAdd: (provider: PlatformChoice) => void;
}) {
  const { t } = useTranslation('settings');
  const connected = connections.filter((c) => c.configured);
  return (
    <>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">
          {t('platforms.connectedTitle')}{' '}
          <span className="font-normal text-gray-400">({loading ? '…' : connected.length})</span>
        </h2>
        {!loading && connected.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-8 text-center">
            <p className="text-sm font-medium text-gray-700">{t('platforms.emptyTitle')}</p>
            <p className="mt-1 text-xs text-gray-500">{emptyHint}</p>
          </div>
        )}
        {connected.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{connected.map(renderCard)}</div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-800">{t('platforms.addTitle')}</h2>
        <p className="text-xs text-gray-500">{t('platforms.addHint')}</p>
        <AddPlatformButtons connections={connections} onAdd={onAdd} />
      </section>
    </>
  );
}
