import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Repository } from 'typeorm';
import { SESSION_IDENTITY } from '@sharptalk/types';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Customer } from '../customer/entity/customer.entity';
import { Session } from '../session/entity/session.entity';
import { sessionCacheKey } from '../session/session.service';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { IdentityAttributes, identitySigningString, normalizeIdentityAttributes } from './identity-attributes';

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
    // the previous hotel's region.
    session.identityAttributes = attributes;
    const saved = await this.sessionRepo.save(session);
    // The token→session cache would keep serving the guest view otherwise.
    await this.redis.del(sessionCacheKey(input.sessionToken));
    this.logger.log(
      `identify ok (tenant ${session.tenantId}, customer ${customer.id}, user ${maskId(input.userId)}` +
        `${attributes ? `, attrs ${Object.keys(attributes).sort().join(',')}` : ''})`,
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
