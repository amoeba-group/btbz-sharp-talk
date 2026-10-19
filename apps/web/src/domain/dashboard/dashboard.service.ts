import { apiGet } from '@/lib/api-client';

export interface DashboardData {
  activeChats: number;
  todayNotifications: number;
  aiResolutionRate: number; // 0..1 or 0..100
  unresolvedTopN: number;
  totalConversations: number;
  totalOrders: number;
  // Backend returns a de-duplicated list of recent question strings.
  popularQuestions: string[];
}

// Mirrors the API's integration_status row — the field is `name`, and reading
// a `provider` that never existed is what left the dashboard labels blank.
export interface IntegrationStatus {
  /** Provider key (shopify/cafe24/odoo/notion/self/…) — the per-tenant endpoint's field (FIX-260827). */
  provider: string;
  /** Legacy field of the global /integrations/status row; kept for callers still passing it. */
  name?: string;
  status: string; // connected / error / unknown
  lastSyncAt?: string | null;
  lastTestedAt?: string | null;
  detail?: string | null;
}

export interface RecentOrder {
  id: string;
  orderNumber: string;
  statusUi?: string;
  statusInternal?: string;
  total?: number;
  currency?: string;
  itemCount?: number;
  createdAt?: string;
}

export const dashboardService = {
  dashboard: () => apiGet<DashboardData>('/analytics/dashboard'),
  // Per-tenant integration status only — no global/mock rows (FIX-260827).
  integrations: () => apiGet<IntegrationStatus[]>('/tenants/me/integrations'),
  recentOrders: () => apiGet<RecentOrder[]>('/admin/orders', { page: 1, size: 5 }),
};
