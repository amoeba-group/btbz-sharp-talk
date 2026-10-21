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
}

export interface CompanyContactResponse {
  customerId: string;
  /** Masked like every customer list (PLN-260920); the full value goes through the audited reveal. */
  name: string | null;
  role: string | null;
  lastSeenAt: string | null;
}

export interface CompanyConversationResponse {
  id: string;
  status: string;
  customerId: string | null;
  customerName: string | null;
  agentId: string | null;
  createdAt: string;
  endedAt: string | null;
}

export interface CompanyDetailResponse extends CompanyResponse {
  contacts: CompanyContactResponse[];
  conversations: CompanyConversationResponse[];
}
