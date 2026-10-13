import { apiPost } from '@/lib/api-client';

/**
 * Operator-side data-subject requests (PLN-261012 SG-70). The search term goes in
 * the request BODY, never the URL — a customer's address in a query string ends up
 * in proxy access logs and browser history, which no retention window reaches.
 */
export type DsarLookupBy = 'email' | 'phone' | 'external_id';

/** One match, already masked by the API — enough to tell two people apart. */
export interface DsarCustomerRow {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  externalCustomerId: string | null;
  tier: string;
  lastHotel: { hotelSn: string | null; hotelName: string | null } | null;
  createdAt: string;
}

export interface DsarLookupResult {
  items: DsarCustomerRow[];
  /** More rows matched than shown, or the phone scan hit its cap. */
  truncated: boolean;
}

export const dsarService = {
  lookup: (by: DsarLookupBy, term: string) =>
    apiPost<DsarLookupResult>('/privacy/operator/lookup', { by, term }),
  /** The same machine-readable export a verified shopper gets from the widget. */
  export: (customerId: number, reference?: string) =>
    apiPost<Record<string, unknown>>('/privacy/operator/export', {
      customer_id: customerId,
      ...(reference ? { reference } : {}),
    }),
  /** Irreversible. `confirm_customer_id` must repeat `customer_id` (server-checked). */
  erase: (customerId: number, reference?: string) =>
    apiPost<{ deleted: boolean }>('/privacy/operator/delete', {
      customer_id: customerId,
      confirm_customer_id: customerId,
      confirm: true,
      ...(reference ? { reference } : {}),
    }),
};
