import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { In, IsNull, Repository } from 'typeorm';
import { CJM_STAGE, CONSENT_STATE, CONVERSATION_STATUS, SESSION_IDENTITY, normalizeIdentityPolicy } from '@sharptalk/types';
import type { IdentityClaims, IdentityRole } from '@sharptalk/types';
import { generateToken } from '@sharptalk/common';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Customer } from '../customer/entity/customer.entity';
import { Session } from '../session/entity/session.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { sessionCacheKey } from '../session/session.service';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { EventBusService, EVENTS } from '../../infrastructure/infrastructure.module';
import { AuditService } from '../audit/audit.service';
import { IssueService } from '../issue/issue.service';
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
  /** Hotel province (PLN-261007). When non-empty it is part of the signature. */
  province?: string | null;
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
 * How long a verified v2 signature is remembered (PLN-261012 SG-04). A signature
 * is acceptable from `iat - window` to `iat + window`, so it can be presented for
 * up to twice the window; remembering it for exactly that long is what closes the
 * replay gap without keeping anything longer than it could matter.
 */
export const IDENTIFY_REPLAY_TTL_SEC = 2 * CLAIMS_IAT_WINDOW_SEC;

/** Why an identify was refused — in the audit row and the log, never in the response. */
export type IdentifyRefusal =
  | 'no_secret'
  | 'v1_refused'
  | 'iat_window'
  | 'bad_signature'
  | 'replay';

/** Replay memory of one signature: who presented it first, and the session that came out of it. */
interface ReplayRecord {
  /** SHA-256 of the first session token to present the signature. */
  t: string;
  /** Session token the identify forked into, when it forked — a re-send answers with it. */
  s?: string;
}

type ReplayVerdict =
  | { kind: 'fresh' }
  | { kind: 'same'; forkedTo?: string; viaFork: boolean }
  | { kind: 'replayed' }
  /** Redis could not answer — the signature window is the only guard left. */
  | { kind: 'unchecked' };

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
    // Appended last so positional test doubles that predate logout stay valid.
    // Only `logout()` and the conversation-stamp backfill read it, `?.`-guarded.
    @InjectRepository(Conversation) private readonly convRepo?: Repository<Conversation>,
    // PLN-261012 SG-50: identity events land in audit_logs (actor `system` — nobody
    // clicked anything in our console). Appended and optional like the above.
    @Optional() private readonly audit?: AuditService,
    // Ending the AI thread on logout must close its issue the way the customer's own
    // "end chat" does. IssueModule imports only entities + Audit + Moderation, so
    // EmbedModule can import it without a cycle.
    @Optional() private readonly issueService?: IssueService,
    // A forked session is a new visit: it announces itself to the journey like a fresh one.
    @Optional() private readonly bus?: EventBusService,
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

  /**
   * v2 canonical string — the exact bytes the host must sign (Q7).
   *
   * `province` (PLN-261007) is appended ONLY when present. The string being
   * signed therefore depends on whether the field travels, so a province can
   * neither be added to nor stripped from a signed identify without breaking
   * the signature: the one signature a host produced fits exactly one of the
   * two shapes.
   */
  static canonicalV2(
    userId: string,
    hotelSn: string,
    role: string,
    iat: number,
    province?: string | null,
  ): string {
    const base = `${userId}|${hotelSn}|${role}|${iat}`;
    return typeof province === 'string' && province.length > 0 ? `${base}|${province}` : base;
  }

  /** v2 signature: HMAC over `user_id|hotel_sn|role|iat[|province]` (REQ-261006 §3.1). */
  static signV2(
    secret: string,
    userId: string,
    hotelSn: string,
    role: string,
    iat: number,
    province?: string | null,
  ): string {
    return createHmac('sha256', secret)
      .update(EmbedService.canonicalV2(userId, hotelSn, role, iat, province))
      .digest('hex');
  }

  /**
   * Bind a session to the user their own system says is signed in.
   *
   * Throws E5048 on any failure — including "no secret configured", a signature that
   * was already used for another session and a tenant that refuses v1, because the
   * caller cannot tell the difference and should not be able to probe it. The
   * widget stays usable as a guest either way: identity gates order history, not
   * the ability to ask a question.
   *
   * The returned session is NOT always the one passed in: when the session is
   * already bound to someone else (another user, hotel or role) a new session is
   * created and returned, and the caller must adopt its token. Failures are
   * decided before anything is written, so a rejected identify changes nothing.
   */
  async identify(input: IdentifyInput): Promise<Session> {
    const session = await this.sessionRepo.findOne({
      where: { sessionToken: input.sessionToken },
    });
    if (!session) {
      throw new BusinessException(ERROR_CODE.SESSION_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    const tenantId = Number(session.tenantId);

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const secret = tenant?.embedSecret;

    // Every refusal answers with the SAME error: telling a bad signature from a
    // replay, a stale iat or a tenant that refuses v1 would hand a prober an oracle.
    // The real reason goes to the log and to the audit row, nowhere else.
    const refuse = async (reason: IdentifyRefusal, detail: string): Promise<never> => {
      this.logger.warn(
        `identify rejected — ${detail} (tenant ${tenantId}, user ${maskId(input.userId)})`,
      );
      await this.auditRejected(tenantId, session.id, input, reason);
      throw new BusinessException(ERROR_CODE.EMBED_IDENTITY_INVALID, HttpStatus.UNAUTHORIZED);
    };

    if (!secret) return refuse('no_secret', 'no embed secret');

    // v2 (claims present): the signature must cover the claims, and the claims
    // must be fresh. Claims with a v1 hash are refused outright (Q8) — never
    // downgraded to "unsigned but displayed", which the console could not tell
    // from the real thing.
    const claims = input.claims ?? null;

    // A tenant that has moved to v2 can refuse the v1 handshake (PLN-261012 SG-04):
    // its signature never expires and cannot say which hotel or role the person
    // acts for. No policy stored = v1 stays allowed, exactly as before.
    if (!claims && normalizeIdentityPolicy(tenant?.identityPolicy)?.refuseV1) {
      return refuse('v1_refused', 'v1 identify refused by tenant policy');
    }

    if (claims) {
      // `iat` is part of the signed string verbatim, so a non-integer is not just
      // odd, it is a different message than the host could have meant (the DTO
      // already insists on an integer; this is the service's own line).
      const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(claims.iat));
      if (!Number.isInteger(claims.iat) || !Number.isFinite(skew) || skew > CLAIMS_IAT_WINDOW_SEC) {
        return refuse('iat_window', `claims iat outside window (skew ${skew}s)`);
      }
    }
    const expected = claims
      ? EmbedService.signV2(secret, input.userId, claims.hotelSn, claims.role, claims.iat, claims.province)
      : EmbedService.sign(secret, input.userId);
    if (!safeEquals(expected, input.hash)) {
      return refuse('bad_signature', `signature mismatch (${claims ? 'v2' : 'v1'})`);
    }

    // Replay guard (PLN-261012 SG-04, REQ D-05). Only a signature that VERIFIED is
    // recorded, so a prober cannot fill the store with junk. A v2 signature belongs
    // to one session: the same one presented again is idempotent, another session's
    // token presenting it inside the window is refused like a bad signature. v1 has
    // no `iat` and is a standing credential — there is no window to protect.
    let verdict: ReplayVerdict = { kind: 'fresh' };
    if (claims && replayGuardEnabled()) {
      verdict = await this.claimSignature(tenantId, input.hash, input.sessionToken);
      if (verdict.kind === 'replayed') {
        return refuse('replay', 'signature already used for another session');
      }
      if (verdict.kind === 'same' && verdict.forkedTo) {
        // This exact identify already forked into a new session; forking again would
        // pile up sessions on every retry. Answer with the one it made.
        const earlier = await this.sessionRepo.findOne({ where: { sessionToken: verdict.forkedTo } });
        if (earlier) return earlier;
      }
    }

    const customer = await this.upsertCustomer(tenantId, input);
    // Partner context travels with the SESSION (a staff account can switch
    // hotels in the host app) and is summarised on the customer for the
    // Customers screen. A v1 identify clears it: no claims means no hotel.
    const identityClaims: IdentityClaims | null = claims
      ? {
          hotelSn: String(claims.hotelSn).trim(),
          role: claims.role,
          hotelName: claims.hotelName?.trim() || null,
          hotelCode: claims.hotelCode?.trim() || null,
          province: claims.province?.trim() || null,
          signed: true,
          verifiedAt: new Date().toISOString(),
        }
      : null;

    // One session = one (person, hotel, role) (PLN-261012 SG-02, REQ D-02).
    // Conversations hang off the session, so rebinding it to someone else would
    // hand the new person the previous one's thread, open queue entry and consent
    // — and feed that history into the prompt. A different principal therefore
    // gets a NEW session; the old one is left exactly as it was.
    const rebinds = principalChanged(session, Number(customer.id), identityClaims);
    const sameCustomer = session.customerId != null && Number(session.customerId) === Number(customer.id);

    let saved: Session;
    if (rebinds) {
      saved = await this.sessionRepo.save(
        this.sessionRepo.create({
          ...carriedOver(session, sameCustomer),
          sessionToken: generateToken(),
          customerId: Number(customer.id),
          identityLevel: SESSION_IDENTITY.VERIFIED,
          identityClaims,
        }),
      );
    } else {
      // Guest → user upgrade (no customer yet), or the same principal again:
      // same session, claims and verifiedAt refreshed.
      session.identityClaims = identityClaims;
      session.customerId = Number(customer.id);
      session.identityLevel = SESSION_IDENTITY.VERIFIED;
      saved = await this.sessionRepo.save(session);
      await this.stampOpenConversations(session.id, identityClaims);
    }
    if (identityClaims) {
      await this.customerRepo.update({ id: customer.id }, { lastClaims: identityClaims });
    }
    // The token→session cache would keep serving the guest view otherwise. A
    // forked session is brand new, so only the in-place path has an entry to
    // drop; the old session is untouched and its cache entry stays correct.
    if (!rebinds) await this.redis.del(sessionCacheKey(input.sessionToken));
    // hotelSn is a business key, not PII — logged in clear so support can grep it.
    this.logger.log(
      `identify ${rebinds ? `forked session ${session.id} → ${saved.id}` : 'ok'} ` +
        `(tenant ${session.tenantId}, customer ${customer.id}, user ${maskId(input.userId)}` +
        (identityClaims ? `, hotel ${identityClaims.hotelSn}, role ${identityClaims.role})` : ')'),
    );

    if (rebinds) {
      // The re-send of this very identify must find the session it created.
      await this.rememberFork(tenantId, input.hash, saved.sessionToken, claims != null);
      await this.announceFork(saved, Number(customer.id));
    }
    const who = {
      v: claims ? 2 : 1,
      user: userKey(tenantId, input.userId),
      ...(identityClaims ? { hotelSn: identityClaims.hotelSn, role: identityClaims.role } : {}),
    };
    await this.auditEvent('embed.identify_ok', tenantId, `session:${saved.id}`, {
      ...who,
      forked: rebinds,
      ...(verdict.kind === 'unchecked' ? { replayGuard: 'unavailable' } : {}),
    });
    if (rebinds) {
      await this.auditEvent('embed.identity_forked', tenantId, `session:${session.id}`, {
        ...who,
        toSession: Number(saved.id),
        // Same person on another hotel/role keeps the consent they gave; a different
        // person starts over (PLN-261012 S1 follow-up).
        sameCustomer,
      });
    }
    return saved;
  }

  /**
   * End the host user's binding to a widget session (PLN-261012 SG-02, REQ D-03).
   *
   * Until now `ShopTalk.logout()` only made the widget forget the token; the
   * session on the server kept the claims and the open conversation. Here the
   * server side is closed too:
   *
   *  - an AI-owned open conversation is ended — it belongs to the person who just
   *    left. One a human is on (`agent`) or that is queued for a human (`waiting`)
   *    is NOT closed: ending it would silently drop a support request somebody is
   *    handling. Only the identity is unbound from it.
   *  - customer, claims and identity level go back to guest.
   *
   * Idempotent: a session that is already a guest just reports success. The token
   * is the credential, as on every other widget-session endpoint; an unknown one
   * answers like `identify` does.
   */
  async logout(sessionToken: string): Promise<{ loggedOut: true }> {
    const session = await this.sessionRepo.findOne({ where: { sessionToken } });
    if (!session) {
      throw new BusinessException(ERROR_CODE.SESSION_NOT_FOUND, HttpStatus.NOT_FOUND);
    }

    const wasBound = session.customerId != null;

    // Conversation first: if this throws the binding is still intact and the
    // caller can simply retry; the reverse order could strand an open AI thread
    // on a session that no longer says whose it was.
    let endedConversations = 0;
    let endedIds: number[] = [];
    if (this.convRepo) {
      const open = await this.convRepo.find({
        where: { sessionId: session.id, status: CONVERSATION_STATUS.AI_ACTIVE },
        select: { id: true },
      });
      endedIds = (open ?? []).map((c) => Number(c.id));
      const res = await this.convRepo.update(
        { sessionId: session.id, status: CONVERSATION_STATUS.AI_ACTIVE },
        { status: CONVERSATION_STATUS.ENDED, endedAt: new Date() },
      );
      endedConversations = res?.affected ?? 0;
    }

    await this.sessionRepo.update(
      { id: session.id },
      { customerId: null, identityClaims: null, identityLevel: SESSION_IDENTITY.GUEST },
    );
    await this.redis.del(sessionCacheKey(sessionToken));
    // A thread the customer's own "end chat" would have closed also closes its
    // issue (PLN-261012 S1 follow-up). `customerEnded` stays false: leaving the
    // host app is not a satisfaction signal, so nothing is auto-resolved here.
    if (endedConversations > 0) {
      for (const id of endedIds) {
        void this.issueService
          ?.onConversationEnded(id, false)
          .catch((e: Error) => this.logger.warn(`issue close hook failed on logout: ${e.message}`));
      }
    }
    this.logger.log(
      `logout ok (tenant ${session.tenantId}, session ${session.id}, ` +
        `was ${wasBound ? 'bound' : 'guest'}, ended ${endedConversations} AI conversation(s))`,
    );
    await this.auditEvent('embed.logout', Number(session.tenantId), `session:${session.id}`, {
      wasBound,
      endedConversations,
    });
    return { loggedOut: true };
  }

  /**
   * Remember a verified v2 signature, or tell who has it (PLN-261012 SG-04).
   *
   * `SET NX` keyed by tenant + hash: the first session to present it wins. The
   * stored value names that session by a digest, not the token itself — the key
   * only ever needs to be compared. A different session presenting it inside the
   * window is a replay; the same session presenting it again is a retry.
   */
  private async claimSignature(tenantId: number, hash: string, sessionToken: string): Promise<ReplayVerdict> {
    const key = replayKey(tenantId, hash);
    const mine = tokenDigest(sessionToken);
    const created = await this.redis.setIfAbsent(key, JSON.stringify({ t: mine } satisfies ReplayRecord), IDENTIFY_REPLAY_TTL_SEC);
    if (created === null) {
      // Fail open: a sign-in must not break because Redis is down, and the ±iat
      // window still bounds a replay. The audit row says the guard did not run.
      this.logger.warn(`identify replay guard unavailable — Redis cannot answer (tenant ${tenantId})`);
      return { kind: 'unchecked' };
    }
    if (created) return { kind: 'fresh' };

    const record = parseReplayRecord(await this.redis.get(key));
    if (!record) {
      // It expired between the two calls. Claim it again; losing that race too means
      // somebody else got there first, which is a replay.
      const again = await this.redis.setIfAbsent(key, JSON.stringify({ t: mine } satisfies ReplayRecord), IDENTIFY_REPLAY_TTL_SEC);
      return again === false ? { kind: 'replayed' } : { kind: 'fresh' };
    }
    if (record.t === mine) return { kind: 'same', forkedTo: record.s, viaFork: false };
    // The session this identify forked INTO is the same flow's result: the widget
    // adopts it and may identify again on it with the very same signature.
    if (record.s && tokenDigest(record.s) === mine) return { kind: 'same', viaFork: true };
    return { kind: 'replayed' };
  }

  /** Note which session a forking identify produced, so a re-send answers with it. */
  private async rememberFork(tenantId: number, hash: string, forkedToken: string, v2: boolean): Promise<void> {
    if (!v2 || !replayGuardEnabled()) return;
    const key = replayKey(tenantId, hash);
    const record = parseReplayRecord(await this.redis.get(key));
    if (!record) return; // guard unavailable or expired — nothing to annotate
    await this.redis.set(key, JSON.stringify({ ...record, s: forkedToken } satisfies ReplayRecord), IDENTIFY_REPLAY_TTL_SEC);
  }

  /**
   * A forked session is a new visit, so it announces itself to the journey the same
   * way a fresh session does (PLN-261012 S1 follow-up). Never blocks the sign-in.
   */
  private async announceFork(saved: Session, customerId: number): Promise<void> {
    try {
      await this.bus?.publish(EVENTS.CJM, {
        tenantId: saved.tenantId,
        sessionId: saved.id,
        customerId,
        stage: CJM_STAGE.AWARENESS,
        eventType: 'session_start',
      });
    } catch (e) {
      this.logger.warn(`session_start event failed for forked session ${saved.id}: ${(e as Error).message}`);
    }
  }

  /**
   * A guest who signs in on the same session keeps the thread they already started;
   * stamp it with the hotel and role they turned out to be (PLN-261012 SG-50).
   * Only rows still unstamped are touched — a stamp is never overwritten — and only
   * the OPEN ones: a finished conversation was not with this identity.
   */
  private async stampOpenConversations(sessionId: number, claims: IdentityClaims | null): Promise<void> {
    if (!claims || !this.convRepo) return;
    try {
      await this.convRepo.update(
        {
          sessionId,
          hotelSn: IsNull(),
          status: In([
            CONVERSATION_STATUS.AI_ACTIVE,
            CONVERSATION_STATUS.WAITING,
            CONVERSATION_STATUS.AGENT,
          ]),
        },
        { hotelSn: claims.hotelSn.slice(0, 32), actorRole: claims.role.slice(0, 16) },
      );
    } catch (e) {
      // The stamp is analytics; the sign-in already succeeded.
      this.logger.warn(`conversation stamp backfill failed (session ${sessionId}): ${(e as Error).message}`);
    }
  }

  /** `audit_logs` row for an identity event — actor `system`, no PII, never fails the call. */
  private async auditEvent(
    action: string,
    tenantId: number,
    target: string,
    metadata: Record<string, unknown>,
    result: 'success' | 'denied' = 'success',
  ): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.write({ tenantId, actorType: 'system', actorId: 0, action, target, result, metadata });
    } catch (e) {
      this.logger.warn(`${action} audit write failed: ${(e as Error).message}`);
    }
  }

  /**
   * Audit a refused identify. A prober can fire these as fast as the throttle lets
   * it, so one row per (tenant, reason, user) per minute is kept — the rest are a
   * counter in the log. Without Redis every refusal is written.
   */
  private async auditRejected(
    tenantId: number,
    sessionId: number,
    input: IdentifyInput,
    reason: IdentifyRefusal,
  ): Promise<void> {
    if (!this.audit) return;
    const user = userKey(tenantId, input.userId);
    const first = await this.redis.setIfAbsent(`embed:idrej:${tenantId}:${reason}:${user}`, '1', 60);
    if (first === false) return;
    await this.auditEvent(
      'embed.identify_rejected',
      tenantId,
      `session:${sessionId}`,
      { reason, v: input.claims ? 2 : 1, user },
      'denied',
    );
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

/**
 * Would binding `customerId` + `claims` to this session change who it speaks for?
 *
 * A principal is the bound customer plus the signed hotel and role. A session
 * with no customer is not bound to anyone yet — a guest can become anyone, so
 * that upgrade keeps the session. Once bound, a different customer, hotel or
 * role is a different principal. Absent claims (v1) count as "no hotel, no
 * role", which keeps a tenant that never sends claims on one session for as long
 * as the same user signs in, and means a user who starts sending claims — or
 * stops — gets a clean session instead of a mixed-context thread.
 */
export function principalChanged(
  session: Pick<Session, 'customerId' | 'identityClaims'>,
  customerId: number,
  claims: Pick<IdentityClaims, 'hotelSn' | 'role'> | null,
): boolean {
  if (session.customerId == null) return false;
  if (Number(session.customerId) !== Number(customerId)) return true;
  const had = session.identityClaims;
  return (had?.hotelSn ?? null) !== (claims?.hotelSn ?? null) || (had?.role ?? null) !== (claims?.role ?? null);
}

/**
 * What a forked session inherits: the visitor's browser-level context, never
 * the previous person's identity or operator notes. `alias` is an operator-set
 * name for the old person (PII), `auto_reply_mode` an operator override aimed at
 * that conversation, and the open counters belong to the old row's impression.
 *
 * Consent is per data subject (PLN-261012 S1 follow-up; Go2Joy / PDPL). The SAME
 * customer switching hotel or role consented once and keeps it; a DIFFERENT
 * customer starts with consent pending, so the widget shows the notice again
 * instead of processing their messages on someone else's yes.
 */
function carriedOver(s: Session, sameCustomer: boolean): Partial<Session> {
  const base: Partial<Session> = {
    tenantId: s.tenantId,
    aiAgentId: s.aiAgentId,
    channel: s.channel,
    landingPath: s.landingPath,
    language: s.language,
    languageLocked: s.languageLocked,
  };
  if (!sameCustomer) {
    return { ...base, consentState: CONSENT_STATE.PENDING, consentAt: null, consentVersion: null };
  }
  return {
    ...base,
    consentState: s.consentState,
    consentAt: s.consentAt,
    consentVersion: s.consentVersion,
  };
}

/** `IDENTIFY_REPLAY_GUARD=false` switches the replay guard off (operator kill switch); on by default. */
function replayGuardEnabled(): boolean {
  return String(process.env.IDENTIFY_REPLAY_GUARD ?? 'true').trim().toLowerCase() !== 'false';
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Redis key of a verified signature — the hash itself never becomes a key. */
function replayKey(tenantId: number, hash: string): string {
  return `embed:idrep:${tenantId}:${sha256(hash)}`;
}

/** A session token compared by digest: the token is a credential, the digest only an identity. */
function tokenDigest(token: string): string {
  return sha256(token);
}

/** Stable, non-reversible key for a host user id — for audit rows that must carry no PII. */
function userKey(tenantId: number, userId: string): string {
  return sha256(`${tenantId}:${userId}`).slice(0, 16);
}

function parseReplayRecord(raw: string | null): ReplayRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ReplayRecord;
    return parsed && typeof parsed.t === 'string' ? parsed : null;
  } catch {
    return null;
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
