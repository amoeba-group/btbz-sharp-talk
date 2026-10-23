import type {
  AdminProductDetailResponse,
  AdminProductResponse,
  ProductCardResponse,
  ProductDetailResponse,
} from './dto/response/product.response';
import { ProductCache } from './entity/product-cache.entity';

/** Map a catalog row to the compact card shape (grids, recommendation rails). */
export function toProductCardResponse(p: ProductCache): ProductCardResponse {
  return {
    handle: p.handle,
    title: p.title,
    vendor: p.vendor,
    price: p.price,
    currency: p.currency,
    imageUrl: p.imageUrl,
    productUrl: p.productUrl,
    category: p.category,
  };
}

/** Map a catalog row to the full detail shape (product screen). */
export function toProductDetailResponse(p: ProductCache): ProductDetailResponse {
  return {
    ...toProductCardResponse(p),
    sku: p.sku,
    description: p.description,
    tags: p.tags,
    publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
    status: p.status,
  };
}

/** How much description a list row carries before the detail view takes over. */
const SNIPPET_LEN = 100;

/**
 * First ~100 characters, cut on a word boundary when one is near the limit so a
 * row never ends mid-word. Null when there is nothing to say.
 */
export function descriptionSnippet(text: string | null): string | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.length <= SNIPPET_LEN) return trimmed;
  const cut = trimmed.slice(0, SNIPPET_LEN);
  const lastSpace = cut.lastIndexOf(' ');
  // Only honour a space that is actually near the end — Korean text often has
  // none in 100 characters, and cutting at an early space would throw away most
  // of the snippet.
  return `${(lastSpace > SNIPPET_LEN * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Map a catalog row to the console list row (snippet only). */
export function toAdminProductResponse(
  p: ProductCache,
  inKnowledge: boolean,
  companyName: string | null = null,
): AdminProductResponse {
  return {
    handle: p.handle,
    title: p.title,
    vendor: p.vendor,
    category: p.category,
    tags: p.tags,
    sku: p.sku,
    price: p.price,
    currency: p.currency,
    imageUrl: p.imageUrl,
    productUrl: p.productUrl,
    status: p.status,
    publishedAt: p.publishedAt ? p.publishedAt.toISOString() : null,
    syncedAt: p.syncedAt ? p.syncedAt.toISOString() : null,
    descriptionSnippet: descriptionSnippet(p.description),
    inKnowledge,
    companyId: p.companyId != null ? String(p.companyId) : null,
    companyName,
    attributes: p.attributes ?? null,
  };
}

/** Map a catalog row to the console detail view (full description). */
export function toAdminProductDetailResponse(
  p: ProductCache,
  inKnowledge: boolean,
  companyName: string | null = null,
): AdminProductDetailResponse {
  return {
    ...toProductDetailResponse(p),
    syncedAt: p.syncedAt ? p.syncedAt.toISOString() : null,
    inKnowledge,
    companyId: p.companyId != null ? String(p.companyId) : null,
    companyName,
    attributes: p.attributes ?? null,
  };
}
