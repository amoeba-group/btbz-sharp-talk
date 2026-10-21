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
  IdentityAttributes,
  identitySigningString,
  normalizeIdentityAttributes,
  storedIdentityAttributes,
} from './identity-attributes';
import { TenantAiConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { CompanyService } from '../company/company.service';
import type { Company } from '../company/entity/company.entity';

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
  ) {}

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
   * the ability to ask a question.
   */
  async identify(input: IdentifyInput): Promise<Session> {
    const session = await this.sessionRepo.findOne({
      where: { sessionToken: input.sessionToken },
    });
    if (!session) {
      throw new BusinessException(ERROR_CODE.SESSION_NOT_FOUND, HttpStatus.NOT_FOUND);
    }

    const tenant = await this.tenantRepo.findOne({ where: { id: Number(session.tenantId) } });
    const secret = tenant?.embedSecret;
    if (!secret) {
      this.logger.warn(`identify rejected — no embed secret (tenant ${session.tenantId})`);
      throw new BusinessException(ERROR_CODE.EMBED_IDENTITY_INVALID, HttpStatus.UNAUTHORIZED);
    }

    const attributes = normalizeIdentityAttributes(input.attributes);
    const expected = EmbedService.sign(secret, input.userId, attributes);
    if (!safeEquals(expected, input.hash)) {
      this.logger.warn(
        `identify rejected — signature mismatch (tenant ${session.tenantId}, user ${maskId(input.userId)})`,
      );
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
    // Consent via the host's own terms (PLN-261015 D9). Only a SIGNED user
    // reaches this line, so only users the host vouches for are covered; an
    // explicit decline in the widget is never overridden.
    let consentFromHost = false;
    if (tenant?.consentSource === 'host_terms' && session.consentState !== CONSENT_STATE.DECLINED) {
      const version = tenant.consentNoticeVersion ?? CONSENT_NOTICE_VERSION;
      if (session.consentState !== CONSENT_STATE.GRANTED || session.consentVersion !== version) {
        session.consentState = CONSENT_STATE.GRANTED;
        session.consentAt = new Date();
        session.consentVersion = version;
        consentFromHost = true;
      }
    }
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
  private async upsertCustomer(tenantId: number, input: IdentifyInput): Promise<Customer> {
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
    const name = input.name?.trim();
    if (name) customer.name = name;
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

/** Never log a full external user id — it is the customer's own identifier. */
function maskId(userId: string): string {
  const value = String(userId ?? '');
  return value.length <= 4 ? '***' : `${value.slice(0, 2)}***${value.slice(-2)}`;
}
