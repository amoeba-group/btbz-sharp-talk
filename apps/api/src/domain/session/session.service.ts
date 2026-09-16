import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import {
  CJM_STAGE,
  CONSENT_STATE,
  ConsentState,
  SESSION_IDENTITY,
  SESSION_LANGUAGE,
  sessionLanguageForLocale,
  sessionLanguageForTimezone,
  WIDGET_LOGIN_MODE,
  WIDGET_TAB_POSITION,
  WIDGET_TABS_DEFAULT,
  WidgetCopy,
  WidgetLoginMode,
  WidgetTab,
  WidgetTabPosition,
  WidgetTheme,
  normalizeWidgetTabs,
  normalizeWidgetTheme, stripCustomCss,
} from '@sharptalk/types';
import { generateToken } from '@sharptalk/common';
import { Session } from './entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Customer } from '../customer/entity/customer.entity';
import { AiAgent } from '../ai-engine/entity/ai-agent.entity';
import { EventBusService, EVENTS } from '../../infrastructure/infrastructure.module';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { BusinessException } from '../../global/exception/business.exception';
import { isOriginAllowed } from '../embed/embed-origin.util';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/**
 * Platform-default version tag of the consent notice text (PRV-M4). Bump when
 * the widget's privacy-notice wording changes so recorded choices reference
 * what was shown. Tenants may override via tenants.consent_notice_version
 * (Stage 2, PLN-Privacy-Control-Gap) — the tenant value wins when set.
 */
export const CONSENT_NOTICE_VERSION = '2026-07';

/** Tenant-facing widget config (privacy notice + behavior) served with /session/ensure. */
/** Region named in the widget AI disclosure (REQ-260913 G7). Deployment-level, read once. */
const AI_PROCESSING_REGION = (process.env.AI_PROCESSING_REGION || 'US').trim().toUpperCase();

export interface PrivacyNoticeInfo {
  privacyPolicyUrl: string | null;
  /** Effective notice version: tenant override ?? platform default. */
  consentNoticeVersion: string;
  /** How the widget's "Sign in" opens the storefront login. */
  widgetLoginMode: WidgetLoginMode;
  /** Tabs this tenant shows, already normalized and never empty. */
  widgetTabs: WidgetTab[];
  /** Where the tab bar sits. */
  widgetTabPosition: WidgetTabPosition;
  /** Brand theme, or null when this tenant never configured one. */
  widgetTheme: WidgetTheme | null;
  /** Tenant widget copy; displayName already resolved (config ?? tenant name). */
  widgetCopy: WidgetCopy;
  /** Where AI inference runs for this deployment (AI_PROCESSING_REGION, e.g. 'US'). */
  aiProcessingRegion?: string;
}

/** TTL for the token→session Redis cache (PERF-11). */
const SESSION_CACHE_TTL_SEC = 30;

/**
 * How long a verified session stays resumable, measured from its last activity.
 * Long enough to span a shopping visit (so navigating the store keeps the chat
 * thread) without resurrecting a conversation from days ago.
 */
const SESSION_REUSE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Redis key for the token→session cache. Exported so the few modules that
 * mutate sessions directly (order guest-bind, agent link, privacy erasure) can
 * invalidate without importing SessionService (avoids module cycles).
 */
export function sessionCacheKey(token: string): string {
  return `sess:tok:${token}`;
}

/**
 * Session lifecycle (S1 / FN-006). Creates or resumes a widget session, tracks
 * CCPA consent, and resolves UI language. Emits a CJM Awareness event on create.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    private readonly bus: EventBusService,
    private readonly redis: RedisService,
    @InjectRepository(AiAgent) private readonly aiAgentRepo?: Repository<AiAgent>,
  ) {}

  async ensure(
    token: string | undefined,
    locale: string | undefined,
    shopDomain?: string,
    parentOrigin?: string,
    agentCode?: string,
  ): Promise<Session> {
    if (token) {
      const existing = await this.sessionRepo.findOne({ where: { sessionToken: token } });
      if (existing && (await this.belongsToShop(existing, shopDomain))) {
        // Re-pin when the PAGE declares a different agent (FIX-260825): the
        // widget persists its session token, so a visitor walking from the
        // main page (default pin) to /partner (hotel-partner embed) reused the
        // old pin forever — the /partner counter answered as the default
        // agent, and agent-scoped scenario buttons looked unfiltered. Only an
        // explicit, RESOLVABLE code moves the pin; absent/unknown codes keep
        // the session exactly as it was (pages without an agent param must
        // never reset an existing pin to default).
        if (agentCode && existing.tenantId != null) {
          const resolved = await this.resolveAiAgentId(existing.tenantId, agentCode);
          if (resolved != null && Number(existing.aiAgentId ?? -1) !== Number(resolved)) {
            existing.aiAgentId = resolved;
            await this.sessionRepo.update({ id: existing.id }, { aiAgentId: resolved });
            await this.redis.del(sessionCacheKey(existing.sessionToken));
          }
        }
        return existing;
      }
    }
    const tenant = await this.resolveTenant(shopDomain);
    this.assertEmbedOriginAllowed(tenant, parentOrigin);

    const session = await this.sessionRepo.save(
      this.sessionRepo.create({
        sessionToken: generateToken(),
        tenantId: tenant.id,
        // Pinned once here — the session keeps its agent for its whole life.
        aiAgentId: await this.resolveAiAgentId(tenant.id, agentCode),
        language: this.resolveLanguage(locale, tenant.timezone, tenant.defaultLanguage),
        consentState: CONSENT_STATE.PENDING,
        customerId: null,
        identityLevel: SESSION_IDENTITY.GUEST,
      }),
    );
    await this.bus.publish(EVENTS.CJM, {
      tenantId: tenant.id,
      sessionId: session.id,
      customerId: null,
      stage: CJM_STAGE.AWARENESS,
      eventType: 'session_start',
    });
    return session;
  }

  /**
   * Admin console sandbox session (PLN-AiSetting-Preview W1). Bound to the
   * admin's own tenant with channel='preview': the chat pipeline runs for real
   * (persona/rules/KB/moderation) but the session is exempt from the consent
   * gate and never fans out escalation alerts or enters the agent queue.
   * No CJM event — preview traffic must not pollute journey analytics.
   */
  async createPreview(tenantId: number, locale?: string, aiAgentId?: number | null): Promise<Session> {
    // Tenant-scoped check only — previewing an inactive agent's draft persona
    // is exactly what the console needs before switching it on.
    const agent =
      aiAgentId != null && this.aiAgentRepo
        ? await this.aiAgentRepo.findOne({ where: { id: aiAgentId, tenantId } })
        : null;
    return this.sessionRepo.save(
      this.sessionRepo.create({
        sessionToken: generateToken(),
        tenantId,
        channel: 'preview',
        aiAgentId: agent ? Number(agent.id) : null,
        language: this.resolveLanguage(locale),
        consentState: CONSENT_STATE.GRANTED,
        customerId: null,
        identityLevel: SESSION_IDENTITY.GUEST,
      }),
    );
  }

  /**
   * Embed/channel agent code → agent id for this tenant (PLN-260820). Unknown,
   * inactive or cross-tenant codes resolve to null — the default agent — with a
   * warn line as the only trace: the shopper must never see an error because an
   * operator mistyped a snippet.
   */
  async resolveAiAgentId(tenantId: number, code?: string | null): Promise<number | null> {
    const trimmed = code?.trim().toLowerCase();
    if (!trimmed || !this.aiAgentRepo) return null;
    const row = await this.aiAgentRepo.findOne({ where: { tenantId, code: trimmed, active: 1 } });
    if (!row) {
      this.logger.warn(`ai agent code did not match: tenant=${tenantId} code=${trimmed}`);
      return null;
    }
    return Number(row.id);
  }

  /**
   * Display name of the session's bound customer, or null (guest, or the profile
   * has not been filled in yet). Tenant-scoped: the customer must belong to the
   * session's tenant, so a session can never surface another store's shopper.
   */
  async customerDisplayName(session: Session): Promise<string | null> {
    if (session.customerId == null || session.tenantId == null) return null;
    const customer = await this.customerRepo.findOne({
      where: { id: session.customerId, tenantId: session.tenantId },
      select: ['id', 'name'],
    });
    return customer?.name?.trim() || null;
  }

  /**
   * Resolve the tenant a new session binds to (multitenancy — POL, CLAUDE.md §6).
   * - `shop_domain` given  → must match a tenant, else reject (no silent binding).
   * - `shop_domain` absent → only default when exactly one tenant exists (single
   *   store / dev). With multiple tenants we refuse to guess to avoid cross-tenant leak.
   */
  /**
   * Refuse a widget booted from a page the tenant never allowed (PLN-260819 S1).
   *
   * Two deliberate softenings, because this guard sits on the busiest public
   * route in the product and a false positive takes a shop's widget offline:
   *
   *  - A request that reports NO origin passes. Older loaders (already installed
   *    on live storefronts) do not send one, and treating silence as a violation
   *    would break them on deploy.
   *  - `EMBED_ORIGIN_ENFORCE` defaults to off. Until it is on, a violation is
   *    logged and allowed — 4xx are not server-logged by default, so this line is
   *    the only evidence we get for deciding whether enforcing is safe.
   *
   * It is a misconfiguration guard, not authentication: `parentOrigin` comes from
   * the browser. Identity is proved by the signed handshake (S2).
   */
  /**
   * May a stored token be resumed for the shop the page declares? (FIX-260916)
   *
   * The widget origin is shared by every tenant on a deployment, so a token one
   * tenant's widget persisted was presented, verbatim, by another tenant's
   * standalone or app-mode load — and resumed, because nothing here compared
   * the token's tenant with the shop. A page naming a shop that belongs to a
   * different tenant now gets a fresh session. No shop, an unknown shop and a
   * tenant-less legacy session keep resuming exactly as before: this guard adds
   * no new failure, only a new session where the old one was the wrong one.
   */
  private async belongsToShop(existing: Session, shopDomain?: string): Promise<boolean> {
    if (!shopDomain || existing.tenantId == null) return true;
    const target = await this.tenantRepo.findOne({ where: { shopDomain } });
    if (!target || Number(target.id) === Number(existing.tenantId)) return true;
    this.logger.warn(
      `session token of tenant ${existing.tenantId} presented for shop ${shopDomain} ` +
        `(tenant ${target.id}) — not resumed, minting a new session`,
    );
    return false;
  }

  private assertEmbedOriginAllowed(tenant: Tenant, parentOrigin?: string): void {
    if (!parentOrigin) return;
    if (isOriginAllowed(parentOrigin, tenant.embedOrigins, tenant)) return;

    const enforcing =
      String(process.env.EMBED_ORIGIN_ENFORCE ?? 'false').toLowerCase() === 'true';
    this.logger.warn(
      `embed origin not allowed (tenant ${tenant.id}, origin ${parentOrigin})` +
        (enforcing ? '' : ' — observe mode, allowing'),
    );
    if (enforcing) {
      throw new BusinessException(ERROR_CODE.EMBED_ORIGIN_NOT_ALLOWED, HttpStatus.FORBIDDEN);
    }
  }

  private async resolveTenant(shopDomain?: string): Promise<Tenant> {
    if (shopDomain) {
      const tenant = await this.tenantRepo.findOne({ where: { shopDomain } });
      if (!tenant) throw new BusinessException(ERROR_CODE.TENANT_NOT_FOUND, HttpStatus.NOT_FOUND);
      return tenant;
    }
    const [tenants, count] = await this.tenantRepo.findAndCount({ order: { id: 'ASC' }, take: 1 });
    if (count === 1) return tenants[0];
    throw new BusinessException(ERROR_CODE.TENANT_NOT_FOUND, HttpStatus.BAD_REQUEST);
  }

  /**
   * Create a fresh session already bound to a customer. Used by the Shopify app
   * proxy once a storefront customer's identity is Shopify-verified — the widget
   * adopts this token and starts authenticated (customerId != null).
   */
  async createForCustomer(
    tenantId: number,
    customerId: number,
    locale?: string,
  ): Promise<Session> {
    const owner = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const session = await this.sessionRepo.save(
      this.sessionRepo.create({
        sessionToken: generateToken(),
        tenantId,
        language: this.resolveLanguage(locale, owner?.timezone, owner?.defaultLanguage),
        consentState: CONSENT_STATE.PENDING,
        customerId,
        identityLevel: SESSION_IDENTITY.VERIFIED,
      }),
    );
    await this.bus.publish(EVENTS.CJM, {
      tenantId,
      sessionId: session.id,
      customerId,
      stage: CJM_STAGE.AWARENESS,
      eventType: 'session_start',
    });
    return session;
  }

  /**
   * Resume the customer's recent verified session, or create one.
   *
   * The app proxy re-resolves identity on **every storefront page load**, so
   * always minting a session gave a signed-in shopper a new session — and, since
   * conversations hang off `session_id`, a fresh empty chat — each time they
   * clicked a link. It also piled up rows (16 sessions for one customer in a day).
   * Reusing the last session inside the activity window keeps the conversation,
   * escalation state and consent choice intact across navigation.
   *
   * The window is rolling: touching the row on reuse extends it, so an active
   * shopper keeps their thread while a stale one starts clean. Scoped to
   * tenant+customer+verified — a guest session is never resumed this way, and the
   * token is only ever handed back after Shopify verified this same customer, so
   * reuse grants nothing a fresh session wouldn't.
   */
  async findOrCreateForCustomer(
    tenantId: number,
    customerId: number,
    locale?: string,
  ): Promise<Session> {
    const since = new Date(Date.now() - SESSION_REUSE_WINDOW_MS);
    const existing = await this.sessionRepo.findOne({
      where: {
        tenantId,
        customerId,
        identityLevel: SESSION_IDENTITY.VERIFIED,
        updatedAt: MoreThan(since),
      },
      order: { updatedAt: 'DESC' },
    });
    if (existing) {
      // Touch to roll the window forward. Language is left alone on purpose: the
      // shopper may have picked one in the widget, and the storefront locale must
      // not silently override that choice on the next page load.
      await this.sessionRepo.save(existing);
      return existing;
    }
    return this.createForCustomer(tenantId, customerId, locale);
  }

  /** Resolve a tenant by its Shopify shop domain (null when unknown). */
  async findTenantByShop(shopDomain: string): Promise<Tenant | null> {
    return this.tenantRepo.findOne({ where: { shopDomain } });
  }

  /**
   * Token→session lookup, Redis-cached for 30s (PERF-11): the widget hits this
   * on every poll/message. Mutation sites (consent, language, customer binding,
   * erasure) invalidate via `sessionCacheKey`.
   */
  async findByToken(token: string): Promise<Session> {
    if (this.redis.available()) {
      const hit = await this.redis.get(sessionCacheKey(token));
      if (hit) return JSON.parse(hit) as Session;
    }
    const session = await this.loadByToken(token);
    await this.redis.set(sessionCacheKey(token), JSON.stringify(session), SESSION_CACHE_TTL_SEC);
    return session;
  }

  /**
   * The one place widget-session authorization is decided (POL-001).
   *
   * Every storefront endpoint that touches personal data needs the same two-tier
   * answer, and it used to be re-implemented per service — six copies of
   * `requireCustomerId` plus four inline checks. They happened to agree, but
   * nothing made them agree, which is precisely how a gap gets introduced later.
   * Routing them all through here also means they finally use the cached lookup.
   *
   * - not bound to a customer  → 401 UNAUTHORIZED
   * - `verified: true` and the binding came from a guest order lookup rather than
   *   Shopify → 403 FORBIDDEN. Guest identity is weak: enough to read one's own
   *   orders, never enough to export or erase an account (SEC-C3).
   */
  async requireCustomer(token: string, opts?: { verified?: boolean }): Promise<Session> {
    const session = await this.findByToken(token);
    if (session.customerId == null) {
      throw new BusinessException(ERROR_CODE.UNAUTHORIZED, HttpStatus.UNAUTHORIZED);
    }
    if (opts?.verified && session.identityLevel !== SESSION_IDENTITY.VERIFIED) {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return session;
  }

  /** Shorthand for the common case: the bound customer's id. */
  async requireCustomerId(token: string, opts?: { verified?: boolean }): Promise<number> {
    const session = await this.requireCustomer(token, opts);
    return session.customerId as number;
  }

  /** Uncached DB load — used before mutations so we never save a cached copy. */
  private async loadByToken(token: string): Promise<Session> {
    const session = await this.sessionRepo.findOne({ where: { sessionToken: token } });
    if (!session) throw new BusinessException(ERROR_CODE.SESSION_NOT_FOUND, HttpStatus.NOT_FOUND);
    return session;
  }

  async setConsent(token: string, granted: boolean): Promise<Session> {
    const session = await this.loadByToken(token);
    session.consentState = granted ? CONSENT_STATE.GRANTED : CONSENT_STATE.DECLINED;
    // Auditable proof of the choice: when + which notice version (PRV-M4).
    // The version stamped is the tenant's *effective* one so a tenant override
    // does not immediately degrade a fresh grant back to pending (Stage 2).
    session.consentAt = new Date();
    session.consentVersion = await this.effectiveNoticeVersion(session.tenantId);
    const saved = await this.sessionRepo.save(session);
    await this.redis.del(sessionCacheKey(token));
    // Structured trace of the consent transition (no PII — ids/states only).
    this.logger.log(
      `consent recorded: session=${session.id} state=${saved.consentState} version=${saved.consentVersion}`,
    );
    return saved;
  }

  // ---- Consent policy (PLN-Privacy-Control-Gap Stage 1, fail-closed D-1) ----

  /**
   * Effective consent for gating processing: GRANTED only counts when it was
   * recorded against the *current* effective notice version — an outdated
   * version degrades to PENDING (re-consent required). DECLINED stays DECLINED.
   */
  getEffectiveConsent(
    session: Pick<Session, 'consentState' | 'consentVersion'>,
    currentNoticeVersion: string,
  ): ConsentState {
    if (session.consentState === CONSENT_STATE.DECLINED) return CONSENT_STATE.DECLINED;
    if (session.consentState === CONSENT_STATE.GRANTED) {
      return session.consentVersion === currentNoticeVersion
        ? CONSENT_STATE.GRANTED
        : CONSENT_STATE.PENDING;
    }
    return CONSENT_STATE.PENDING;
  }

  /**
   * Cache-bypassing consent read: selects the consent columns straight from the
   * DB. The message paths must NOT trust the 30s token→session Redis cache for
   * consent — a withdrawal must take effect immediately (fail-closed on stale).
   */
  async loadConsentFresh(
    sessionId: number,
  ): Promise<Pick<Session, 'consentState' | 'consentVersion' | 'consentAt'>> {
    const row = await this.sessionRepo.findOne({
      where: { id: sessionId },
      select: { id: true, consentState: true, consentVersion: true, consentAt: true },
    });
    if (!row) throw new BusinessException(ERROR_CODE.SESSION_NOT_FOUND, HttpStatus.NOT_FOUND);
    return row;
  }

  /** Effective notice version for a tenant: tenant override ?? platform default. */
  async effectiveNoticeVersion(tenantId: number | null): Promise<string> {
    return (await this.privacyNotice(tenantId)).consentNoticeVersion;
  }

  /**
   * Privacy-notice info (URL + effective version) served with /session/ensure.
   * When the session is pinned to an AI agent (or the tenant has a default
   * agent), that agent's display name / greeting override the tenant's widget
   * copy (REQ-260825 R3/R4) — the widget itself stays agent-unaware.
   */
  async privacyNotice(
    tenantId: number | null,
    aiAgentId?: number | null,
  ): Promise<PrivacyNoticeInfo> {
    const tenant =
      tenantId != null ? await this.tenantRepo.findOne({ where: { id: tenantId } }) : null;
    // NULL pin means "the tenant's default agent", so its overrides apply too.
    const agent =
      tenantId != null && this.aiAgentRepo
        ? aiAgentId != null
          ? await this.aiAgentRepo.findOne({ where: { id: aiAgentId, tenantId } })
          : await this.aiAgentRepo.findOne({ where: { tenantId, isDefault: 1 } })
        : null;
    const agentGreeting =
      agent?.greeting && Object.keys(agent.greeting).length ? agent.greeting : null;
    return {
      privacyPolicyUrl: tenant?.privacyPolicyUrl ?? null,
      consentNoticeVersion: tenant?.consentNoticeVersion ?? CONSENT_NOTICE_VERSION,
      aiProcessingRegion: AI_PROCESSING_REGION,
      widgetLoginMode:
        tenant?.widgetLoginMode === WIDGET_LOGIN_MODE.POPUP
          ? WIDGET_LOGIN_MODE.POPUP
          : WIDGET_LOGIN_MODE.REDIRECT,
      // The stored value if it still normalizes to something renderable,
      // otherwise the built-in default. A tenant row holding a tab key we no
      // longer ship must not produce an empty bar the shopper cannot navigate.
      widgetTabs: normalizeWidgetTabs(tenant?.widgetTabs) ?? [...WIDGET_TABS_DEFAULT],
      widgetTabPosition:
        tenant?.widgetTabPosition === WIDGET_TAB_POSITION.BOTTOM
          ? WIDGET_TAB_POSITION.BOTTOM
          : WIDGET_TAB_POSITION.TOP,
      // Null passes through as null: the widget's CSS already holds the built-in
      // palette, so "no theme" needs no payload and paints no variables.
      widgetTheme: stripCustomCss(normalizeWidgetTheme(tenant?.widgetTheme), Number(tenant?.customCssEnabled) === 1),
      widgetCopy: {
        // Resolved here so the widget never needs the tenant entity: agent
        // display name ?? configured name ?? tenant name.
        displayName:
          agent?.displayName?.trim() ||
          tenant?.widgetCopy?.displayName?.trim() ||
          tenant?.name ||
          null,
        firstVisit: agentGreeting ?? tenant?.widgetCopy?.firstVisit ?? {},
        loginGreeting: tenant?.widgetCopy?.loginGreeting ?? {},
      },
    };
  }

  /**
   * One-stop consent gate for the message/agent paths: fresh (uncached) consent
   * read + tenant-effective notice version → effective consent state.
   */
  async effectiveConsentFor(sessionId: number, tenantId: number | null): Promise<ConsentState> {
    const fresh = await this.loadConsentFresh(sessionId);
    const version = await this.effectiveNoticeVersion(tenantId);
    return this.getEffectiveConsent(fresh, version);
  }

  async setLanguage(token: string, language: string): Promise<Session> {
    const session = await this.loadByToken(token);
    session.language = this.resolveLanguage(language);
    // An explicit choice outranks detection from here on (PLN-260813 D3).
    session.languageLocked = 1;
    const saved = await this.sessionRepo.save(session);
    await this.redis.del(sessionCacheKey(token));
    return saved;
  }

  /**
   * Move a session to the language the shopper is actually writing in
   * (PLN-260813 P2). Unlike `setLanguage` this does NOT lock: it is an
   * inference, and a later explicit pick must still win.
   *
   * The caller holds the `Session` object the rest of the turn reads from, so
   * it is mutated here too — otherwise the system message of the very turn that
   * triggered the switch would still go out in the old language.
   */
  async applyDetectedLanguage(session: Session, language: string): Promise<void> {
    session.language = language;
    await this.sessionRepo.update({ id: session.id }, { language });
    await this.redis.del(sessionCacheKey(session.sessionToken));
    this.logger.log(`session language detected: session=${session.id} → ${language}`);
  }

  async bindCustomer(sessionId: number, customerId: number): Promise<void> {
    await this.sessionRepo.update({ id: sessionId }, { customerId });
  }

  /**
   * Resolve a session's UI language. An explicit non-English locale is always
   * honoured; when the shopper gives no clear preference, the tenant's
   * configured timezone decides the default (요구사항: Asia/Seoul → Korean,
   * America/New_York → English). Falls back to English when neither applies.
   *
   * Both mappings come from the @sharptalk/types registry, so a newly registered
   * language is understood here without touching this file (REQ-260817 G6).
   */
  /**
   * Language for a session opened from an external messenger (PLN-260812 S3).
   *
   * Platform hint first, then the tenant's own default. Relay channels send no
   * locale at all, and defaulting straight to English put English privacy and
   * handoff notices into Korean KakaoTalk rooms.
   */
  async languageForChannel(tenantId: number | null, localeHint?: string | null): Promise<string> {
    const tenant = tenantId != null ? await this.tenantRepo.findOne({ where: { id: tenantId } }) : null;
    return this.resolveLanguage(localeHint ?? undefined, tenant?.timezone, tenant?.defaultLanguage);
  }

  private resolveLanguage(locale?: string, timezone?: string | null, defaultLanguage?: string | null): string {
    const explicit = sessionLanguageForLocale(locale);
    // English is treated as "no preference expressed": an en-US browser in a
    // Seoul tenant should still get Korean, which is the behaviour tenants
    // configured their timezone for.
    if (explicit && explicit !== SESSION_LANGUAGE.EN) return explicit;
    // An explicit tenant default outranks the timezone-derived guess
    // (REQ-260913-VN-Prerequisite-Gaps G1/G2) but never the shopper's own choice.
    const preset = sessionLanguageForLocale(defaultLanguage ?? undefined);
    if (preset) return preset;
    return sessionLanguageForTimezone(timezone) ?? SESSION_LANGUAGE.EN;
  }
}
