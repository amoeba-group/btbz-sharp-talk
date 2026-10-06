import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import { SESSION_IDENTITY } from '@sharptalk/types';
import type { IdentityClaims, IdentityRole } from '@sharptalk/types';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Customer } from '../customer/entity/customer.entity';
import { Session } from '../session/entity/session.entity';
import { sessionCacheKey } from '../session/session.service';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/** identify v2 claims as the controller hands them over (camelCase). */
export interface IdentifyClaimsInput {
  hotelSn: string;
  role: IdentityRole;
  /** Unix seconds at signing time. */
  iat: number;
  hotelName?: string | null;
  hotelCode?: string | null;
}

/** What the customer's own server signs, and what the SDK forwards. */
export interface IdentifyInput {
  sessionToken: string;
  userId: string;
  hash: string;
  /** Present = v2 (PLN-261001 v1.1 H1): the hash must cover these too. */
  claims?: IdentifyClaimsInput | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** `shtk_` prefix so a leaked value is recognisable in a log or a paste. */
const SECRET_PREFIX = 'shtk_';

/**
 * How far a v2 `iat` may sit from our clock (Q7: ±10 minutes). A signature is
 * bound to the moment it was made, so one lifted from a page cannot be
 * presented for a different session tomorrow.
 */
export const CLAIMS_IAT_WINDOW_SEC = 600;

/**
 * Signed identity for embeds outside Shopify and Cafe24 (PLN-260819 S2).
 *
 * Those two platforms hand us a server-verified customer already. Odoo, a
 * bespoke storefront or a mobile app hand us nothing, so the customer's own
 * server signs the user id with a shared secret and we verify the signature.
 *
 * Only the user id is signed. The profile fields ride along unsigned on purpose:
 * signing them would force the customer's server to re-sign on every profile
 * edit, and they are decoration — the id is the claim that matters.
 */
@Injectable()
export class EmbedService {
  private readonly logger = new Logger(EmbedService.name);

  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    private readonly redis: RedisService,
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

  /** The signature a correctly configured customer server produces (v1: user id only). */
  static sign(secret: string, userId: string): string {
    return createHmac('sha256', secret).update(userId).digest('hex');
  }

  /** v2 canonical string — the exact bytes the host must sign (Q7). */
  static canonicalV2(userId: string, hotelSn: string, role: string, iat: number): string {
    return `${userId}|${hotelSn}|${role}|${iat}`;
  }

  /** v2 signature: HMAC over `user_id|hotel_sn|role|iat` (REQ-261006 §3.1). */
  static signV2(secret: string, userId: string, hotelSn: string, role: string, iat: number): string {
    return createHmac('sha256', secret)
      .update(EmbedService.canonicalV2(userId, hotelSn, role, iat))
      .digest('hex');
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

    // v2 (claims present): the signature must cover the claims, and the claims
    // must be fresh. Claims with a v1 hash are refused outright (Q8) — never
    // downgraded to "unsigned but displayed", which the console could not tell
    // from the real thing.
    const claims = input.claims ?? null;
    if (claims) {
      const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(claims.iat));
      if (!Number.isFinite(skew) || skew > CLAIMS_IAT_WINDOW_SEC) {
        this.logger.warn(
          `identify rejected — claims iat outside window (tenant ${session.tenantId}, user ${maskId(input.userId)}, skew ${skew}s)`,
        );
        throw new BusinessException(ERROR_CODE.EMBED_IDENTITY_INVALID, HttpStatus.UNAUTHORIZED);
      }
    }
    const expected = claims
      ? EmbedService.signV2(secret, input.userId, claims.hotelSn, claims.role, claims.iat)
      : EmbedService.sign(secret, input.userId);
    if (!safeEquals(expected, input.hash)) {
      this.logger.warn(
        `identify rejected — signature mismatch (${claims ? 'v2' : 'v1'}; tenant ${session.tenantId}, user ${maskId(input.userId)})`,
      );
      throw new BusinessException(ERROR_CODE.EMBED_IDENTITY_INVALID, HttpStatus.UNAUTHORIZED);
    }

    const customer = await this.upsertCustomer(Number(session.tenantId), input);
    // Partner context travels with the SESSION (a staff account can switch
    // hotels in the host app) and is summarised on the customer for the
    // Customers screen. A v1 identify clears it: no claims means no hotel.
    const identityClaims: IdentityClaims | null = claims
      ? {
          hotelSn: String(claims.hotelSn).trim(),
          role: claims.role,
          hotelName: claims.hotelName?.trim() || null,
          hotelCode: claims.hotelCode?.trim() || null,
          signed: true,
          verifiedAt: new Date().toISOString(),
        }
      : null;
    session.identityClaims = identityClaims;
    session.customerId = Number(customer.id);
    session.identityLevel = SESSION_IDENTITY.VERIFIED;
    const saved = await this.sessionRepo.save(session);
    if (identityClaims) {
      await this.customerRepo.update({ id: customer.id }, { lastClaims: identityClaims });
    }
    // The token→session cache would keep serving the guest view otherwise.
    await this.redis.del(sessionCacheKey(input.sessionToken));
    // hotelSn is a business key, not PII — logged in clear so support can grep it.
    this.logger.log(
      `identify ok (tenant ${session.tenantId}, customer ${customer.id}, user ${maskId(input.userId)}` +
        (identityClaims ? `, hotel ${identityClaims.hotelSn}, role ${identityClaims.role})` : ')'),
    );
    return saved;
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
    if (input.name && !customer.name) customer.name = input.name;
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
