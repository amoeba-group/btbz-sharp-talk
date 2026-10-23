import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTenantKey } from '@/lib/use-tenant-key';
import { routingCategoriesService } from './routing-categories.service';

export const useRoutingCategories = () => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['routing-categories', tenantKey],
    queryFn: () => routingCategoriesService.list(),
  });
};

/** Create / rename+reorder / delete. Toasts are the caller's (the modal names the row). */
export function useRoutingCategoryMutations() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const refresh = () => qc.invalidateQueries({ queryKey: ['routing-categories', tenantKey] });
  return {
    create: useMutation({ mutationFn: routingCategoriesService.create, onSuccess: refresh }),
    update: useMutation({ mutationFn: routingCategoriesService.update, onSuccess: refresh }),
    remove: useMutation({ mutationFn: routingCategoriesService.remove, onSuccess: refresh }),
  };
}

/**
 * Display name for a category code: the tenant's own name, else the built-in
 * localized name of a Go2Joy region code (seeded rows keep `name` NULL so they
 * follow the console language), else the code itself.
 */
export function useCategoryName() {
  const { t } = useTranslation('aiSetting');
  const { data } = useRoutingCategories();
  return useCallback(
    (code: string) => {
      const row = data?.find((c) => c.code === code);
      return row?.name || t(`handoff.routing.region.${code}`, { defaultValue: code });
    },
    [data, t],
  );
}
