import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productsService } from './products.service';
import type { ProductListParams } from './products.service';
import { useTenantKey } from '@/lib/use-tenant-key';

export const useProducts = (params: ProductListParams) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['products', tenantKey, params],
    queryFn: () => productsService.list(params),
    placeholderData: keepPreviousData,
  });
};

/** The detail dialog's product. Idle until a row is actually opened. */
export const useProduct = (handle: string | null) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['product', tenantKey, handle],
    queryFn: () => productsService.detail(handle as string),
    enabled: !!handle,
  });
};

export const useProductSummary = () => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['products-summary', tenantKey],
    queryFn: () => productsService.summary(),
  });
};

export const useProductCategories = () => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['products-categories', tenantKey],
    queryFn: () => productsService.categories(),
  });
};

/** Companies that own products — empty for a plain storefront tenant. */
export const useProductCompanies = () => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['products-companies', tenantKey],
    queryFn: () => productsService.companies(),
  });
};

/** Room count of an HA room type. Toasts are the caller's (they need `t`). */
export const useUpdateRoomCount = () => {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: ({ handle, roomCount }: { handle: string; roomCount: number | null }) =>
      productsService.updateRoomCount(handle, roomCount),
    onSuccess: (_detail, { handle }) => {
      qc.invalidateQueries({ queryKey: ['products', tenantKey] });
      qc.invalidateQueries({ queryKey: ['product', tenantKey, handle] });
    },
  });
};
