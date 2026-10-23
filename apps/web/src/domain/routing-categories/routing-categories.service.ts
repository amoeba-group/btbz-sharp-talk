import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';

/** Where a consult category is used — mirrors the API's RoutingCategoryUsage (PLN-261024). */
export interface RoutingCategoryUsage {
  rules: string[];
  units: string[];
  labels: string[];
}

export interface RoutingCategory {
  id: string;
  code: string;
  /** null = the code is shown. */
  name: string | null;
  /** Per-language names the widget shows ({en,es,ko,vi,ja,zh}); missing → `name`. */
  names: Record<string, string> | null;
  /** Offered to shoppers in the widget (PLN-261024). */
  visible: boolean;
  sortOrder: number;
  usage: RoutingCategoryUsage;
}

export const routingCategoriesService = {
  list: () => apiGet<RoutingCategory[]>('/routing-categories'),
  create: (body: { code: string; name?: string; visible?: boolean; names?: Record<string, string> }) =>
    apiPost<RoutingCategory>('/routing-categories', body),
  update: (
    items: Array<{ id: string; name?: string; sort_order?: number; visible?: boolean; names?: Record<string, string> }>,
  ) =>
    apiPatch<RoutingCategory[]>('/routing-categories', { items }),
  remove: (id: string) => apiDelete<{ deleted: true }>(`/routing-categories/${id}`),
};
