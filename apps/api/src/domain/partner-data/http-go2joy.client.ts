import { createHash, createHmac, randomUUID } from 'crypto';
import { Logger } from '@nestjs/common';
import { envNumber } from '../../global/util/env-number.util';
import { assertPartnerApiUrl } from '../tenant/ecommerce-probe.util';
import type { PartnerApiClient, PartnerEnvelope } from './partner-api.client';
import { validateEnvelope } from './partner-api.client';
import type { PartnerCtx } from './partner-ctx';
import { partnerError } from './partner-data.constants';
import type { PartnerTopic } from './partner-data.constants';
import type { PartnerQuery } from './partner-params.util';
import type { TopicRegistry } from './partner-topics';

/**
 * The live HTTP client for the Go2Joy partner-data API (PLN-261012 SG-32).
 *
 * BUILT AGAINST OUR OWN DRAFT CONTRACT (docs/guide/API-REQ-Go2Joy-Partner-Data.openapi.yaml),
 * not against Go2Joy's real API: their spec and key (R8/R9) have not been
 * delivered. It is exercised only against a local fake server in the tests —
 * never against Go2Joy — so treat every header name, status code and error code
 * here as a proposal until they review it.
 *
 * What it guarantees:
 *  - GET only. There is no code path that sends another method, so a retry can
 *    never repeat a side effect (v0 has none).
 *  - the hotel on the wire is `ctx.hotelSn` (X-Hotel-Sn) and only that; the
 *    query is the topic's validated closed parameter set;
 *  - a reply is dropped unless it echoes that same hotel and passes the
 *    envelope checks — and only a validated reply is ever cached;
 *  - the cache key contains the tenant AND the hotel, so one hotel's reply can
 *    never be served to another;
 *  - timeouts, one jittered retry on network errors / 5xx, a per-tenant
 *    circuit breaker, a response size cap, no redirects, and an SSRF guard on
 *    the tenant-supplied base URL.
 */

/** Credentials of one tenant's connection (integration_credentials, AES-256-GCM at rest). */
export interface PartnerCredentials {
  baseUrl: string;
  apiKey: string;
  /** Optional request-signing secret (only once Go2Joy provisions one). */
  signingSecret?: string;
}

export interface PartnerCredentialSource {
  /** Null when the tenant has not configured the connection. */
  get(tenantId: number): Promise<PartnerCredentials | null>;
}

/** The slice of RedisService the client uses (so tests can pass a fake). */
export interface PartnerCache {
  available(): boolean;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSec?: number): Promise<void>;
}

export interface HttpClientOptions {
  /** Per attempt. Default PARTNER_API_TIMEOUT_MS or 3000. */
  timeoutMs?: number;
  /** Total attempts incl. the first (GET only). Default 2. */
  maxAttempts?: number;
  /** Wall-clock budget for all attempts. Default PARTNER_API_BUDGET_MS or 7000. */
  budgetMs?: number;
  maxBytes?: number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  jitterMs?: readonly [number, number];
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Throws SsrfBlockedError for a base URL that must not be called (default: assertPartnerApiUrl). */
  urlGuard?: (baseUrl: string) => Promise<void>;
}

/** Query string with parameters sorted by name then value, RFC 3986 encoded. The same string is signed and sent. */
export function sortedQueryString(query: PartnerQuery): string {
  const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return Object.entries(query)
    .map(([k, v]) => [String(k), String(v)] as const)
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])))
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join('&');
}

export interface SignedFields {
  method: 'GET';
  path: string;
  query: PartnerQuery;
  hotelSn: string;
  role: string;
  claimsVerifiedAtSec: number;
  timestampSec: number;
  requestId: string;
}

/** The canonical string of the draft contract (see the OpenAPI description). */
export function canonicalString(f: SignedFields): string {
  return [
    'v1',
    f.method,
    f.path,
    sortedQueryString(f.query),
    f.hotelSn,
    f.role,
    String(f.claimsVerifiedAtSec),
    String(f.timestampSec),
    f.requestId,
  ].join('\n');
}

export function signRequest(secret: string, fields: SignedFields): string {
  return `v1=${createHmac('sha256', secret).update(canonicalString(fields)).digest('hex')}`;
}

/** Redis key of a cached reply: tenant AND hotel are part of it, so replies cannot cross hotels. */
export function partnerCacheKey(ctx: PartnerCtx, topic: PartnerTopic, query: PartnerQuery): string {
  const q = createHash('sha1').update(sortedQueryString(query)).digest('hex').slice(0, 16);
  return `partner:v0:${ctx.tenantId}:${ctx.hotelSn}:${topic}:${q}`;
}

interface BreakerState {
  failures: number;
  openUntil: number;
}

/** A not-found reply is cached only this long: a booking created a moment ago must show up soon. */
const NOT_FOUND_CACHE_SEC = 15;

export class HttpGo2JoyClient implements PartnerApiClient {
  readonly mode = 'live' as const;
  private readonly logger = new Logger(HttpGo2JoyClient.name);
  private readonly breakers = new Map<number, BreakerState>();
  /** base URL -> time until which the SSRF verdict stays valid (a DNS lookup per call would be wasteful). */
  private readonly guarded = new Map<string, number>();

  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly budgetMs: number;
  private readonly maxBytes: number;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;
  private readonly jitter: readonly [number, number];
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly urlGuard: (baseUrl: string) => Promise<void>;

  constructor(
    private readonly credentials: PartnerCredentialSource,
    private readonly registry: TopicRegistry,
    private readonly cache: PartnerCache | null,
    opts: HttpClientOptions = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? envNumber('PARTNER_API_TIMEOUT_MS', 3000);
    this.maxAttempts = Math.max(1, opts.maxAttempts ?? 2);
    this.budgetMs = opts.budgetMs ?? envNumber('PARTNER_API_BUDGET_MS', 7000);
    this.maxBytes = opts.maxBytes ?? 1024 * 1024;
    this.breakerThreshold = opts.breakerThreshold ?? 5;
    this.breakerCooldownMs = opts.breakerCooldownMs ?? 30_000;
    this.jitter = opts.jitterMs ?? [100, 300];
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
    this.urlGuard = opts.urlGuard ?? assertPartnerApiUrl;
  }

  async get(ctx: PartnerCtx, topic: PartnerTopic, query: PartnerQuery): Promise<PartnerEnvelope | null> {
    const def = this.registry.get(topic);
    const creds = await this.credentials.get(ctx.tenantId);
    if (!creds?.baseUrl || !creds.apiKey) throw partnerError.notConfigured('credentials_missing');

    // Cache first: a validated reply for THIS tenant + hotel + topic + query.
    const key = partnerCacheKey(ctx, topic, query);
    const cached = await this.readCache(key, ctx, topic);
    if (cached !== undefined) return cached;

    this.assertBreakerClosed(ctx.tenantId);
    const base = await this.checkedBase(creds.baseUrl);

    const qs = sortedQueryString(query);
    const url = `${base}${def.path}${qs ? `?${qs}` : ''}`;
    const started = this.now();
    // One id for the call: a retry carries the SAME X-Request-Id, so the partner can tell it from a new request.
    const requestId = randomUUID();
    let lastFailure: RetryableFailure | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const env = await this.attempt(url, def.path, creds, ctx, query, requestId);
        this.recordSuccess(ctx.tenantId);
        if (env === null) {
          await this.writeCache(key, '{"notFound":true}', Math.min(def.cacheTtlSec, NOT_FOUND_CACHE_SEC));
          return null;
        }
        const valid = validateEnvelope(env, ctx, topic);
        await this.writeCache(key, JSON.stringify(valid), def.cacheTtlSec);
        return valid;
      } catch (e) {
        if (!(e instanceof RetryableFailure)) {
          // A classified, non-retryable outcome (429, 4xx, invalid reply). 4xx do
          // not say the upstream is down, so they do not feed the breaker.
          throw e;
        }
        lastFailure = e;
        const spent = this.now() - started;
        if (attempt >= this.maxAttempts || spent + this.timeoutMs / 2 > this.budgetMs) break;
        const [lo, hi] = this.jitter;
        await this.sleep(lo + this.random() * (hi - lo));
      }
    }
    this.recordFailure(ctx.tenantId);
    throw partnerError.unavailable(lastFailure?.reason ?? 'upstream_failed');
  }

  // ---- one HTTP attempt -----------------------------------------------------

  /** Returns the parsed envelope (unvalidated), null for 404, or throws. */
  private async attempt(
    url: string,
    path: string,
    creds: PartnerCredentials,
    ctx: PartnerCtx,
    query: PartnerQuery,
    requestId: string,
  ): Promise<unknown | null> {
    const timestampSec = Math.floor(this.now() / 1000);
    const claimsVerifiedAtSec = Math.floor(ctx.verifiedAtMs / 1000);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${creds.apiKey}`,
      Accept: 'application/json',
      // The hotel, from the verified claims — never from the query (SG-31).
      'X-Hotel-Sn': ctx.hotelSn,
      'X-Actor-Role': ctx.role,
      'X-Claims-Verified-At': String(claimsVerifiedAtSec),
      'X-Request-Timestamp': String(timestampSec),
      'X-Request-Id': requestId,
    };
    if (creds.signingSecret) {
      headers['X-Signature'] = signRequest(creds.signingSecret, {
        method: 'GET',
        path,
        query,
        hotelSn: ctx.hotelSn,
        role: ctx.role,
        claimsVerifiedAtSec,
        timestampSec,
        requestId,
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      // GET, no redirects (a redirect could point at an internal host), no body.
      res = await this.fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: controller.signal });
    } catch (e) {
      clearTimeout(timer);
      const aborted = (e as Error).name === 'AbortError';
      throw new RetryableFailure(aborted ? 'upstream_timeout' : 'upstream_network');
    }

    try {
      const status = res.status;
      if (status === 404) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      if (status === 429) {
        await res.body?.cancel().catch(() => undefined);
        throw partnerError.rateLimited('upstream_429');
      }
      if (status >= 500) {
        await res.body?.cancel().catch(() => undefined);
        throw new RetryableFailure(`upstream_${status}`);
      }
      if (status !== 200) {
        // 400 / 401 / 403 / other 4xx: our request or credentials are wrong —
        // retrying cannot fix it and the user must not be shown the body.
        const code = await this.errorCodeOf(res);
        this.logger.warn(`partner API refused the request: status=${status} code=${code ?? 'n/a'} path=${path}`);
        throw partnerError.unavailable(`upstream_${status}`, { upstreamCode: code });
      }
      const ctype = res.headers.get('content-type') ?? '';
      if (!/json/i.test(ctype)) throw partnerError.invalid('reply_not_json');
      const text = await this.readBounded(res);
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw partnerError.invalid('reply_not_parseable');
      }
    } catch (e) {
      // A body read that was aborted by the timeout is a timeout, not an invalid reply.
      if (controller.signal.aborted && !(e instanceof RetryableFailure) && (e as Error).name === 'AbortError') {
        throw new RetryableFailure('upstream_timeout');
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /** `error.code` of an error body, or null. Bounded and never throws. */
  private async errorCodeOf(res: Response): Promise<string | null> {
    try {
      const body = JSON.parse(await this.readBounded(res, 16 * 1024)) as { error?: { code?: unknown } };
      return typeof body.error?.code === 'string' ? body.error.code.slice(0, 40) : null;
    } catch {
      return null;
    }
  }

  private async readBounded(res: Response, limit = this.maxBytes): Promise<string> {
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > limit) throw partnerError.invalid('reply_too_large');
    const reader = res.body?.getReader();
    if (!reader) return '';
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel().catch(() => undefined);
        throw partnerError.invalid('reply_too_large');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  // ---- base URL, breaker, cache --------------------------------------------

  /** Normalised base URL, after the SSRF guard (verdict remembered for a minute). */
  private async checkedBase(raw: string): Promise<string> {
    let u: URL;
    try {
      u = new URL(raw.trim());
    } catch {
      throw partnerError.notConfigured('base_url_malformed');
    }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.search || u.hash) {
      throw partnerError.notConfigured('base_url_unsupported');
    }
    const base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
    const okUntil = this.guarded.get(base);
    if (okUntil && okUntil > this.now()) return base;
    try {
      await this.urlGuard(base);
    } catch (e) {
      this.logger.warn(`partner API base URL refused by the SSRF guard: ${(e as Error).message}`);
      throw partnerError.notConfigured('base_url_blocked');
    }
    this.guarded.set(base, this.now() + 60_000);
    return base;
  }

  private assertBreakerClosed(tenantId: number): void {
    const b = this.breakers.get(tenantId);
    if (b && b.openUntil > this.now()) throw partnerError.unavailable('breaker_open');
  }

  private recordSuccess(tenantId: number): void {
    this.breakers.delete(tenantId);
  }

  private recordFailure(tenantId: number): void {
    const b = this.breakers.get(tenantId) ?? { failures: 0, openUntil: 0 };
    b.failures += 1;
    // At the threshold the breaker opens for a cooldown; a failed probe after
    // the cooldown re-opens it at once (failures stay >= threshold).
    if (b.failures >= this.breakerThreshold) b.openUntil = this.now() + this.breakerCooldownMs;
    this.breakers.set(tenantId, b);
  }

  /**
   * undefined = no usable entry; null = a cached "not found"; envelope otherwise.
   * An entry is re-validated against THIS context, so even a poisoned key cannot
   * return another hotel's reply.
   */
  private async readCache(key: string, ctx: PartnerCtx, topic: PartnerTopic): Promise<PartnerEnvelope | null | undefined> {
    if (!this.cache?.available()) return undefined;
    try {
      const hit = await this.cache.get(key);
      if (!hit) return undefined;
      const parsed = JSON.parse(hit) as unknown;
      if (parsed && typeof parsed === 'object' && (parsed as { notFound?: unknown }).notFound === true) return null;
      return validateEnvelope(parsed, ctx, topic);
    } catch {
      return undefined;
    }
  }

  private async writeCache(key: string, value: string, ttlSec: number): Promise<void> {
    if (!this.cache?.available() || ttlSec <= 0) return;
    try {
      await this.cache.set(key, value, ttlSec);
    } catch {
      /* a cache that cannot be written is just a cache miss next time */
    }
  }
}

/** Internal: a failure worth another attempt (network, timeout, 5xx). */
class RetryableFailure extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}
