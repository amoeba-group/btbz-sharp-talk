import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, In, IsNull, Repository } from 'typeorm';
import { Customer } from './entity/customer.entity';
import { blindIndex } from '../../global/util/crypto.util';
import { OrderCache } from '../order/entity/order-cache.entity';
import { CustomerOrderStats } from './customer.mapper';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { ErasureSuppressionService } from '../privacy/erasure-suppression.service';
import { AuditService } from '../audit/audit.service';
import { maskPii } from '../../global/util/pii.util';

/** Customer detail shown in the agent console context panel (FR-045). */
export interface CustomerContext {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** True when name/email/phone above are masked (PLN-260920). */
  masked?: boolean;
  tier: string;
  recentOrders: { id: number; status: string | null; total: number | null; createdAt: Date }[];
}

/** Loose lead fields captured during a live chat to create a new customer. */
export interface CustomerLead {
  name?: string;
  email?: string;
  phone?: string;
}

/** Customer cache + tenancy/tier management (FR-057). All queries tenant-scoped. */
@Injectable()
export class CustomerService {
  constructor(
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(OrderCache) private readonly orderRepo: Repository<OrderCache>,
    private readonly suppression: ErasureSuppressionService,
    private readonly audit: AuditService,
  ) {}

  async list(
    tenantId: number,
    page: number,
    size: number,
    email?: string,
  ): Promise<{ items: Customer[]; total: number; stats: Map<string, CustomerOrderStats> }> {
    const where: FindOptionsWhere<Customer> = { tenantId };
    // Email is encrypted — partial LIKE is impossible; match the exact address
    // via the blind index (PRV-M6). Blank/garbage search returns nothing.
    if (email) where.emailHash = blindIndex(email) ?? '__none__';
    const [items, total] = await this.customerRepo.findAndCount({
      where,
      order: { id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
    const stats = await this.orderStats(
      tenantId,
      items.map((c) => c.id),
    );
    return { items, total, stats };
  }

  /** Aggregate order count + total spent per customer from orders_cache. */
  private async orderStats(
    tenantId: number,
    customerIds: number[],
  ): Promise<Map<string, CustomerOrderStats>> {
    const map = new Map<string, CustomerOrderStats>();
    if (customerIds.length === 0) return map;
    const rows = await this.orderRepo
      .createQueryBuilder('o')
      .select('o.customerId', 'customerId')
      .addSelect('COUNT(*)', 'orders')
      .addSelect('COALESCE(SUM(o.total), 0)', 'totalSpent')
      // A representative currency for the total (customers are typically single-currency).
      .addSelect('MAX(o.currency)', 'currency')
      .where('o.tenantId = :tenantId', { tenantId })
      .andWhere('o.customerId IN (:...customerIds)', { customerIds })
      .groupBy('o.customerId')
      .getRawMany<{
        customerId: string | number;
        orders: string;
        totalSpent: string;
        currency: string | null;
      }>();
    for (const r of rows) {
      // bigint ids arrive as strings; key by String to match the entity's id.
      map.set(String(r.customerId), {
        orders: Number(r.orders) || 0,
        totalSpent: Number(r.totalSpent) || 0,
        currency: r.currency ?? null,
      });
    }
    return map;
  }

  async findById(tenantId: number, id: number): Promise<Customer> {
    const customer = await this.customerRepo.findOne({ where: { id, tenantId } });
    if (!customer) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return customer;
  }

  /**
   * The customer behind an explicit reveal request, plus the audit row that
   * makes the read accountable (PRV-040). Masking is the default everywhere
   * else; this is the one door out, and it is a narrow, logged one.
   */
  async reveal(tenantId: number, id: number, actorUserId: number): Promise<Customer> {
    const customer = await this.findById(tenantId, id);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId: actorUserId,
      action: 'customer.pii_revealed',
      target: `customer:${id}`,
      // The audit row records that contact details were read, never the
      // details (audit-log.entity: metadata is never raw PII).
      metadata: { email: maskPii(customer.email) },
    });
    return customer;
  }

  /** Full context (profile + recent orders) for the agent console panel. */
  async getContext(tenantId: number, customerId: number): Promise<CustomerContext> {
    const customer = await this.findById(tenantId, customerId);
    const orders = await this.orderRepo.find({
      where: { tenantId, customerId },
      order: { createdAt: 'DESC' },
      take: 5,
    });
    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      tier: customer.tier,
      recentOrders: orders.map((o) => ({
        id: o.id,
        status: o.statusUi ?? o.statusInternal,
        total: o.total,
        createdAt: o.createdAt,
      })),
    };
  }

  /**
   * The customer's contact address, or null when we hold none. Tenant-scoped:
   * an off-hours reply must never be mailed to another store's shopper.
   */
  async contactEmail(tenantId: number, customerId: number): Promise<string | null> {
    const row = await this.customerRepo.findOne({
      where: { id: customerId, tenantId },
      select: { id: true, email: true },
    });
    return row?.email?.trim() || null;
  }

  /**
   * Contact fields keyed by String(id), for lists that must identify a customer.
   * Two decrypts per row (name + email) instead of one — the console list needs
   * a fallback when a shopper left only an address (PLN-260807).
   */
  async contactsByIds(
    tenantId: number,
    ids: number[],
  ): Promise<Map<string, { name: string | null; email: string | null }>> {
    const map = new Map<string, { name: string | null; email: string | null }>();
    if (ids.length === 0) return map;
    const rows = await this.customerRepo.find({
      where: { tenantId, id: In(ids) },
      select: { id: true, name: true, email: true },
    });
    for (const c of rows) {
      map.set(String(c.id), { name: c.name?.trim() || null, email: c.email?.trim() || null });
    }
    return map;
  }

  /** Display names keyed by String(id), for enriching lists that reference customers. */
  async namesByIds(tenantId: number, ids: number[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (ids.length === 0) return map;
    // Only id+name: every selected PII column costs an AES-GCM decrypt per row,
    // and this list-enrichment path needs nothing but the display name.
    const rows = await this.customerRepo.find({
      where: { tenantId, id: In(ids) },
      select: { id: true, name: true },
    });
    for (const c of rows) {
      if (c.name) map.set(String(c.id), c.name);
    }
    return map;
  }

  /** Bounded scan window for the encrypted-column app-side name/email filter (PRV-M6). */
  private static readonly SEARCH_SCAN = 500;

  /**
   * Match candidates for the "link existing customer" search. Email is matched
   * exactly through the blind index; name/partial-email can't be queried on
   * ciphertext, so a bounded, tenant-scoped recent window is decrypted and
   * filtered in-app (PRV-M6).
   */
  async searchByEmailOrName(tenantId: number, query: string, limit = 10): Promise<Customer[]> {
    const q = query.trim();
    if (!q) return [];

    const found = new Map<number, Customer>();
    const hash = blindIndex(q);
    if (hash) {
      const byEmail = await this.customerRepo.find({
        where: { tenantId, emailHash: hash },
        take: limit,
      });
      for (const c of byEmail) found.set(c.id, c);
    }
    if (found.size < limit) {
      const pool = await this.customerRepo.find({
        where: { tenantId },
        order: { id: 'DESC' },
        take: CustomerService.SEARCH_SCAN,
      });
      const ql = q.toLowerCase();
      for (const c of pool) {
        if (found.size >= limit) break;
        if (found.has(c.id)) continue;
        if (c.name?.toLowerCase().includes(ql) || c.email?.toLowerCase().includes(ql)) {
          found.set(c.id, c);
        }
      }
    }
    return [...found.values()].slice(0, limit);
  }

  /** Create a customer from chat-captured lead fields. Reuses the email row if present. */
  async createFromLead(tenantId: number, lead: CustomerLead): Promise<Customer> {
    const email = lead.email?.trim() || null;
    // An agent must be told, not silently ignored: this address asked to be erased,
    // and re-keying it from a chat transcript would rebuild the profile by hand.
    if (email && (await this.suppression.isSuppressed(tenantId, { email }))) {
      throw new BusinessException(ERROR_CODE.IDENTITY_ERASED, HttpStatus.CONFLICT);
    }
    if (email) {
      const existing = await this.customerRepo.findOne({
        where: { tenantId, emailHash: blindIndex(email) ?? '__none__' },
      });
      if (existing) {
        let dirty = false;
        if (lead.name && existing.name !== lead.name) {
          existing.name = lead.name;
          dirty = true;
        }
        if (lead.phone && existing.phone !== lead.phone) {
          existing.phone = lead.phone;
          dirty = true;
        }
        return dirty ? this.customerRepo.save(existing) : existing;
      }
    }
    const customer = this.customerRepo.create({
      tenantId,
      email,
      name: lead.name?.trim() || null,
      phone: lead.phone?.trim() || null,
      tier: 'guest',
    });
    return this.customerRepo.save(customer);
  }

  async update(
    tenantId: number,
    id: number,
    changes: { name?: string; tier?: string },
  ): Promise<Customer> {
    const customer = await this.findById(tenantId, id);
    if (changes.name !== undefined) customer.name = changes.name;
    if (changes.tier !== undefined) customer.tier = changes.tier;
    return this.customerRepo.save(customer);
  }

  /**
   * Lookup-or-create by email within a tenant. Shared with other modules.
   *
   * Returns null when the identity is on the erasure suppression list — the caller
   * must then leave whatever it was linking unlinked. Order sync is the reason this
   * exists: Shopify keeps the address after we scrub it, so without this check the
   * next poll recreated the shopper and re-linked their orders minutes later.
   */
  async findOrCreateByEmail(
    tenantId: number,
    email: string,
    name?: string,
    shopifyCustomerId?: string,
  ): Promise<Customer | null> {
    if (await this.suppression.isSuppressed(tenantId, { email, shopifyCustomerId })) {
      return null;
    }
    // Prefer the email-hash row, but fall back to the Shopify-id row so we merge
    // (not duplicate) a customer the app-proxy identity path already created with
    // email:null. Without this, a shopper who opens the widget before their order
    // history syncs gets a second Customer row, and their historical orders point
    // to a different id than the proxy-verified session is bound to — so the
    // logged-in "my orders" list comes back empty.
    const existing =
      (await this.customerRepo.findOne({
        where: { tenantId, emailHash: blindIndex(email) ?? '__none__' },
      })) ??
      (shopifyCustomerId
        ? await this.customerRepo.findOne({ where: { tenantId, shopifyCustomerId } })
        : null);
    if (existing) {
      let dirty = false;
      if (existing.email !== email) {
        existing.email = email; // @BeforeUpdate re-syncs email_hash
        dirty = true;
      }
      if (name !== undefined && existing.name !== name) {
        existing.name = name;
        dirty = true;
      }
      if (shopifyCustomerId !== undefined && existing.shopifyCustomerId !== shopifyCustomerId) {
        existing.shopifyCustomerId = shopifyCustomerId;
        dirty = true;
      }
      return dirty ? this.customerRepo.save(existing) : existing;
    }
    // No email match — the app-proxy identity path may have already created an
    // email-less row for this Shopify customer (it only has the numeric id).
    // Adopt that row instead of creating a duplicate: a second row would leave
    // sessions bound to one customer and orders linked to another
    // (FIX-Customer-Duplicate-ShopifyId-20260803).
    if (shopifyCustomerId) {
      const byShopifyId = await this.customerRepo.findOne({
        where: { tenantId, shopifyCustomerId },
      });
      if (byShopifyId) {
        byShopifyId.email = email;
        if (name !== undefined) byShopifyId.name = name;
        return this.customerRepo.save(byShopifyId);
      }
    }
    const customer = this.customerRepo.create({
      tenantId,
      email,
      name: name ?? null,
      shopifyCustomerId: shopifyCustomerId ?? null,
      tier: 'guest',
    });
    return this.customerRepo.save(customer);
  }

  /**
   * Lookup-or-create by Shopify customer id within a tenant. Used when a logged-in
   * storefront customer is resolved via the app proxy (we have the numeric Shopify
   * id but not necessarily an email). Reuses the row synced from orders, if any.
   *
   * Returns null for a suppressed identity: erasure survives the shopper signing
   * back into the storefront, so the widget treats them as a fresh anonymous
   * visitor rather than rebuilding the profile they asked us to delete.
   */
  async findOrCreateByShopifyId(
    tenantId: number,
    shopifyCustomerId: string,
  ): Promise<Customer | null> {
    if (await this.suppression.isSuppressed(tenantId, { shopifyCustomerId })) {
      return null;
    }
    const existing = await this.customerRepo.findOne({
      where: { tenantId, shopifyCustomerId },
    });
    if (existing) return existing;
    const customer = this.customerRepo.create({
      tenantId,
      email: null,
      name: null,
      shopifyCustomerId,
      tier: 'guest',
    });
    return this.customerRepo.save(customer);
  }

  /** The customer bound to a verified Cafe24 member identifier, or null. */
  async findByCafe24Identifier(
    tenantId: number,
    userIdentifier: string,
  ): Promise<Customer | null> {
    return this.customerRepo.findOne({ where: { tenantId, cafe24UserIdentifier: userIdentifier } });
  }

  /**
   * Lookup-or-create by Cafe24 member identifier (PLN-260808 P-A2). Called from the
   * customer-auth callback, where we hold the server-verified `user_identifier` but
   * not necessarily an email — the row is enriched later when order sync links the
   * same identifier to an address. Mirrors findOrCreateByShopifyId: an email-less row
   * here converges with the order-synced row via linkCafe24Customer, never duplicates.
   */
  async findOrCreateByCafe24Identifier(
    tenantId: number,
    userIdentifier: string,
  ): Promise<Customer> {
    const existing = await this.findByCafe24Identifier(tenantId, userIdentifier);
    if (existing) return existing;
    const customer = this.customerRepo.create({
      tenantId,
      email: null,
      name: null,
      cafe24UserIdentifier: userIdentifier,
      tier: 'guest',
    });
    return this.customerRepo.save(customer);
  }

  /** The customer holding this Cafe24 member login id, or null. */
  async findByCafe24MemberId(tenantId: number, memberId: string): Promise<Customer | null> {
    return this.customerRepo.findOne({ where: { tenantId, cafe24MemberId: memberId } });
  }

  /**
   * Stamp the server-verified Cafe24 member login id (`user_id` from the token
   * response) onto the session-bound customer, then retro-link any orders that
   * were synced before we knew who this member is (member_id saved, customer link
   * unresolved). PLN-260808-Cafe24-MemberId-RecentOrders.
   *
   * If ANOTHER row already holds this member id (order sync stamped it onto an
   * email row before this member ever signed in), converge on the session row the
   * same way linkCafe24Customer does: repoint its orders, copy contact fields the
   * session row lacks, and drop the duplicate — "my orders" must never split.
   */
  async adoptCafe24MemberId(
    tenantId: number,
    customerId: number,
    memberId: string,
  ): Promise<void> {
    const target = await this.customerRepo.findOne({ where: { tenantId, id: customerId } });
    if (!target) return;
    const holder = await this.findByCafe24MemberId(tenantId, memberId);
    if (holder && holder.id !== target.id) {
      await this.orderRepo.update({ tenantId, customerId: holder.id }, { customerId: target.id });
      if (!target.email && holder.email) target.email = holder.email;
      if (!target.name && holder.name) target.name = holder.name;
      await this.customerRepo.remove(holder);
    }
    if (target.cafe24MemberId !== memberId) {
      target.cafe24MemberId = memberId;
      await this.customerRepo.save(target);
    }
    // Orders synced before any sign-in carry member_id but no customer link —
    // adopt them now. Never steals rows already linked elsewhere.
    await this.orderRepo.update(
      { tenantId, memberId, customerId: IsNull() },
      { customerId: target.id },
    );
  }

  /**
   * Order-sync convergence for Cafe24 (PLN-260808 P-A2): attach email/name to the
   * member's row and stamp the `user_identifier` so the customer-auth session and
   * the email-synced orders land on ONE row. Adopts an identifier-only row created
   * earlier by the auth path (the reverse of findOrCreateByEmail's shopify merge),
   * so "my orders" is never split across two customers. Returns null for a
   * suppressed (erased) address.
   */
  async linkCafe24Customer(
    tenantId: number,
    email: string,
    name: string | undefined,
    userIdentifier: string | null,
  ): Promise<Customer | null> {
    if (await this.suppression.isSuppressed(tenantId, { email })) return null;
    const emailHash = blindIndex(email) ?? '__none__';
    const idRow = userIdentifier
      ? await this.customerRepo.findOne({ where: { tenantId, cafe24UserIdentifier: userIdentifier } })
      : null;
    const emailRow = await this.customerRepo.findOne({ where: { tenantId, emailHash } });

    // Two distinct rows — the sign-in created an identifier row (session-bound, no
    // orders) and order sync created an email row (orders, no identifier). Merge the
    // order row INTO the session row so "my orders" resolves, then drop the now-empty
    // duplicate. Order rows are the only reference an order-synced customer carries
    // (it never chatted), so repointing orders_cache is a complete merge.
    if (idRow && emailRow && idRow.id !== emailRow.id) {
      await this.orderRepo.update(
        { tenantId, customerId: emailRow.id },
        { customerId: idRow.id },
      );
      idRow.email = email; // @BeforeUpdate re-syncs email_hash
      if (name != null) idRow.name = name;
      else if (!idRow.name && emailRow.name) idRow.name = emailRow.name;
      const merged = await this.customerRepo.save(idRow);
      await this.customerRepo.remove(emailRow);
      return merged;
    }

    const existing = idRow ?? emailRow;
    if (existing) {
      let dirty = false;
      if (existing.email !== email) {
        existing.email = email; // @BeforeUpdate re-syncs email_hash
        dirty = true;
      }
      if (name != null && existing.name !== name) {
        existing.name = name;
        dirty = true;
      }
      if (userIdentifier && existing.cafe24UserIdentifier !== userIdentifier) {
        existing.cafe24UserIdentifier = userIdentifier;
        dirty = true;
      }
      return dirty ? this.customerRepo.save(existing) : existing;
    }
    const customer = this.customerRepo.create({
      tenantId,
      email,
      name: name ?? null,
      cafe24UserIdentifier: userIdentifier ?? null,
      tier: 'guest',
    });
    return this.customerRepo.save(customer);
  }

  /**
   * Best-effort profile backfill for a customer located by Shopify id. The
   * app-proxy identity path creates the row with name/email null (it only has the
   * numeric id); once the Admin API can read the customer we fill those in. Only
   * fills fields still empty — never clobbers a value order-sync or an agent set —
   * and skips the email when another row in the tenant already owns that address,
   * so we never mint a duplicate email_hash (the reverse of the findOrCreateByEmail
   * merge). Returns the (possibly unchanged) row, or null if the id is unknown.
   *
   * Also declines for a suppressed identity. Reaching a matching row at all would
   * mean anonymization missed one, and this method's whole job — writing a name and
   * email back onto it from the Admin API — is precisely the un-erasure.
   */
  async backfillProfileByShopifyId(
    tenantId: number,
    shopifyCustomerId: string,
    profile: { email?: string | null; name?: string | null },
  ): Promise<Customer | null> {
    if (await this.suppression.isSuppressed(tenantId, { shopifyCustomerId, email: profile.email })) {
      return null;
    }
    const row = await this.customerRepo.findOne({
      where: { tenantId, shopifyCustomerId },
    });
    if (!row) return null;
    let dirty = false;
    if (!row.name && profile.name) {
      row.name = profile.name;
      dirty = true;
    }
    if (!row.email && profile.email) {
      const hash = blindIndex(profile.email);
      const clash = hash
        ? await this.customerRepo.findOne({ where: { tenantId, emailHash: hash } })
        : null;
      if (!clash) {
        row.email = profile.email; // @BeforeUpdate re-syncs email_hash
        dirty = true;
      }
    }
    return dirty ? this.customerRepo.save(row) : row;
  }
}
