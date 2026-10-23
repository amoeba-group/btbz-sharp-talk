import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';

/** Where a category is used — mirrors the API's RoutingCategoryUsage (PLN-261024). */
export interface RoutingCategoryUsage {
  rules: string[];
  units: string[];
  labels: string[];
  companies: number;
}

export interface RoutingCategory {
  id: string;
  code: string;
  /** null = built-in localized name for a known region code, else the code. */
  name: string | null;
  sortOrder: number;
  usage: RoutingCategoryUsage;
}

export const routingCategoriesService = {
  list: () => apiGet<RoutingCategory[]>('/routing-categories'),
  create: (body: { code: string; name?: string }) => apiPost<RoutingCategory>('/routing-categories', body),
  update: (items: Array<{ id: string; name?: string; sort_order?: number }>) =>
    apiPatch<RoutingCategory[]>('/routing-categories', { items }),
  remove: (id: string) => apiDelete<{ deleted: true }>(`/routing-categories/${id}`),
};
