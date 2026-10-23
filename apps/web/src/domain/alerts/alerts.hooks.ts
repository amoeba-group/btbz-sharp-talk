import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@/store/toast-store';
import { useTenantKey } from '@/lib/use-tenant-key';
import { alertsService } from './alerts.service';
import type { AlarmCenterParams, AlertSettings } from './alerts.service';

/** Alarm history (PLN-261024 alarm center). */
export const useAlarmCenter = (params: AlarmCenterParams, enabled = true) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['agent', tenantKey, 'alarm-center', params],
    queryFn: () => alertsService.center(params),
    enabled,
  });
};

/** Mark an alarm read for me only (D2) — refreshes the popup feed, bell and center. */
export const useReadAlert = () => {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (id: string) => alertsService.read(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'alerts'] });
      qc.invalidateQueries({ queryKey: ['agent', tenantKey, 'alarm-center'] });
    },
  });
};

/** My alarm settings; defaults until loaded so the popup never waits on them. */
export const useAlertSettings = (enabled = true) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['agent', tenantKey, 'alert-settings'],
    queryFn: () => alertsService.settings(),
    enabled,
    staleTime: 60_000,
  });
};

export const useSaveAlertSettings = () => {
  const { t } = useTranslation('livechat');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (body: Partial<AlertSettings>) => alertsService.saveSettings(body),
    onSuccess: (data) => {
      qc.setQueryData(['agent', tenantKey, 'alert-settings'], data);
      toast.success(t('alarmCenter.settings.saved'));
    },
    onError: (e: Error) => toast.error(e.message || t('alarmCenter.settings.saveError'), { sticky: true }),
  });
};
