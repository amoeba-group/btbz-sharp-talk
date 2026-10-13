import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from '@/store/toast-store';
import { useTenantKey } from '@/lib/use-tenant-key';
import { pilotService } from './pilot.service';
import type { PilotAccessDraft, PilotHotelQuery } from './pilot.service';

/**
 * React Query hooks for the pilot allowlist card (PLN-261012 SG-40). Every change
 * says so with a toast (success auto-closes, an error stays until dismissed), and
 * refreshes both the switch (its counts) and the hotel list.
 */

export function usePilotAccess() {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['pilot-access', tenantKey],
    queryFn: pilotService.access,
  });
}

export function usePilotHotels(q: PilotHotelQuery) {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['pilot-hotels', tenantKey, q],
    queryFn: () => pilotService.hotels(q),
    placeholderData: keepPreviousData,
  });
}

/** One place that refreshes everything a change can touch. */
function useRefreshPilot() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return () => {
    void qc.invalidateQueries({ queryKey: ['pilot-access', tenantKey] });
    void qc.invalidateQueries({ queryKey: ['pilot-hotels', tenantKey] });
  };
}

export function useSavePilotAccess() {
  const { t } = useTranslation('settings');
  const refresh = useRefreshPilot();
  return useMutation({
    mutationFn: (body: PilotAccessDraft) => pilotService.saveAccess(body),
    onSuccess: () => {
      refresh();
      toast.success(t('pilot.saved'));
    },
    onError: (e: Error) => {
      // Server-side validation (an unknown language, a notice that is too long)
      // speaks through the error message — show it rather than a generic failure.
      toast.error(e.message || t('pilot.saveError'), { sticky: true });
    },
  });
}

export function useAddPilotHotel() {
  const { t } = useTranslation('settings');
  const refresh = useRefreshPilot();
  return useMutation({
    mutationFn: (v: { hotelSn: string; note: string }) => pilotService.addHotel(v.hotelSn, v.note),
    onSuccess: (hotel) => {
      refresh();
      toast.success(t('pilot.toast.added', { serial: hotel.hotelSn }));
    },
    onError: (e: Error) => toast.error(e.message || t('pilot.toast.addError'), { sticky: true }),
  });
}

/**
 * Preview and apply share one mutation shape. A preview changes nothing, so it only
 * shows its result (no toast); applying it does, so it toasts and refreshes.
 */
export function useImportPilotHotels() {
  const { t } = useTranslation('settings');
  const refresh = useRefreshPilot();
  return useMutation({
    mutationFn: (v: { text: string; dryRun: boolean }) => pilotService.importHotels(v.text, v.dryRun),
    onSuccess: (result) => {
      if (result.dryRun) return;
      refresh();
      toast.success(t('pilot.toast.imported', { added: result.added, resumed: result.reactivated }));
    },
    onError: (e: Error, v) =>
      toast.error(e.message || t(v.dryRun ? 'pilot.toast.previewError' : 'pilot.toast.importError'), {
        sticky: true,
      }),
  });
}

export function useSetPilotHotelActive() {
  const { t } = useTranslation('settings');
  const refresh = useRefreshPilot();
  return useMutation({
    mutationFn: (v: { hotelSn: string; active: boolean }) => pilotService.setHotelActive(v.hotelSn, v.active),
    onSuccess: (hotel) => {
      refresh();
      toast.success(t(hotel.active ? 'pilot.toast.resumed' : 'pilot.toast.paused', { serial: hotel.hotelSn }));
    },
    onError: (e: Error) => toast.error(e.message || t('pilot.toast.updateError'), { sticky: true }),
  });
}

export function useRemovePilotHotel() {
  const { t } = useTranslation('settings');
  const refresh = useRefreshPilot();
  return useMutation({
    mutationFn: (hotelSn: string) => pilotService.removeHotel(hotelSn),
    onSuccess: (res) => {
      refresh();
      toast.success(t('pilot.toast.removed', { serial: res.hotelSn }));
    },
    onError: (e: Error) => toast.error(e.message || t('pilot.toast.removeError'), { sticky: true }),
  });
}
