/** Response DTOs — camelCase (PLN-260807-IvyusaApp-Revamp F1). */

/** Compact card for grids / recommendation rails. */
export interface ProductCardResponse {
  handle: string;
  title: string;
  vendor: string | null;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  productUrl: string | null;
  category: string | null;
}

/** Full detail view (product screen). */
export interface ProductDetailResponse extends ProductCardResponse {
  /** Storefront SKU — agents match a chat against stock/order lines (PLN-260807 P0). */
  sku: string | null;
  description: string | null;
  tags: string | null;
  publishedAt: string | null;
  status: string;
}

/**
 * Console row (PLN-260808-Console-Product-List). Not the customer card: it adds
 * what an operator judges the sync by — whether the row is still sold, when it
 * was last seen on the storefront, and whether it reached the knowledge base.
 *
 * Carries a SNIPPET, not the description. A page of 20 rows would otherwise ship
 * 20 full product bodies to render two lines of each; the full text belongs to
 * the detail view that asks for it.
 */
export interface AdminProductResponse {
  handle: string;
  title: string;
  vendor: string | null;
  category: string | null;
  tags: string | null;
  sku: string | null;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  productUrl: string | null;
  status: string;
  publishedAt: string | null;
  syncedAt: string | null;
  /** First ~100 characters of the description, ellipsised. */
  descriptionSnippet: string | null;
  /** A product knowledge document exists for this handle. */
  inKnowledge: boolean;
  /** B2B company the product belongs to (PLN-261023) — null for storefront rows. */
  companyId: string | null;
  companyName: string | null;
  /** Room-type details for a company product; null for storefront rows. */
  attributes: Record<string, unknown> | null;
}

/** One product in full — the console detail view. */
export interface AdminProductDetailResponse extends ProductDetailResponse {
  syncedAt: string | null;
  inKnowledge: boolean;
  companyId: string | null;
  companyName: string | null;
  attributes: Record<string, unknown> | null;
}

/** Header counters above the console list. */
export interface AdminProductSummaryResponse {
  total: number;
  active: number;
  archived: number;
  /** Rows that reached the knowledge base (whole catalogue, not just this page). */
  inKnowledge: number;
  lastSyncedAt: string | null;
}
