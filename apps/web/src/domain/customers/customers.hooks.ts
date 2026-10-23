import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customersService } from './customers.service';
import type { CompanyListParams, CompanyProfileUpdate, CustomerListParams } from './customers.service';
import i18n from 'i18next';
import { toast } from '@/store/toast-store';
import { useTenantKey } from '@/lib/use-tenant-key';

export const useCustomers = (params: CustomerListParams) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['customers', tenantKey, params],
    queryFn: () => customersService.list(params),
    placeholderData: keepPreviousData,
  });
};

export function useUpdateTier() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: ({ id, tier }: { id: number; tier: string }) =>
      customersService.updateTier(id, tier),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customers', tenantKey] });
      toast.success('Customer tier updated.');
    },
    onError: (e: Error) => {
      toast.error(e.message || 'Failed to update tier.');
    },
  });
}

/** B2B companies (PLN-261022 stage 2). */
export const useCompanies = (params: CompanyListParams, enabled = true) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['companies', tenantKey, params],
    queryFn: () => customersService.companies(params),
    placeholderData: keepPreviousData,
    enabled,
  });
};

export const useCompany = (id: string | null) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['company', tenantKey, id],
    queryFn: () => customersService.company(id!),
    enabled: !!id,
  });
};

/**
 * Company writes (PLN-261023) share one success path: the response IS the new
 * detail, so it replaces the cached one and the list refreshes its counters.
 */
function useCompanyWrite<V>(fn: (v: V) => Promise<import('./customers.service').CompanyDetail>, successKey: string) {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: fn,
    onSuccess: (detail) => {
      qc.setQueryData(['company', tenantKey, detail.id], detail);
      qc.invalidateQueries({ queryKey: ['companies', tenantKey] });
      toast.success(i18n.t(successKey, { ns: 'customers' }));
    },
    onError: (e: Error) => toast.error(e.message || i18n.t('companySaveFailed', { ns: 'customers' })),
  });
}

/** Province → region map status for the Go2Joy Partner card (PLN-261023 H1-a). */
export const useProvinceRegions = (enabled: boolean) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['province-regions', tenantKey],
    queryFn: () => customersService.provinceRegions(),
    enabled,
  });
};

export const useSyncProvinceRegions = () => {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: () => customersService.syncProvinceRegions(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['province-regions', tenantKey] });
      toast.success(i18n.t('provinceRegions.synced', { ns: 'customers', total: r.total, added: r.added, changed: r.changed, kept: r.kept }));
    },
    onError: (e: Error) => toast.error(e.message || i18n.t('provinceRegions.syncFailed', { ns: 'customers' })),
  });
};

export const useAddHotel = () => useCompanyWrite((hotelSn: number) => customersService.addHotel(hotelSn), 'hotelAdded');
export const useSyncCompany = () => useCompanyWrite((id: string) => customersService.syncCompany(id), 'hotelSynced');
export const useUpdateCompanyProfile = () =>
  useCompanyWrite(
    ({ id, body }: { id: string; body: CompanyProfileUpdate }) => customersService.updateCompanyProfile(id, body),
    'profileSaved',
  );
