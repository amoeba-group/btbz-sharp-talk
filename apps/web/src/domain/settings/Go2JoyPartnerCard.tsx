import { MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/Button';
import { useAuthStore } from '@/store/auth-store';
import { makeCan } from '@/lib/rbac';
import { useProvinceRegions, useSyncProvinceRegions } from '../customers/customers.hooks';
import { GenericConnectedCard } from './ConnectedPlatformCard';
import type { PlatformConnection } from './platform-connections.hooks';

/**
 * Go2Joy Partner API card (PLN-261023 H1-a): the generic credential card plus
 * the routing region map the Province Feed keeps — how many provinces, where
 * they came from, and a button to refresh it now (it also refreshes daily).
 * Shown to people who manage customers; the map routes their hotels.
 */
export function Go2JoyPartnerCard({ connection, onConfigure }: { connection: PlatformConnection; onConfigure: () => void }) {
  const { t } = useTranslation('customers');
  const principal = useAuthStore((s) => s.principal);
  const canManage = makeCan(principal)('customers');
  const status = useProvinceRegions(canManage);
  const sync = useSyncProvinceRegions();

  const s = status.data;
  const line = !s
    ? null
    : s.total === 0
      ? t('provinceRegions.none')
      : s.source && s.syncedAt
        ? t('provinceRegions.synced_line', { total: s.total, at: new Date(s.syncedAt).toLocaleString() })
        : t('provinceRegions.manual_line', { total: s.total });

  return (
    <GenericConnectedCard
      connection={connection}
      onConfigure={onConfigure}
      body={
        canManage && line ? (
          <p className="mb-2 flex items-center gap-1 text-xs text-gray-600">
            <MapPin className="h-3 w-3 shrink-0 text-gray-400" />
            {t('provinceRegions.label')}: {line}
          </p>
        ) : null
      }
      extraActions={
        canManage ? (
          <Button variant="secondary" size="sm" disabled={sync.isPending} onClick={() => sync.mutate()}>
            <MapPin className="mr-1.5 h-4 w-4" />
            {sync.isPending ? t('provinceRegions.syncing') : t('provinceRegions.sync')}
          </Button>
        ) : null
      }
    />
  );
}
