import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { hotelProvinceService } from './hotel-province.service';
import { toast } from '@/store/toast-store';
import { useTenantKey } from '@/lib/use-tenant-key';
// Source deep-import: the package entry point is CJS and fails the browser build for values.
import { errorDetailText } from '../../../../../packages/types/src/common/error-detail';

type ApiError = Error & { code?: string; details?: Record<string, string[]> };

export const useHotelProvinceSummary = (enabled = true) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['hotel-provinces', tenantKey],
    queryFn: hotelProvinceService.summary,
    enabled,
  });
};

/** Why the server refused the file: its code message plus the details naming the row (SG-65, SG-67). */
function useUploadError() {
  const { t } = useTranslation('aiSetting');
  return (e: ApiError) => {
    const detail = errorDetailText(e.details);
    toast.error(detail ? t('handoff.hotelUploadErrorDetail', { detail }) : e.message || t('handoff.hotelUploadError'), {
      sticky: true,
    });
  };
}

/** Dry run: reads the file and reports, changes nothing — so no success toast, only errors. */
export function useHotelProvincePreview() {
  const onError = useUploadError();
  return useMutation({
    mutationFn: (file: File) => hotelProvinceService.importCsv(file, true),
    onError,
  });
}

/** The real upload: replaces the whole table, with a toast either way. */
export function useHotelProvinceApply() {
  const { t } = useTranslation('aiSetting');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const onError = useUploadError();
  return useMutation({
    mutationFn: (file: File) => hotelProvinceService.importCsv(file, false),
    onSuccess: (report) => {
      qc.invalidateQueries({ queryKey: ['hotel-provinces', tenantKey] });
      toast.success(t('handoff.hotelUploaded', { count: report.rows }));
    },
    onError,
  });
}

export function useHotelProvinceClear() {
  const { t } = useTranslation('aiSetting');
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: hotelProvinceService.clear,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hotel-provinces', tenantKey] });
      toast.success(t('handoff.hotelCleared'));
    },
    onError: (e: ApiError) => toast.error(e.message || t('handoff.hotelClearError'), { sticky: true }),
  });
}
