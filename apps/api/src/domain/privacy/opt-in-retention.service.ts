import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../customer/entity/customer.entity';
import { AuditLog } from '../audit/entity/audit-log.entity';
import { PrivacyService } from './privacy.service';
import { optionalRetentionDays } from '../../global/util/retention-policy.util';

/** Rows handled per query, and queries per run: bounds one scheduled pass. */
const CUSTOMER_BATCH = 200;
const CUSTOMER_MAX_BATCHES = 5;
const AUDIT_DELETE_BATCH = 5000;
const AUDIT_MAX_BATCHES = 100;

/**
 * An audit trail younger than this is never purged, whatever the env says.
 * 90 days is the shortest window in which an incident can still be reconstructed
 * and a 72-hour breach notification evidenced; a typo (`7`) must not be able to
 * erase the very record that proves what the other purges did.
 */
export const AUDIT_LOG_RETENTION_FLOOR_DAYS = 90;

export interface OptInRetentionResult {
  /** Window in force, or null when the purge is OFF (the default). */
  customerRetentionDays: number | null;
  customersAnonymised: number;
  auditLogRetentionDays: number | null;
  auditLogs: number;
}

/**
 * Opt-in disposal of the two tables the conversation purge never touched:
 * `customers` and `audit_logs` (PLN-261012 SG-70, REQ D-17, data-inventory gap).
 *
 * BOTH ARE OFF UNLESS THE OPERATOR SETS A WINDOW. They are legal decisions, not
 * housekeeping: the right number depends on the statute and on how long Go2Joy
 * must be able to prove a consent or answer a regulator, and a deployment that
 * has not decided must keep its rows exactly as before.
 *
 * Why customers are ANONYMISED, not deleted: nothing in the schema declares a
 * foreign key to `customers`, but orders, notifications, sessions and journey
 * events all carry its id. Deleting the row would leave them pointing at nothing
 * (and at an id the database may reuse); scrubbing the personal columns removes
 * the personal data and keeps the history joinable. The scrub is the same one a
 * DSAR erasure runs (PrivacyService.anonymizeInactiveCustomer) minus the
 * suppression record and the Shopify propagation, because an aged-out customer
 * did not object to anything.
 *
 * DSAR / LEGAL-HOLD IMPLICATIONS (also in the PDPL checklist):
 *  - There is no per-customer legal hold. While a hold applies, switch the
 *    window off (or raise it) BEFORE the next scheduled run; whatever has
 *    already been scrubbed or deleted cannot be brought back.
 *  - A data-subject access request must be answered before the data ages out:
 *    the operator DSAR tool exports from live rows only.
 *  - Deleting audit rows also deletes consent evidence (`consent.*`) and DSAR
 *    records (`dsar.*`) older than the window. Choose a window at least as long
 *    as the longest period you may have to prove a consent or a request.
 */
@Injectable()
export class OptInRetentionService {
  private readonly logger = new Logger(OptInRetentionService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
    private readonly privacy: PrivacyService,
  ) {}

  /** CUSTOMER_RETENTION_DAYS, or null (off). */
  customerRetentionDays(): number | null {
    return optionalRetentionDays(this.config.get('CUSTOMER_RETENTION_DAYS'));
  }

  /** AUDIT_LOG_RETENTION_DAYS (floored at 90), or null (off). */
  auditLogRetentionDays(): number | null {
    const days = optionalRetentionDays(this.config.get('AUDIT_LOG_RETENTION_DAYS'));
    if (days == null) return null;
    if (days < AUDIT_LOG_RETENTION_FLOOR_DAYS) {
      this.logger.warn(
        `AUDIT_LOG_RETENTION_DAYS=${days} is below the ${AUDIT_LOG_RETENTION_FLOOR_DAYS}-day floor; using the floor`,
      );
      return AUDIT_LOG_RETENTION_FLOOR_DAYS;
    }
    return days;
  }

  async purge(): Promise<OptInRetentionResult> {
    const customerRetentionDays = this.customerRetentionDays();
    const auditLogRetentionDays = this.auditLogRetentionDays();
    return {
      customerRetentionDays,
      customersAnonymised:
        customerRetentionDays == null ? 0 : await this.anonymiseInactiveCustomers(customerRetentionDays),
      auditLogRetentionDays,
      auditLogs: auditLogRetentionDays == null ? 0 : await this.purgeAuditLogs(auditLogRetentionDays),
    };
  }

  /**
   * Customers with no activity inside the window that still hold a personal
   * identifier. "Activity" is any of: the row itself changing (an identify
   * refreshes `last_claims`), a session of theirs, or an order of theirs.
   * Rows that carry nothing personal any more (already erased or already
   * scrubbed here) never match, so a run is idempotent and cheap to repeat.
   */
  private async anonymiseInactiveCustomers(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let done = 0;
    let after = 0;
    for (let batch = 0; batch < CUSTOMER_MAX_BATCHES; batch++) {
      const rows = await this.customerRepo
        .createQueryBuilder('c')
        .where('c.id > :after', { after })
        .andWhere('c.updated_at < :cutoff', { cutoff })
        .andWhere(
          `(c.email IS NOT NULL OR c.phone IS NOT NULL OR c.shopify_customer_id IS NOT NULL
            OR c.external_customer_id IS NOT NULL OR c.cafe24_user_identifier IS NOT NULL
            OR c.cafe24_member_id IS NOT NULL OR c.last_claims IS NOT NULL)`,
        )
        .andWhere('NOT EXISTS (SELECT 1 FROM sessions s WHERE s.customer_id = c.id AND s.updated_at >= :cutoff)', {
          cutoff,
        })
        .andWhere('NOT EXISTS (SELECT 1 FROM orders_cache o WHERE o.customer_id = c.id AND o.updated_at >= :cutoff)', {
          cutoff,
        })
        .orderBy('c.id', 'ASC')
        .take(CUSTOMER_BATCH)
        .getMany();
      for (const customer of rows) {
        after = Number(customer.id);
        try {
          await this.privacy.anonymizeInactiveCustomer(customer);
          done++;
        } catch (err) {
          // One bad row must not stop the rest; it is retried next run.
          this.logger.warn(`customer ${customer.id} not anonymised: ${(err as Error).message}`);
        }
      }
      if (rows.length < CUSTOMER_BATCH) break;
    }
    if (done > 0) this.logger.log(`customer retention: ${done} anonymised (window ${days}d)`);
    return done;
  }

  /** Delete in bounded chunks so one run cannot hold a long lock on the table. */
  private async purgeAuditLogs(days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let total = 0;
    for (let batch = 0; batch < AUDIT_MAX_BATCHES; batch++) {
      // Raw because TypeORM's DeleteQueryBuilder has no LIMIT; the chunk size is
      // a constant, the cutoff a bound parameter.
      const res = (await this.auditRepo.query('DELETE FROM `audit_logs` WHERE `created_at` < ? LIMIT ?', [
        cutoff,
        AUDIT_DELETE_BATCH,
      ])) as { affectedRows?: number };
      const n = res?.affectedRows ?? 0;
      total += n;
      if (n < AUDIT_DELETE_BATCH) break;
    }
    if (total > 0) this.logger.log(`audit log retention: ${total} rows deleted (window ${days}d)`);
    return total;
  }
}
