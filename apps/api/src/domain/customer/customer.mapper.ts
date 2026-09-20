import { Customer } from './entity/customer.entity';
import { CustomerResponse } from './dto/response/customer.response';
import { maskEmail, maskName, maskPhone } from '../../global/util/pii-display.util';

/** Aggregated order stats per customer (from orders_cache). */
export interface CustomerOrderStats {
  orders: number;
  totalSpent: number;
  currency: string | null;
}

/**
 * Entity -> response mapping.
 *
 * Contact details are masked here, not in the console (PLN-260920). Encryption
 * at rest protects the database; it does nothing for a response, because the
 * column transformer has already decrypted the value by the time a mapper sees
 * it. Masking at the edge of the API is what keeps plaintext off the wire, out
 * of the browser's memory and network tab, and out of any screen capture.
 *
 * `reveal: true` is reachable only from the audited reveal route.
 */
export class CustomerMapper {
  static toCustomer(
    c: Customer,
    stats?: CustomerOrderStats,
    opts: { reveal?: boolean } = {},
  ): CustomerResponse {
    const reveal = opts.reveal === true;
    return {
      id: c.id,
      tenantId: c.tenantId,
      shopifyCustomerId: c.shopifyCustomerId,
      email: reveal ? c.email : maskEmail(c.email),
      name: reveal ? c.name : maskName(c.name),
      phone: reveal ? c.phone : maskPhone(c.phone),
      masked: !reveal,
      tier: c.tier,
      shopifyTier: c.shopifyTier,
      orders: stats?.orders ?? 0,
      totalSpent: stats?.totalSpent ?? 0,
      currency: stats?.currency ?? null,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  /**
   * List rows carry no phone at all — the customers screen never rendered it,
   * so shipping it was collection without a purpose (PRV-002). A phone number
   * reaches the console only through the reveal route, one customer at a time.
   */
  static toCustomerList(
    customers: Customer[],
    statsById?: Map<string, CustomerOrderStats>,
  ): CustomerResponse[] {
    // Keyed by String(id): bigint ids arrive as strings from the driver, so
    // normalize on both sides to avoid a number-vs-string Map miss.
    return customers.map((c) => {
      const row = this.toCustomer(c, statsById?.get(String(c.id)));
      delete row.phone;
      return row;
    });
  }

  /** Write responses echo back only what the caller was allowed to change. */
  static toCustomerSummary(c: Customer): Pick<CustomerResponse, 'id' | 'name' | 'tier' | 'masked'> {
    return { id: c.id, name: maskName(c.name), tier: c.tier, masked: true };
  }
}
