import { Customer } from './entity/customer.entity';
import { CustomerResponse } from './dto/response/customer.response';
import { maskEmail, maskPhone } from '../../global/util/pii-display.util';

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
 * Names are never masked (2026-10-23: the console is an operator's work
 * screen); e-mail and phone are. `reveal: true` comes from the audited reveal
 * route (single record, phone included) and from the list (e-mail, no phone).
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
      name: c.name,
      phone: reveal ? c.phone : maskPhone(c.phone),
      masked: !reveal,
      tier: c.tier,
      customerType: c.customerType ?? 'b2c',
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
    // Names and e-mails in the clear (2026-10-23 decision): the console lists
    // are where an operator finds a customer; masking applies inside a
    // conversation and to anything sent to an external AI, not here.
    return customers.map((c) => {
      const row = this.toCustomer(c, statsById?.get(String(c.id)), { reveal: true });
      delete row.phone;
      return row;
    });
  }

  /** Write responses echo back only what the caller was allowed to change. */
  static toCustomerSummary(c: Customer): Pick<CustomerResponse, 'id' | 'name' | 'tier' | 'masked'> {
    return { id: c.id, name: c.name, tier: c.tier, masked: true };
  }
}
