import { apiGet, apiPatch, apiPostList } from '@/lib/api-client';
import type { Paginated } from '@/lib/types';

export interface Customer {
  id: number;
  name?: string;
  email?: string;
  phone?: string;
  /** False only for a record fetched through the audited reveal route. */
  masked?: boolean;
  tier?: string;
  orders?: number;
  totalSpent?: number;
  currency?: string | null;
  createdAt?: string;
}

export interface CustomerListParams {
  page: number;
  pageSize: number;
  email?: string;
}

export const customersService = {
  /**
   * Always a POST, search term or not (PLN-260920 P3).
   *
   * Sending the address only on the searching request would still put it in
   * the logs on exactly the requests that carry one; one code path is also one
   * thing to keep right later.
   */
  list: (params: CustomerListParams) =>
    apiPostList<Customer>('/customers/search', {
      page: String(params.page),
      size: String(params.pageSize),
      email: params.email || undefined,
    }),
  /** Unmasked contact details for one customer. Audited server-side. */
  reveal: (id: number) => apiGet<Customer>(`/customers/${id}/reveal`),
  updateTier: (id: number, tier: string) => apiPatch<Customer>(`/customers/${id}`, { tier }),
};

export type CustomerList = Paginated<Customer>;
