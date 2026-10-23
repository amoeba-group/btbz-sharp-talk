import { apiGet, apiGetList, apiPatch, apiPost, apiPostList } from '@/lib/api-client';
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
  /** Hotel profile summary (PLN-261023). */
  code?: string | null;
  phone?: string | null;
  address?: string | null;
  /** Selling room types. */
  roomCount?: number;
  partnerSyncedAt?: string | null;
}

/** Operator-entered hotel profile (PLN-261023). */
export interface CompanyProfile {
  code: string | null;
  phone: string | null;
  district: string | null;
  address: string | null;
  groupName: string | null;
  promotion: boolean | null;
  hot: boolean | null;
  isNew: boolean | null;
  contractStart: string | null;
  contractEnd: string | null;
  payment: string | null;
  hotelType: string | null;
  enterpriseName: string | null;
  enterpriseRegNo: string | null;
  extraFee: boolean | null;
  descriptionEn: string | null;
  descriptionVi: string | null;
  policyEn: string | null;
  policyVi: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

interface HoursWindow {
  enabled: boolean;
  start: number | null;
  end: number | null;
}

/** The routing province → region map (PLN-261023 H1-a). source null = entered by SQL. */
export interface ProvinceRegionStatus {
  total: number;
  syncedAt: string | null;
  source: string | null;
  regions: Record<string, number>;
}

export interface ProvinceRegionSyncResult {
  total: number;
  added: number;
  changed: number;
  kept: number;
  syncedAt: string;
}

/** Go2Joy Partner API values — read-only (PLN-261023). */
export interface CompanyPartnerInfo {
  name: string | null;
  firstHours: number | null;
  hourly: HoursWindow;
  overnight: HoursWindow;
  daily: HoursWindow;
  cancellation: {
    hourlyMinutes: number | null;
    overnightMinutes: number | null;
    dailyMinutes: number | null;
    afterBookingMinutes: number | null;
  } | null;
  /** Absent on hotels synced before PLN-261023 H2. */
  cancelBeforeHours?: number | null;
  rightNowTonight?: { start: number; end: number } | null;
}

export interface RoomAttributes {
  haStatus: number | null;
  firstHours: number | null;
  additionalHours: number | null;
  prices: { firstHours: number | null; additional: number | null; overnight: number | null; oneDay: number | null };
  extraFee: boolean;
  discount: boolean;
  flashSale: boolean;
  bedType: number | null;
  square: number | null;
  facilities: Array<{ vi: string | null; en: string | null }>;
  views?: Array<{ vi: string | null; en: string | null }>;
  images: string[];
  memo: string | null;
  roomCount: number | null;
}

export interface CompanyRoom {
  handle: string;
  title: string;
  status: string;
  imageUrl: string | null;
  currency: string;
  attributes: RoomAttributes | null;
  syncedAt: string | null;
}

/** PATCH body — snake_case; '' / null clears. */
export type CompanyProfileUpdate = Partial<Record<
  | 'name' | 'code' | 'phone' | 'province' | 'district' | 'address' | 'group_name' | 'contract_start' | 'contract_end'
  | 'payment' | 'hotel_type' | 'enterprise_name' | 'enterprise_reg_no' | 'description_en' | 'description_vi'
  | 'policy_en' | 'policy_vi',
  string | null
> & Record<'promotion' | 'hot' | 'is_new' | 'extra_fee', boolean | null>>;

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
  profile: CompanyProfile;
  partnerInfo: CompanyPartnerInfo | null;
  partnerSyncedAt: string | null;
  partnerSyncError: string | null;
  rooms: CompanyRoom[];
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
  /** Add a Go2Joy hotel by number — confirmed + filled from the Partner API (PLN-261023). */
  addHotel: (hotelSn: number) => apiPost<CompanyDetail>('/companies', { hotel_sn: hotelSn }),
  syncCompany: (id: string) => apiPost<CompanyDetail>(`/companies/${id}/sync`),
  provinceRegions: () => apiGet<ProvinceRegionStatus>('/companies/province-regions'),
  syncProvinceRegions: () => apiPost<ProvinceRegionSyncResult>('/companies/province-regions/sync'),
  updateCompanyProfile: (id: string, body: CompanyProfileUpdate) =>
    apiPatch<CompanyDetail>(`/companies/${id}/profile`, body),
  /** Unmasked contact details for one customer. Audited server-side. */
  reveal: (id: number) => apiGet<Customer>(`/customers/${id}/reveal`),
  updateTier: (id: number, tier: string) => apiPatch<Customer>(`/customers/${id}`, { tier }),
};

export type CustomerList = Paginated<Customer>;
