/** Response shapes — camelCase (PLN-261022 stage 2). */
export interface CompanyResponse {
  id: string;
  externalKey: string;
  name: string | null;
  province: string | null;
  region: string | null;
  contactCount: number;
  conversationCount: number;
  lastSeenAt: string | null;
  lastConversationAt: string | null;
  /** Hotel code / phone / address for the list row (PLN-261023). */
  code: string | null;
  phone: string | null;
  address: string | null;
  /** How many room types are selling (active); 0 before the first Partner sync. */
  roomCount: number;
  partnerSyncedAt: string | null;
}

export interface CompanyContactResponse {
  customerId: string;
  name: string | null;
  role: string | null;
  lastSeenAt: string | null;
}

export interface CompanyConversationResponse {
  id: string;
  /** Its session — what merging it into a room adds (PLN-261023 F1). */
  sessionId: string;
  status: string;
  customerId: string | null;
  customerName: string | null;
  agentId: string | null;
  createdAt: string;
  endedAt: string | null;
}

/** The hotel card on the live-chat customer panel (PLN-261023). */
export interface HotelSummaryResponse {
  companyId: string;
  /** false = found through an unsigned (claimed) sign-in's hotel number. */
  verified: boolean;
  name: string | null;
  code: string | null;
  address: string | null;
  phone: string | null;
  hotelType: string | null;
  partnerInfo: Record<string, unknown> | null;
  sellingRooms: number;
  rooms: Array<{ title: string; price: number | null; currency: string; attributes: Record<string, unknown> | null }>;
}

/** Operator-entered profile (PLN-261023), camelCase. */
export interface CompanyProfileResponse {
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

/** A room type of the company (products_cache row, source go2joy_partner). */
export interface CompanyRoomResponse {
  handle: string;
  title: string;
  status: string;
  imageUrl: string | null;
  currency: string;
  attributes: Record<string, unknown> | null;
  syncedAt: string | null;
}

export interface CompanyDetailResponse extends CompanyResponse {
  profile: CompanyProfileResponse;
  /** Go2Joy Partner API values (read-only on the console); null before the first sync. */
  partnerInfo: Record<string, unknown> | null;
  partnerSyncedAt: string | null;
  partnerSyncError: string | null;
  rooms: CompanyRoomResponse[];
  contacts: CompanyContactResponse[];
  conversations: CompanyConversationResponse[];
}
