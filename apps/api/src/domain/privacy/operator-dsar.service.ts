import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customer/entity/customer.entity';
import { AuditService } from '../audit/audit.service';
import { PrivacyService } from './privacy.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { blindIndex } from '../../global/util/crypto.util';
import { maskEmail, maskName, maskPhone } from '../../global/util/pii-display.util';
import type { DsarLookupBy } from './dto/request/operator-dsar.request';

/** Most rows a lookup returns; more means the term was too loose. */
export const DSAR_LOOKUP_LIMIT = 20;
/** Phone numbers are encrypted with no blind index, so a lookup scans; this bounds it. */
const PHONE_SCAN_BATCH = 500;
const PHONE_SCAN_MAX_ROWS = 20_000;

/** One match, masked: enough to tell two people apart, not to reach either. */
export interface DsarCustomerRow {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  externalCustomerId: string | null;
  tier: string;
  /** Last signed partner context, for telling same-named people apart. */
  lastHotel: { hotelSn: string | null; hotelName: string | null } | null;
  createdAt: Date;
}

export interface DsarLookupResult {
  items: DsarCustomerRow[];
  /** More rows matched than were returned, or the phone scan hit its cap. */
  truncated: boolean;
}

/** `+84 912-345-678`, `0912345678`, `0084912345678` all key to `0912345678`. */
export function phoneKey(raw: string | null | undefined): string {
  let digits = String(raw ?? '').replace(/\D+/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Vietnam and Korea are the markets here: the country code replaces the trunk 0.
  if (digits.startsWith('84') && digits.length >= 11) digits = `0${digits.slice(2)}`;
  if (digits.startsWith('82') && digits.length >= 11) digits = `0${digits.slice(2)}`;
  return digits;
}

/**
 * Operator-side data-subject requests (PLN-261012 SG-70).
 *
 * Until now only a shopper whose session was Shopify-VERIFIED could export or
 * erase their data (SEC-C3), which leaves everyone else — a Go2Joy partner who
 * emails a request, a person who lost their device — with no way to exercise a
 * right the notice promises. This lets a privileged operator do it on their
 * behalf, through the SAME PrivacyService compilation and scrub the widget path
 * uses, scoped to the operator's own tenant and audited per action.
 *
 * Nothing here decides whether the requester is who they claim to be. That is a
 * procedure (docs/guide/GUIDE-261013-Go2Joy-PDPL-Checklist.md), not code.
 */
@Injectable()
export class OperatorDsarService {
  private readonly logger = new Logger(OperatorDsarService.name);

  constructor(
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    private readonly privacy: PrivacyService,
    private readonly audit: AuditService,
  ) {}

  async lookup(tenantId: number, actorId: number, by: DsarLookupBy, rawTerm: string): Promise<DsarLookupResult> {
    const term = rawTerm.trim();
    if (term.length < 3) {
      throw new BusinessException(ERROR_CODE.DSAR_LOOKUP_INVALID, HttpStatus.BAD_REQUEST);
    }

    let found: Customer[];
    let truncated = false;
    if (by === 'email') {
      // Email is encrypted; the deterministic blind index answers equality only.
      const hash = blindIndex(term);
      found = hash
        ? await this.customerRepo.find({ where: { tenantId, emailHash: hash }, take: DSAR_LOOKUP_LIMIT + 1 })
        : [];
    } else if (by === 'external_id') {
      found = await this.customerRepo.find({
        where: { tenantId, externalCustomerId: term },
        take: DSAR_LOOKUP_LIMIT + 1,
      });
    } else {
      ({ found, truncated } = await this.scanByPhone(tenantId, term));
    }

    if (found.length > DSAR_LOOKUP_LIMIT) {
      truncated = true;
      found = found.slice(0, DSAR_LOOKUP_LIMIT);
    }

    // The term itself is never written down — only how it was searched and how
    // many rows it matched (the audit table must not collect what it protects).
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'dsar.lookup',
      metadata: { by, matches: found.length, truncated },
    });
    return { items: found.map((c) => this.toRow(c)), truncated };
  }

  /**
   * Phone is stored encrypted (random IV) with no blind index, so it cannot be
   * matched in SQL. Walk the tenant's customers that have one, decrypting in
   * the entity transformer, bounded by PHONE_SCAN_MAX_ROWS. A deployment large
   * enough to hit the cap should add a `phone_hash` blind index (follow-up) —
   * until then `truncated` tells the operator the answer may be incomplete.
   */
  private async scanByPhone(tenantId: number, term: string): Promise<{ found: Customer[]; truncated: boolean }> {
    const wanted = phoneKey(term);
    if (wanted.length < 6) throw new BusinessException(ERROR_CODE.DSAR_LOOKUP_INVALID, HttpStatus.BAD_REQUEST);
    const found: Customer[] = [];
    let after = 0;
    let scanned = 0;
    while (scanned < PHONE_SCAN_MAX_ROWS) {
      const rows = await this.customerRepo
        .createQueryBuilder('c')
        .where('c.tenant_id = :tenantId', { tenantId })
        .andWhere('c.phone IS NOT NULL')
        .andWhere('c.id > :after', { after })
        .orderBy('c.id', 'ASC')
        .take(PHONE_SCAN_BATCH)
        .getMany();
      for (const r of rows) {
        if (phoneKey(r.phone) === wanted) found.push(r);
        after = Number(r.id);
      }
      scanned += rows.length;
      if (found.length > DSAR_LOOKUP_LIMIT) return { found, truncated: true };
      if (rows.length < PHONE_SCAN_BATCH) return { found, truncated: false };
    }
    return { found, truncated: true };
  }

  async exportFor(tenantId: number, actorId: number, customerId: number, reference?: string | null) {
    await this.requireTenantCustomer(tenantId, customerId);
    return this.privacy.exportCustomer(customerId, { userId: actorId, reference: reference ?? null });
  }

  async eraseFor(
    tenantId: number,
    actorId: number,
    customerId: number,
    confirmCustomerId: number,
    reference?: string | null,
  ): Promise<void> {
    if (Number(confirmCustomerId) !== Number(customerId)) {
      this.logger.warn(`operator erasure refused: confirmation mismatch (tenant ${tenantId}, actor ${actorId})`);
      throw new BusinessException(ERROR_CODE.DSAR_CONFIRM_MISMATCH, HttpStatus.BAD_REQUEST);
    }
    await this.requireTenantCustomer(tenantId, customerId);
    await this.privacy.eraseCustomer(customerId, { userId: actorId, reference: reference ?? null });
  }

  /**
   * The customer, or a 404 that is identical for "does not exist" and "belongs
   * to another tenant" — an id probe must learn nothing about other tenants.
   */
  private async requireTenantCustomer(tenantId: number, customerId: number): Promise<Customer> {
    const customer = await this.customerRepo.findOne({ where: { id: customerId, tenantId } });
    if (!customer) {
      this.logger.warn(`operator DSAR: customer ${customerId} not in tenant ${tenantId}`);
      throw new BusinessException(ERROR_CODE.DSAR_CUSTOMER_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return customer;
  }

  private toRow(c: Customer): DsarCustomerRow {
    const claims = c.lastClaims as { hotelSn?: string; hotelName?: string } | null;
    return {
      // bigint ids arrive from the driver as strings; the console and the DSAR
      // request DTOs both want a number.
      id: Number(c.id),
      name: maskName(c.name),
      email: maskEmail(c.email),
      phone: maskPhone(c.phone),
      externalCustomerId: c.externalCustomerId ?? null,
      tier: c.tier,
      lastHotel: claims ? { hotelSn: claims.hotelSn ?? null, hotelName: claims.hotelName ?? null } : null,
      createdAt: c.createdAt,
    };
  }
}
