import { apiGet, apiGetList, apiPatch, apiPostList } from '@/lib/api-client';
import type { Paginated } from '@/lib/types';

export interface Customer {
  id: number;
  name?: string;
  email?: string;
  phone?: string;
  /** False only for a record fetched through the audited reveal route. */
  masked?: boolean;
  tier?: string;
  /** b2c | b2b_contact (PLN-261022 stage 2). */
  customerType?: string;
  orders?: number;
  totalSpent?: number;
  currency?: string | null;
  createdAt?: string;
}

export interface CustomerListParams {
  page: number;
  pageSize: number;
  email?: string;
  /** b2c | b2b_contact; omitted = both. */
  customerType?: string;
}

/** B2B company (PLN-261022 stage 2) — a partner hotel for Go2Joy. */
export interface Company {
  id: string;
  externalKey: string;
  name: string | null;
  province: string | null;
  region: string | null;
  contactCount: number;
  conversationCount: number;
  lastSeenAt: string | null;
  lastConversationAt: string | null;
}

export interface CompanyConversation {
  id: string;
  status: string;
  customerId: string | null;
  customerName: string | null;
  agentId: string | null;
  createdAt: string;
  endedAt: string | null;
}

export interface CompanyDetail extends Company {
  contacts: Array<{ customerId: string; name: string | null; role: string | null; lastSeenAt: string | null }>;
  conversations: CompanyConversation[];
}

export interface CompanyListParams {
  page: number;
  pageSize: number;
  q?: string;
  region?: string;
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
      customer_type: params.customerType || undefined,
    }),
  companies: (params: CompanyListParams) =>
    apiGetList<Company>('/companies', {
      page: params.page,
      size: params.pageSize,
      q: params.q || undefined,
      region: params.region || undefined,
    }),
  company: (id: string) => apiGet<CompanyDetail>(`/companies/${id}`),
  /** Unmasked contact details for one customer. Audited server-side. */
  reveal: (id: number) => apiGet<Customer>(`/customers/${id}/reveal`),
  updateTier: (id: number, tier: string) => apiPatch<Customer>(`/customers/${id}`, { tier }),
};

export type CustomerList = Paginated<Customer>;
