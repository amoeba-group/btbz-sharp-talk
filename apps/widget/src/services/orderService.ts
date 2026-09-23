import { apiClient } from '../lib/api-client';
import type {
  OrderDetail,
  OrderLookupResult,
  OrderSummary,
  ReviewItem,
  Tracking,
} from '../lib/types';

export function guestLookup(
  sessionToken: string,
  orderNumber: string,
  email: string,
): Promise<OrderLookupResult> {
  return apiClient.post<OrderLookupResult>('/orders/guest-lookup', {
    session_token: sessionToken,
    order_number: orderNumber,
    email,
  });
}

// Inline "my orders" shows a bounded recent window; anything older/more lives on
// the storefront's own my-page (the list links out). PLN-260808 approved: 10/30.
export const INLINE_ORDER_LIMIT = 10;
export const INLINE_ORDER_DAYS = 30;

/**
 * The Orders TAB reads wider than the chat card: the card is interrupting a
 * conversation and 10/30 keeps it short, while the tab is the screen the shopper
 * opened on purpose (PLN-260818-Widget-Orders-Tab Q2). 90 is also the API's
 * `DAYS_WINDOW_MAX` — asking for more is a 400, not a longer list.
 */
export const TAB_ORDER_LIMIT = 20;
export const TAB_ORDER_DAYS = 90;

export function listOrders(
  sessionToken: string,
  opts: { size?: number; days?: number } = {},
): Promise<OrderSummary[]> {
  return apiClient.get<OrderSummary[]>('/orders', {
    session_token: sessionToken,
    size: String(opts.size ?? INLINE_ORDER_LIMIT),
    days: String(opts.days ?? INLINE_ORDER_DAYS),
  });
}

/** Delivered lines the shopper can review — the Review chip (PLN-260923 P3). */
export function listReviewItems(sessionToken: string): Promise<ReviewItem[]> {
  return apiClient.get<ReviewItem[]>('/orders/review-items', { session_token: sessionToken });
}

export function getOrder(
  id: string,
  sessionToken: string,
): Promise<OrderDetail> {
  return apiClient.get<OrderDetail>(`/orders/${id}`, {
    session_token: sessionToken,
  });
}

/** The session's inquiry (issue) feed — PLN-260809-Issue-Workflow-P3 S2. */
export interface IssueFeedItem {
  issueNo: number;
  type: string;
  status: string;
  rejectReason: string | null;
  updatedAt: string | null;
}

export function listIssues(sessionToken: string): Promise<IssueFeedItem[]> {
  return apiClient
    .get<{ issues: IssueFeedItem[] }>('/issues', { session_token: sessionToken })
    .then((r) => r.issues ?? []);
}

export function getTracking(
  id: string,
  sessionToken: string,
): Promise<Tracking> {
  return apiClient.get<Tracking>(`/orders/${id}/tracking`, {
    session_token: sessionToken,
  });
}
