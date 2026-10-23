import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { In, Repository } from 'typeorm';
import { CONSENT_STATE, CONVERSATION_STATUS, CUSTOMER_TYPE, SESSION_IDENTITY } from '@sharptalk/types';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Customer } from '../customer/entity/customer.entity';
import { Session } from '../session/entity/session.entity';
import { CONSENT_NOTICE_VERSION, sessionCacheKey } from '../session/session.service';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import {
  claimedIdentityAttributes,
  IdentityAttributes,
  identitySigningString,
  normalizeIdentityAttributes,
  storedIdentityAttributes,
} from './identity-attributes';
import { unsignedIdentifyAllowed } from './unsigned-identify';
import { TenantAiConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { CompanyService } from '../company/company.service';
import type { Company } from '../company/entity/company.entity';
import { HotelSyncService } from '../go2joy/hotel-sync.service';
import { AuditService } from '../audit/audit.service';

/** What the customer's own server signs, and what the SDK forwards. */
export interface IdentifyInput {
  sessionToken: string;
  userId: string;
  hash: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  /** Signed together with userId when present (PLN-261015 D2). */
  attributes?: Record<string, unknown> | null;
}

/** `shtk_` prefix so a leaked value is recognisable in a log or a paste. */
const SECRET_PREFIX = 'shtk_';

/**
 * Signed identity for embeds outside Shopify and Cafe24 (PLN-260819 S2).
 *
 * Those two platforms hand us a server-verified customer already. Odoo, a
 * bespoke storefront or a mobile app hand us nothing, so the customer's own
 * server signs the user id with a shared secret and we verify the signature.
 *
 * The user id is signed. The profile fields ride along unsigned on purpose:
 * signing them would force the customer's server to re-sign on every profile
 * edit, and they are decoration. Identity ATTRIBUTES (hotel, region, role —
 * PLN-261015 D2) are different: they route handoffs, so when present they are
 * part of the signed string (see identity-attributes.ts).
 */
@Injectable()
export class EmbedService {
  private readonly logger = new Logger(EmbedService.name);

  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    private readonly redis: RedisService,
    // Last + optional: specs build the service positionally. Read-only — the
    // province → region map (handoff_config.provinceRegions, PLN-261022).
    @Optional() @InjectRepository(TenantAiConfig) private readonly aiConfigRepo?: Repository<TenantAiConfig>,
    // B2B account registration + attaching an already-open thread (PLN-261022 stage 2).
    @Optional() private readonly companies?: CompanyService,
    @Optional() @InjectRepository(Conversation) private readonly convRepo?: Repository<Conversation>,
    // Host sign-ins on the agent work log (PLN-261022 P6).
    @Optional() private readonly audit?: AuditService,
    // Hotel profile + room types from the Go2Joy Partner API (PLN-261023 D1-②).
    @Optional() private readonly hotels?: HotelSyncService,
  ) {}

  /**
   * A sign-in that names a hotel makes sure the hotel exists as a company,
   * read from the Partner API (PLN-261023). In the background: the widget must
   * not wait on Go2Joy, and a failure only means the profile arrives later
   * (daily sweep). Signed or claimed alike — the API, not the browser, decides
   * the hotel exists, and nothing is linked to the person here.
   */
  private refreshHotel(tenantId: number, attributes: IdentityAttributes | null): void {
    if (!this.hotels || !attributes?.hotel_id) return;
    void this.hotels.ensureHotel(tenantId, attributes.hotel_id).catch(() => undefined);
  }

  /** New secret, stored encrypted. Returned in full exactly once, to the caller. */
  async rotateSecret(tenantId: number): Promise<string> {
    const secret = `${SECRET_PREFIX}${randomBytes(24).toString('hex')}`;
    await this.tenantRepo.update({ id: tenantId }, { embedSecret: secret });
    return secret;
  }

  /** `null` when the tenant has never generated one. */
  async secretHint(tenantId: number): Promise<{ configured: boolean }> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    return { configured: !!tenant?.embedSecret };
  }

  /** The signature a correctly configured customer server produces. */
  static sign(secret: string, userId: string, attributes: IdentityAttributes | null = null): string {
    return createHmac('sha256', secret).update(identitySigningString(userId, attributes)).digest('hex');
  }

  /**
   * Bind a session to the user their own system says is signed in.
   *
   * Throws E5048 on any failure — including "no secret configured", because the
   * caller cannot tell the difference and should not be able to probe it. The
   * widget stays usable as a guest either way: identity gates order history, not
   * the ability to ask a question. The one exception is a tenant on the
   * unsigned list, whose failed call is kept as 'claimed' (see claimIdentity).
   */
  async identify(input: IdentifyInput): Promise<Session> {
    const session = await this.sessionRepo.findOne({
      where: { sessionToken: input.sessionToken },
    });
    if (!session) {
      throw new BusinessException(ERROR_CODE.SESSION_NOT_FOUND, HttpStatus.NOT_FOUND);
    }

    // Who this session was before the call — a sign-in is logged only when it changes.
    const signedInBefore = signInKey(session);
    const tenant = await this.tenantRepo.findOne({ where: { id: Number(session.tenantId) } });
    const secret = tenant?.embedSecret;
    const attributes = normalizeIdentityAttributes(input.attributes);
    if (!secret || !safeEquals(EmbedService.sign(secret, input.userId, attributes), input.hash)) {
      // A tenant whose host cannot sign yet may hand us the identity unsigned
      // (PLN-261022 unsigned, staging only) — kept as 'claimed', never as a
      // customer. A verified session is never downgraded by an unsigned call.
      if (unsignedIdentifyAllowed(Number(session.tenantId))) {
        if (session.identityLevel !== SESSION_IDENTITY.VERIFIED) {
          const claimed = await this.claimIdentity(session, input, attributes, tenant);
          await this.recordSignIn(claimed, signedInBefore);
          this.refreshHotel(Number(session.tenantId), claimed.identityAttributes as IdentityAttributes | null);
          return claimed;
        }
        this.logger.warn(
          `identify rejected — unsigned call on a verified session (tenant ${session.tenantId}, user ${maskId(input.userId)})`,
        );
      } else if (!secret) {
        this.logger.warn(`identify rejected — no embed secret (tenant ${session.tenantId})`);
      } else {
        this.logger.warn(
          `identify rejected — signature mismatch (tenant ${session.tenantId}, user ${maskId(input.userId)})`,
        );
      }
      throw new BusinessException(ERROR_CODE.EMBED_IDENTITY_INVALID, HttpStatus.UNAUTHORIZED);
    }

    const customer = await this.upsertCustomer(Number(session.tenantId), input);
    session.customerId = Number(customer.id);
    session.identityLevel = SESSION_IDENTITY.VERIFIED;
    // Replaced, never merged: a re-identify for a different hotel must not keep
    // the previous hotel's region. Stored form (PLN-261022): NFC, canonical
    // region, region filled from the province map — AFTER the signature check.
    const stored = storedIdentityAttributes(attributes, await this.provinceRegions(Number(session.tenantId), attributes));
    if (stored.mismatch) {
      this.logger.warn(
        `identify region '${stored.attributes?.region}' differs from the province map ('${stored.mismatch}') — signed value kept (tenant ${session.tenantId})`,
      );
    }
    session.identityAttributes = stored.attributes;
    // B2B account (PLN-261022 stage 2): a signed hotel_id makes this user a
    // contact of that company. Re-identifying without one (chain operator on
    // "all hotels") clears the session's company but never demotes the contact.
    const company = await this.registerAccount(Number(session.tenantId), customer, stored.attributes);
    session.companyId = company ? Number(company.id) : null;
    // Consent via the host's own terms (PLN-261015 D9) — a SIGNED user, so one
    // the host vouches for.
    const consentFromHost = grantHostTermsConsent(session, tenant);
    const saved = await this.sessionRepo.save(session);
    // The token→session cache would keep serving the guest view otherwise.
    await this.redis.del(sessionCacheKey(input.sessionToken));
    // A guest who chatted before signing in: that open thread is now this account's.
    await this.attachOpenConversation(saved);
    this.logger.log(
      `identify ok (tenant ${session.tenantId}, customer ${customer.id}, user ${maskId(input.userId)}` +
        `${attributes ? `, attrs ${Object.keys(attributes).sort().join(',')}, region ${stored.regionSource}` : ''}` +
        `${consentFromHost ? `, consent via host terms v${saved.consentVersion}` : ''}` +
        `${company ? `, company ${company.id}` : ''})`,
    );
    await this.recordSignIn(saved, signedInBefore);
    this.refreshHotel(Number(session.tenantId), stored.attributes);
    return saved;
  }

  /**
   * One work-log row when a session's host user is established or changes
   * (PLN-261022 P6) — not on every page load, which re-identifies the same
   * user. The row names the SESSION; the person's name is resolved from it when
   * the log is read, so no name, email or user id is written to the audit
   * trail. Never fails the identify.
   */
  private async recordSignIn(session: Session, before: string | null): Promise<void> {
    const after = signInKey(session);
    if (!this.audit || !after || after === before) return;
    try {
      await this.audit.write({
        tenantId: session.tenantId != null ? Number(session.tenantId) : null,
        actorType: 'host',
        actorId: Number(session.id),
        action: 'host.user_signed_in',
        target: `session:${session.id}`,
        metadata: {
          level: session.identityLevel,
          hotelId: session.identityAttributes?.hotel_id ?? null,
          region: session.identityAttributes?.region ?? null,
        },
      });
    } catch (err) {
      this.logger.warn(`host sign-in not logged (session ${session.id}): ${(err as Error).message}`);
    }
  }

  /**
   * An identity the host could not sign yet (PLN-261022 unsigned): kept on the
   * SESSION as 'claimed' so agents see who is asking and routing can use the
   * hotel's region — and nothing more. No customer, no company, no consent, no
   * thread: customer-bound features key off `customerId`, and an unsigned id
   * must not open another user's data. Stored in the same normalised form as
   * a signed identify, so region matching behaves the same.
   */
  private async claimIdentity(
    session: Session,
    input: IdentifyInput,
    attributes: IdentityAttributes | null,
    tenant: Tenant | null,
  ): Promise<Session> {
    const tenantId = Number(session.tenantId);
    const stored = storedIdentityAttributes(attributes, await this.provinceRegions(tenantId, attributes));
    session.identityLevel = SESSION_IDENTITY.CLAIMED;
    // Replaced, never merged — same rule as a signed identify.
    session.identityAttributes = claimedIdentityAttributes(input.userId, input.name, stored.attributes);
    // Host-terms consent for an unsigned user only where the tenant opted in
    // (PLN-261023 host_terms_trust=claimed, a UAT aid): skipping the banner
    // affects only this browser, unlike a customer or company record.
    const consentFromHost = tenant?.hostTermsTrust === 'claimed' && grantHostTermsConsent(session, tenant);
    const saved = await this.sessionRepo.save(session);
    await this.redis.del(sessionCacheKey(input.sessionToken));
    const account = await this.registerClaimedAccount(tenantId, input, stored.attributes);
    if (account) await this.attributeOpenConversations(saved, account);
    this.logger.warn(
      `identify claimed — unsigned (tenant ${tenantId}, user ${maskId(input.userId)}` +
        `${attributes ? `, attrs ${Object.keys(attributes).sort().join(',')}, region ${stored.regionSource}` : ''}` +
        `${consentFromHost ? `, consent via host terms v${saved.consentVersion} (claimed)` : ''}` +
        `${account ? `, filed under customer ${account.customerId ?? '-'} company ${account.companyId ?? '-'}` : ''})`,
    );
    return saved;
  }

  /**
   * Company + contact link for a signed identify that names a hotel. Never
   * fails the identify: a registration problem is logged and the user simply
   * proceeds without a company (routing still has the signed attributes).
   */
  private async registerAccount(
    tenantId: number,
    customer: Customer,
    attributes: IdentityAttributes | null,
  ): Promise<Company | null> {
    if (!this.companies || !attributes?.hotel_id) return null;
    try {
      if (customer.customerType !== CUSTOMER_TYPE.B2B_CONTACT) {
        await this.customerRepo.update({ id: customer.id }, { customerType: CUSTOMER_TYPE.B2B_CONTACT });
        customer.customerType = CUSTOMER_TYPE.B2B_CONTACT;
      }
      const company = await this.companies.upsertFromIdentity(tenantId, attributes);
      if (company) await this.companies.linkContact(tenantId, Number(company.id), Number(customer.id), attributes.role ?? null);
      return company;
    } catch (err) {
      this.logger.warn(`company registration failed (tenant ${tenantId}, customer ${customer.id}): ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * The console-side record of a claimed user (PLN-261023 S4, tenants on the
   * unsigned list only): a customer row for the claimed user id — created, or
   * gaps filled, never overwritten — and a contact link to the hotel's
   * company when that company ALREADY exists (partner feed or a signed
   * identify). An unsigned call never creates or edits a company. The SESSION
   * stays without customer and company; only conversations are filed under
   * them. Never throws.
   */
  private async registerClaimedAccount(
    tenantId: number,
    input: IdentifyInput,
    attributes: IdentityAttributes | null,
  ): Promise<{ customerId: number | null; companyId: number | null } | null> {
    try {
      const existing = await this.customerRepo.findOne({ where: { tenantId, externalCustomerId: input.userId } });
      // Name only: an unsigned call never leaves contact details behind.
      const customer = await this.upsertCustomer(tenantId, { ...input, email: undefined, phone: undefined }, true);
      const hotelId = attributes?.hotel_id?.trim();
      const company =
        this.companies && hotelId && /^\d{1,10}$/.test(hotelId)
          ? await this.companies.findHotel(tenantId, Number(hotelId))
          : null;
      if (company && this.companies) {
        // A row this call created becomes a B2B contact; an existing one keeps its type.
        if (!existing && customer.customerType !== CUSTOMER_TYPE.B2B_CONTACT) {
          await this.customerRepo.update({ id: customer.id }, { customerType: CUSTOMER_TYPE.B2B_CONTACT });
          customer.customerType = CUSTOMER_TYPE.B2B_CONTACT;
        }
        await this.companies.linkContact(tenantId, Number(company.id), Number(customer.id), attributes?.role ?? null);
      }
      return { customerId: Number(customer.id), companyId: company ? Number(company.id) : null };
    } catch (err) {
      this.logger.warn(`claimed account not registered (tenant ${tenantId}, user ${maskId(input.userId)}): ${(err as Error).message}`);
      return null;
    }
  }

  /** File a claimed session's open conversations under its account (conversation rows only). Never throws. */
  private async attributeOpenConversations(
    session: Session,
    account: { customerId: number | null; companyId: number | null },
  ): Promise<void> {
    if (!this.convRepo) return;
    try {
      await this.convRepo.update(
        {
          sessionId: session.id,
          status: In([CONVERSATION_STATUS.AI_ACTIVE, CONVERSATION_STATUS.WAITING, CONVERSATION_STATUS.AGENT]),
        },
        { customerId: account.customerId, companyId: account.companyId },
      );
    } catch (err) {
      this.logger.warn(`claimed conversation not attributed (session ${session.id}): ${(err as Error).message}`);
    }
  }

  /** Stamp the session's open conversation with the account it now belongs to. Never throws. */
  private async attachOpenConversation(session: Session): Promise<void> {
    if (!this.convRepo) return;
    try {
      await this.convRepo.update(
        {
          sessionId: session.id,
          status: In([CONVERSATION_STATUS.AI_ACTIVE, CONVERSATION_STATUS.WAITING, CONVERSATION_STATUS.AGENT]),
        },
        { customerId: session.customerId, companyId: session.companyId ?? null },
      );
    } catch (err) {
      this.logger.warn(`open conversation not re-attributed (session ${session.id}): ${(err as Error).message}`);
    }
  }

  /** The tenant's province → region map; only read when a province arrived. Never throws. */
  private async provinceRegions(
    tenantId: number,
    attributes: IdentityAttributes | null,
  ): Promise<Record<string, string> | null> {
    if (!attributes?.province || !this.aiConfigRepo) return null;
    try {
      const config = await this.aiConfigRepo.findOne({ where: { tenantId } });
      return config?.handoffConfig?.provinceRegions ?? null;
    } catch (err) {
      this.logger.warn(`province map unavailable (tenant ${tenantId}): ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * One customer row per (tenant, external id) — the unique key makes a repeated
   * identify() converge instead of growing a row per sign-in, the same rule the
   * Shopify and Cafe24 identity paths already follow.
   */
  private async upsertCustomer(tenantId: number, input: IdentifyInput, claimed = false): Promise<Customer> {
    const existing = await this.customerRepo.findOne({
      where: { tenantId, externalCustomerId: input.userId },
    });
    const customer =
      existing ??
      this.customerRepo.create({
        tenantId,
        externalCustomerId: input.userId,
        tier: 'guest',
        email: null,
        name: null,
        phone: null,
      });

    // Profile fields are unsigned, so they fill gaps but never overwrite what a
    // verified platform path (Shopify/Cafe24 order sync) already established.
    // The display NAME is the exception (PLN-261019 HA D2): only a host that
    // signed the identify reaches here, and the host is the source of truth
    // for what its own user is called — a rename in the host's profile must
    // show in the widget header, not the first name ever seen.
    // A CLAIMED (unsigned) identify only fills a gap (PLN-261023 S4): an
    // unsigned call must not rename a row a signed one established.
    const name = input.name?.trim();
    if (name && (!claimed || !customer.name)) customer.name = name;
    if (input.email && !customer.email) customer.email = input.email;
    if (input.phone && !customer.phone) customer.phone = input.phone;

    try {
      return await this.customerRepo.save(customer);
    } catch (err) {
      // Two tabs signing in at once both miss the lookup and both insert. The
      // unique key is what makes that safe; losing the race is not an error, so
      // re-read the row the winner created instead of 500-ing.
      if (!existing && isDuplicateKey(err)) {
        const winner = await this.customerRepo.findOne({
          where: { tenantId, externalCustomerId: input.userId },
        });
        if (winner) return winner;
      }
      throw err;
    }
  }
}

/** MySQL duplicate-entry, whichever driver shape it arrives in. */
function isDuplicateKey(err: unknown): boolean {
  const e = err as { code?: string; errno?: number; driverError?: { code?: string } };
  return e?.code === 'ER_DUP_ENTRY' || e?.errno === 1062 || e?.driverError?.code === 'ER_DUP_ENTRY';
}

/** Constant-time compare that tolerates length mismatch without throwing. */
function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(String(b ?? ''), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Who a session's host user is, for "did the sign-in change?": the verified
 * customer, or the user id a claimed identify gave. Null for a guest.
 */
function signInKey(session: Session): string | null {
  if (session.identityLevel === SESSION_IDENTITY.VERIFIED && session.customerId != null) {
    return `verified:${session.customerId}`;
  }
  const claimed = session.identityLevel === SESSION_IDENTITY.CLAIMED ? session.identityAttributes?.user_id : null;
  return claimed ? `claimed:${claimed}` : null;
}

/**
 * Record consent through the host's own terms (PLN-261015 D9) when the tenant
 * uses them. An explicit decline in the widget is never overridden. Returns
 * whether the session changed (so the caller can log it).
 */
function grantHostTermsConsent(session: Session, tenant: Tenant | null): boolean {
  if (tenant?.consentSource !== 'host_terms' || session.consentState === CONSENT_STATE.DECLINED) return false;
  const version = tenant.consentNoticeVersion ?? CONSENT_NOTICE_VERSION;
  if (session.consentState === CONSENT_STATE.GRANTED && session.consentVersion === version) return false;
  session.consentState = CONSENT_STATE.GRANTED;
  session.consentAt = new Date();
  session.consentVersion = version;
  return true;
}

/** Never log a full external user id — it is the customer's own identifier. */
function maskId(userId: string): string {
  const value = String(userId ?? '');
  return value.length <= 4 ? '***' : `${value.slice(0, 2)}***${value.slice(-2)}`;
}
