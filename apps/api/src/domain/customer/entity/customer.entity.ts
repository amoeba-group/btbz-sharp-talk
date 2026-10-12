import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { IdentityClaims } from '@sharptalk/types';
import { bigintTransformer } from '../../../global/util/transformers';
import { blindIndex, decryptPii, encryptPii } from '../../../global/util/crypto.util';

/**
 * Transparent PII-at-rest transformer (PRV-M6): the property is the plaintext
 * string; the column stores AES-256-GCM ciphertext bytes. Reads decrypt (and
 * tolerate legacy plaintext), writes encrypt.
 */
const piiTransformer = {
  to: (value: string | null): Buffer | null => encryptPii(value),
  from: (value: Buffer | null): string | null => decryptPii(value),
};

/** customers — Shopify customer cache + tenancy/tier columns (FR-057). PII encrypted at rest. */
// One row per Shopify customer per tenant: the app-proxy identity path (id, no
// email) and the order-sync path (email) must converge on the same row, or
// sessions bind to a different customer than the one holding the orders
// (FIX-Customer-Duplicate-ShopifyId-20260803). NULL ids (guest lookups) are
// exempt — MySQL unique indexes permit repeated NULLs.
@Index('uq_customers_tenant_shopify', ['tenantId', 'shopifyCustomerId'], { unique: true })
// Same convergence rule as shopify_customer_id, for Cafe24: the customer-auth
// identity path (user_identifier, no email) and order sync (email) must land on
// one row (PLN-260808 P-A2). NULLs repeat freely under a MySQL unique index.
@Index('uq_customers_tenant_cafe24_uid', ['tenantId', 'cafe24UserIdentifier'], { unique: true })
// Mall login id from the customer token response — the direct join key to an
// order's member_id (PLN-260808-Cafe24-MemberId-RecentOrders).
@Index('uq_customers_tenant_cafe24_mid', ['tenantId', 'cafe24MemberId'], { unique: true })
// Generic signed identity (PLN-260819 S2): the id the customer's OWN system
// uses. Same convergence rule as the platform ids above — one row per external
// user per tenant — so a shopper who signs in through the SDK lands on the row
// their orders are already attached to.
@Index('uq_customers_tenant_external', ['tenantId', 'externalCustomerId'], { unique: true })
@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  @Column({ name: 'tenant_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  @Index('idx_customers_tenant')
  tenantId: number | null;

  @Column({ name: 'shopify_customer_id', type: 'varchar', length: 64, nullable: true })
  shopifyCustomerId: string | null;

  // Cafe24 storefront member's verified unique identifier (server-checked via the
  // customeraccesstoken flow). Opaque pseudonym — a hash of mall+shop+client+user,
  // not PII — so stored plaintext and used as the join key, never the email.
  @Column({ name: 'cafe24_user_identifier', type: 'varchar', length: 120, nullable: true })
  cafe24UserIdentifier: string | null;

  // Cafe24 member login id (`user_id` from the token response — server-verified,
  // never client-supplied). Matches orders_cache.member_id for inline "my orders".
  @Column({ name: 'cafe24_member_id', type: 'varchar', length: 64, nullable: true })
  cafe24MemberId: string | null;

  /**
   * User id from the customer's own system, bound via the signed `identify`
   * handshake (PLN-260819 S2). Never trusted on its own — it is written only
   * after the HMAC over it verifies against the tenant's embed secret.
   */
  @Column({ name: 'external_customer_id', type: 'varchar', length: 120, nullable: true })
  externalCustomerId: string | null;

  // Email is encrypted (unsearchable ciphertext), so equality lookups go through
  // the deterministic email_hash blind index instead (PRV-M6).
  @Column({ type: 'varbinary', length: 512, nullable: true, transformer: piiTransformer })
  email: string | null;

  @Column({ name: 'email_hash', type: 'varchar', length: 64, nullable: true })
  @Index('idx_customers_email_hash')
  emailHash: string | null;

  @Column({ type: 'varbinary', length: 512, nullable: true, transformer: piiTransformer })
  name: string | null;

  @Column({ type: 'varbinary', length: 256, nullable: true, transformer: piiTransformer })
  phone: string | null;

  @Column({ type: 'varchar', length: 16, default: 'guest' })
  tier: string; // guest/subscriber/regular

  @Column({ name: 'shopify_tier', type: 'varchar', length: 32, nullable: true })
  shopifyTier: string | null;

  /**
   * Most recent signed partner context for this person (REQ-261006): the
   * hotel/role their last identify v2 carried, for the Customers screen. The
   * per-conversation truth is `sessions.identity_claims`; this is the "last
   * known" summary and is overwritten on every successful identify.
   */
  @Column({ name: 'last_claims', type: 'json', nullable: true })
  lastClaims: IdentityClaims | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  /** Keep email_hash in lockstep with email on every write (PRV-M6). */
  @BeforeInsert()
  @BeforeUpdate()
  syncEmailHash(): void {
    this.emailHash = blindIndex(this.email);
  }
}
