/** Response DTO — camelCase. */
export interface CustomerResponse {
  id: number;
  tenantId: number | null;
  shopifyCustomerId: string | null;
  email: string | null;
  name: string | null;
  /** Omitted from list rows — the list screen has no use for it (PLN-260920). */
  phone?: string | null;
  /** True when name/email/phone above are masked. The console uses this to
   *  decide whether to offer the reveal control, and to label what is shown. */
  masked: boolean;
  tier: string;
  shopifyTier: string | null;
  orders: number;
  totalSpent: number;
  currency: string | null;
  createdAt: Date;
  updatedAt: Date;
}
