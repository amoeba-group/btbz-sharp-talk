import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@/store/toast-store';
import { useTenantKey } from '@/lib/use-tenant-key';
import { partnerDataService } from './partner-data.service';

export const usePartnerDataSettings = () => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['partner-data-settings', tenantKey],
    queryFn: partnerDataService.settings,
  });
};

export function useSavePartnerDataEnabled() {
  const { t } = useTranslation('settings');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (enabled: boolean) => partnerDataService.saveEnabled(enabled),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partner-data-settings', tenantKey] });
      // Success auto-closes; errors stay until dismissed (dev-kit §4.3).
      toast.success(t('partnerData.saved'));
    },
    onError: (e: Error) => {
      toast.error(e.message || t('partnerData.saveError'), { sticky: true });
    },
  });
}
