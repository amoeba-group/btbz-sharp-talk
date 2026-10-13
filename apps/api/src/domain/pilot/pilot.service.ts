import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { localized, pilotNoticeFor, readPilotAccess } from '@sharptalk/types';
import type { PilotAccess, PilotStatus } from '@sharptalk/types';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Session } from '../session/entity/session.entity';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { TenantPilotHotel } from './entity/tenant-pilot-hotel.entity';
import { PILOT_NOTICE } from './pilot.messages';
import { PILOT_DENIED, decidePilot, signedHotelOf } from './pilot.util';
import type { PilotVerdict } from './pilot.util';

/**
 * How long a tenant's pilot configuration + list is cached in Redis. Short on
 * purpose: this is the staleness a hotel added to the list waits at most (REQ
 * §5.3 "≤ 60 s sau"), and every console change also deletes the key, so in
 * practice a change is live on the next turn.
 */
export const PILOT_CACHE_TTL_SEC = 60;

const cacheKey = (tenantId: number): string => `pilot:snap:${tenantId}`;

/** What the gate needs about a tenant, cached as one JSON value. */
export interface PilotSnapshot {
  /** null = never configured. A configured-but-off tenant keeps its config here with `enabled: false`. */
  cfg: PilotAccess | null;
  /** ACTIVE hotel serials. Loaded only while the list is in force; empty otherwise. */
  hotels: string[];
  /**
   * How long a signed identity stays good, from the tenant's identity policy
   * (s1b, `tenants.identity_policy.maxAgeHours`). Null = unbounded, which is the
   * only behaviour that exists before that policy ships.
   */
  identityMaxAgeHours: number | null;
}

/** A refused turn: the soft reply to show, and why. */
export interface PilotDenial {
  reason: typeof PILOT_DENIED;
  body: string;
}

/**
 * Pilot allowlist by hotel — the authoritative half (PLN-261012 SG-40).
 *
 * Asked on every chat turn, scripted button and hand-off request of a widget
 * session, with the SIGNED hotel of that session. Nothing here reads anything the
 * visitor typed or anything the widget decided: whether a hotel is served is a
 * server fact, so a stale, patched or absent loader changes how the page looks
 * and never who gets answered.
 *
 * The hotel is resolved per TURN and not stored at identify time, which is what
 * lets a hotel added in the console be served by its very next message without
 * the host re-identifying (the cache is 60 s and dropped on every change).
 *
 * Failure stance: a database error propagates, exactly as it does for the
 * consent gate beside it — a gate that answered "allowed" when it could not look
 * would be no gate. Redis being down only costs the cache.
 */
@Injectable()
export class PilotService {
  private readonly logger = new Logger(PilotService.name);

  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(TenantPilotHotel) private readonly hotelRepo: Repository<TenantPilotHotel>,
    private readonly redis: RedisService,
  ) {}

  /** The tenant's pilot configuration and active list, cached for {@link PILOT_CACHE_TTL_SEC}. */
  async snapshot(tenantId: number): Promise<PilotSnapshot> {
    const key = cacheKey(tenantId);
    const hit = await this.redis.get(key);
    if (hit) {
      try {
        const parsed = JSON.parse(hit) as PilotSnapshot;
        if (parsed && Array.isArray(parsed.hotels) && 'cfg' in parsed) return parsed;
      } catch {
        /* a corrupt entry is just a miss */
      }
    }

    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const cfg = readPilotAccess(tenant?.pilotAccess);
    // The list is only read while it is in force: a tenant without a pilot costs
    // one small tenant read per minute and nothing per turn.
    const rows = cfg?.enabled
      ? await this.hotelRepo.find({ where: { tenantId, active: 1 }, select: { hotelSn: true } })
      : [];
    const snapshot: PilotSnapshot = {
      cfg,
      hotels: rows.map((r) => r.hotelSn),
      identityMaxAgeHours: maxAgeHoursOf(tenant),
    };
    await this.redis.set(key, JSON.stringify(snapshot), PILOT_CACHE_TTL_SEC);
    return snapshot;
  }

  /** Drop the cached snapshot — called after every change to the switch or the list. */
  async invalidate(tenantId: number): Promise<void> {
    await this.redis.del(cacheKey(tenantId));
  }

  /**
   * The verdict for one session, with the configuration it was judged against.
   *
   * Sessions with a `channel` are outside the rule: 'preview' is the console
   * sandbox and the messenger channels are exposed explicitly by the tenant's
   * channel setup, not by a hotel's web page — there is no signed hotel to match
   * on, and "guests not allowed" must not silently mute a connected Zalo room.
   * Only widget sessions (`channel` NULL) carry the pilot rule.
   */
  async evaluate(
    session: Pick<Session, 'tenantId' | 'channel' | 'identityLevel' | 'identityClaims'>,
  ): Promise<{ verdict: PilotVerdict; cfg: PilotAccess | null }> {
    if (session.tenantId == null || session.channel != null) {
      return { verdict: { applies: false, allowed: true, audience: null, hotelSn: null }, cfg: null };
    }
    const snap = await this.snapshot(Number(session.tenantId));
    const hotelSn = signedHotelOf(session, { maxAgeHours: snap.identityMaxAgeHours });
    return { verdict: decidePilot(snap.cfg, new Set(snap.hotels), hotelSn), cfg: snap.cfg };
  }

  /**
   * A turn that must not be served, or null. The reply is the tenant's notice for
   * the session language, else the built-in one — a soft system line, not an
   * error. The caller stores nothing and calls no model; this logs the refusal,
   * because a 200 with a notice leaves no other trace that a hotel was turned away.
   */
  async denialFor(
    session: Pick<Session, 'id' | 'tenantId' | 'channel' | 'identityLevel' | 'identityClaims' | 'language'>,
  ): Promise<PilotDenial | null> {
    const { verdict, cfg } = await this.evaluate(session);
    if (!verdict.applies || verdict.allowed) return null;
    this.logger.warn(
      `pilot denied (tenant ${session.tenantId}, session ${session.id}, ` +
        `${verdict.hotelSn ? `hotel ${verdict.hotelSn}` : 'guest'}, reason ${PILOT_DENIED})`,
    );
    return { reason: PILOT_DENIED, body: noticeFor(cfg, session.language) };
  }

  /**
   * What the widget is told (`pilot` in the session / identify response). Same
   * evaluation as the gate, so the widget hides for exactly the sessions the
   * server would refuse.
   */
  async statusFor(
    session: Pick<Session, 'tenantId' | 'channel' | 'identityLevel' | 'identityClaims' | 'language'>,
  ): Promise<PilotStatus> {
    const { verdict, cfg } = await this.evaluate(session);
    if (!verdict.applies) return { eligible: null };
    if (verdict.allowed) return { eligible: true };
    return {
      eligible: false,
      mode: cfg?.nonPilot ?? 'hide',
      notice: noticeFor(cfg, session.language),
    };
  }

  /**
   * `statusFor` for the responses that carry it (`ensure`, `identify`, the
   * re-check): a failure is logged and reads as "no pilot list", never as an
   * error. The gate on the turn paths still enforces the list, so all this costs
   * on a failure is the widget's chance to get out of the way early — and a page
   * load that 500s because a hint could not be computed would cost far more.
   */
  async hintFor(
    session: Pick<Session, 'id' | 'tenantId' | 'channel' | 'identityLevel' | 'identityClaims' | 'language'>,
  ): Promise<PilotStatus> {
    try {
      return await this.statusFor(session);
    } catch (e) {
      this.logger.warn(`pilot verdict unavailable (session ${session.id}): ${(e as Error).message}`);
      return { eligible: null };
    }
  }
}

/** Tenant wording for the session language, else the built-in line (which falls back to English). */
function noticeFor(cfg: PilotAccess | null, language: string | null | undefined): string {
  return pilotNoticeFor(cfg, language) ?? localized(PILOT_NOTICE, language);
}

/**
 * `identity_policy.maxAgeHours` when s1b's column exists on the tenant row. Read
 * defensively and by shape, so this stays correct before that column exists
 * (undefined → null) and starts working the moment it does, with no change here.
 */
function maxAgeHoursOf(tenant: Tenant | null): number | null {
  const policy = (tenant as unknown as { identityPolicy?: { maxAgeHours?: unknown } | null } | null)
    ?.identityPolicy;
  const hours = Number(policy?.maxAgeHours);
  return Number.isFinite(hours) && hours > 0 ? hours : null;
}
