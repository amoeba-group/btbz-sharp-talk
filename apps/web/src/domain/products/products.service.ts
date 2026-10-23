import { apiGet, apiGetList, apiPatch } from '@/lib/api-client';

/** A synced catalogue row as the console shows it (PLN-260808-Console-Product-List). */
export interface AdminProduct {
  handle: string;
  title: string;
  vendor: string | null;
  category: string | null;
  tags: string | null;
  sku: string | null;
  /** First ~100 characters of the description; the full text is in the detail view. */
  descriptionSnippet: string | null;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  productUrl: string | null;
  status: string; // active | archived
  publishedAt: string | null;
  syncedAt: string | null;
  /** A product knowledge document exists for this handle. */
  inKnowledge: boolean;
  /** Owning company (B2B tenants, e.g. a hotel's room types); null = storefront row. */
  companyId: string | null;
  companyName: string | null;
  /** Provider-specific attributes — a room type's are {@link RoomTypeAttributes}. */
  attributes: Record<string, unknown> | null;
}

/** Prices of one HA room type, in VND. */
export interface RoomTypePrices {
  firstHours: number | null;
  additional: number | null;
  overnight: number | null;
  oneDay: number | null;
}

/** `attributes` of a room-type product (companyId set, category `room_type`). */
export interface RoomTypeAttributes {
  roomSn: string | number | null;
  /** HA status: 1 selling, 4 rejected, 5 stopped selling. */
  haStatus: number | null;
  firstHours: number | null;
  additionalHours: number | null;
  prices: RoomTypePrices | null;
  extraFee: boolean;
  discount: boolean;
  flashSale: boolean;
  bedType: string | null;
  square: number | string | null;
  facilities: { vi?: string | null; en?: string | null }[] | null;
  /** Absent on rooms synced before PLN-261023 H3. */
  views?: { vi?: string | null; en?: string | null }[] | null;
  images: string[] | null;
  memo: string | null;
  roomCount: number | null;
}

/** A company that owns products (empty for storefront tenants). */
export interface ProductCompany {
  companyId: string;
  count: number;
  name: string | null;
}

/** The row is an HA room type — attributes follow {@link RoomTypeAttributes}. */
export function roomTypeAttrs(p: Pick<AdminProduct, 'companyId' | 'category' | 'attributes'>): RoomTypeAttributes | null {
  if (p.companyId == null || p.category !== 'room_type' || !p.attributes) return null;
  return p.attributes as unknown as RoomTypeAttributes;
}

/** One product in full — the detail dialog. */
export interface AdminProductDetail extends Omit<AdminProduct, 'descriptionSnippet'> {
  description: string | null;
}

export interface AdminProductSummary {
  total: number;
  active: number;
  archived: number;
  inKnowledge: number;
  lastSyncedAt: string | null;
}

export interface ProductListParams {
  page: number;
  pageSize: number;
  q?: string;
  category?: string;
  status?: string;
  /** A company id, or `none` for storefront rows only. */
  companyId?: string;
}

export const productsService = {
  list: (params: ProductListParams) =>
    apiGetList<AdminProduct>('/admin/products', {
      page: params.page,
      size: params.pageSize,
      ...(params.q ? { q: params.q } : {}),
      ...(params.category ? { category: params.category } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.companyId ? { company_id: params.companyId } : {}),
    }),
  detail: (handle: string) =>
    apiGet<AdminProductDetail>(`/admin/products/${encodeURIComponent(handle)}`),
  summary: () => apiGet<AdminProductSummary>('/admin/products/summary'),
  categories: () => apiGet<string[]>('/admin/products/categories'),
  companies: () => apiGet<ProductCompany[]>('/admin/products/companies'),
  updateRoomCount: (handle: string, roomCount: number | null) =>
    apiPatch<AdminProductDetail>(`/admin/products/${encodeURIComponent(handle)}/room-count`, {
      room_count: roomCount,
    }),
};
