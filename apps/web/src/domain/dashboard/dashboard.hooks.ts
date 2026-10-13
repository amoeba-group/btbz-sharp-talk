import { useQuery } from '@tanstack/react-query';
import { dashboardService } from './dashboard.service';
import { useTenantKey } from '@/lib/use-tenant-key';

/** `enabled: false` for a rank the API would answer 403 (staff): no request, no swallowed error. */
export const useDashboard = (enabled = true) => {
  const tenantKey = useTenantKey();
  return useQuery({ queryKey: ['dashboard', tenantKey], queryFn: dashboardService.dashboard, enabled });
};

export const useIntegrationStatus = () => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['integrations', tenantKey, 'status'],
    queryFn: dashboardService.integrations,
  });
};

export const useRecentOrders = (enabled = true) => {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['dashboard', tenantKey, 'recent-orders'],
    queryFn: dashboardService.recentOrders,
    // Needs the operations capability; don't retry on RBAC/errors on the dashboard.
    retry: false,
    enabled,
  });
};
