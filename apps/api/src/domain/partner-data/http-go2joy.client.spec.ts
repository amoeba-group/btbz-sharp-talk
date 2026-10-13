import { createHmac } from 'crypto';
import * as http from 'http';
import type { AddressInfo } from 'net';
import { assertPartnerApiUrl } from '../tenant/ecommerce-probe.util';
import { HttpGo2JoyClient, canonicalString, partnerCacheKey, signRequest, sortedQueryString } from './http-go2joy.client';
import type { PartnerCache, PartnerCredentials } from './http-go2joy.client';
import { PartnerError } from './partner-data.constants';
import { partnerCtxOf } from './partner-ctx';
import type { PartnerCtx } from './partner-ctx';
import { TopicRegistry } from './partner-topics';

/**
 * The live client against a LOCAL fake server (PLN-261012 SG-32). Go2Joy's real
 * API has not been delivered; this proves the client's behaviour against OUR
 * draft contract — timeouts, retries, GET-only, echoed-hotel validation, cache
 * keys, circuit breaker — and nothing about Go2Joy's actual service.
 */
describe('HttpGo2JoyClient (local fake server)', () => {
  interface Seen {
    method: string;
    url: string;
    headers: http.IncomingHttpHeaders;
  }
  type Handler = (req: http.IncomingMessage, res: http.ServerResponse, n: number) => void;

  let server: http.Server;
  let base: string;
  let seen: Seen[];
  let handler: Handler;

  const ctxFor = (hotelSn: string, role: 'manager' | 'receptionist' | 'internal' = 'manager', verifiedAtMs = Date.now() - 5_000): PartnerCtx =>
    partnerCtxOf(
      {
        tenantId: 1,
        identityClaims: { hotelSn, role, signed: true, verifiedAt: new Date(verifiedAtMs).toISOString() },
      },
      verifiedAtMs + 5_000,
    );

  const policiesBody = (hotelSn: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      apiVersion: '0',
      hotelSn,
      topic: 'policies',
      generatedAt: '2026-10-13T09:00:00+07:00',
      data: { policies: [{ type: 'refund', processingDays: 7, method: 'wallet' }] },
      ...extra,
    });

  /** The reply a CORRECT partner API gives: echo the hotel it was asked for. */
  const correctApi: Handler = (req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(policiesBody(String(req.headers['x-hotel-sn'])));
  };

  const creds = (over: Partial<PartnerCredentials> = {}) => ({
    get: async (): Promise<PartnerCredentials | null> => ({ baseUrl: base, apiKey: 'KEY-123', ...over }),
  });

  const make = (opts: Partial<ConstructorParameters<typeof HttpGo2JoyClient>[3]> = {}, cache: PartnerCache | null = null, c = creds()) =>
    new HttpGo2JoyClient(c, new TopicRegistry(), cache, {
      urlGuard: async () => undefined, // the fake server is on 127.0.0.1; the guard has its own tests below
      timeoutMs: 200,
      maxAttempts: 2,
      jitterMs: [0, 1],
      sleep: async () => undefined,
      ...opts,
    });

  const memoryCache = () => {
    const store = new Map<string, string>();
    const cache: PartnerCache & { store: Map<string, string>; ttl: Map<string, number | undefined> } = {
      store,
      ttl: new Map(),
      available: () => true,
      get: async (k) => store.get(k) ?? null,
      set: async (k, v, ttl) => {
        store.set(k, v);
        cache.ttl.set(k, ttl);
      },
    };
    return cache;
  };

  beforeEach(async () => {
    seen = [];
    handler = correctApi;
    server = http.createServer((req, res) => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
      handler(req, res, seen.length);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    delete process.env.PARTNER_API_PRIVATE_HOSTS;
  });

  const failure = async (p: Promise<unknown>): Promise<PartnerError> => {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(PartnerError);
      return e as PartnerError;
    }
    throw new Error('expected the call to fail');
  };

  describe('the request', () => {
    it('is a GET carrying the hotel from the CONTEXT in X-Hotel-Sn — and none in the query', async () => {
      const client = make();
      const env = await client.get(ctxFor('1721', 'receptionist'), 'policies', { type: 'refund' });
      expect(env?.hotelSn).toBe('1721');
      expect(seen).toHaveLength(1);
      expect(seen[0].method).toBe('GET');
      expect(seen[0].url).toBe('/v0/policies?type=refund');
      expect(seen[0].headers['x-hotel-sn']).toBe('1721');
      expect(seen[0].headers['x-actor-role']).toBe('receptionist');
      expect(seen[0].headers.authorization).toBe('Bearer KEY-123');
      expect(seen[0].url).not.toMatch(/hotel/i);
      expect(String(seen[0].headers['x-request-id'])).toMatch(/^[0-9a-f-]{36}$/);
      expect(Number(seen[0].headers['x-request-timestamp'])).toBeGreaterThan(1_700_000_000);
      expect(Number(seen[0].headers['x-claims-verified-at'])).toBeGreaterThan(1_700_000_000);
    });

    it('sends no X-Signature without a signing secret', async () => {
      await make().get(ctxFor('1721'), 'policies', {});
      expect(seen[0].headers['x-signature']).toBeUndefined();
    });

    it('signs the request when a signing secret is configured (verifiable by the receiver)', async () => {
      const client = make({}, null, creds({ signingSecret: 'S3CRET' }));
      handler = (req, res) => {
        // The receiver recomputes the canonical string from what it received.
        const url = new URL(req.url ?? '', 'http://x');
        const query = Object.fromEntries(url.searchParams.entries());
        const expected = signRequest('S3CRET', {
          method: 'GET',
          path: url.pathname,
          query,
          hotelSn: String(req.headers['x-hotel-sn']),
          role: String(req.headers['x-actor-role']),
          claimsVerifiedAtSec: Number(req.headers['x-claims-verified-at']),
          timestampSec: Number(req.headers['x-request-timestamp']),
          requestId: String(req.headers['x-request-id']),
        });
        res.writeHead(req.headers['x-signature'] === expected ? 200 : 401, { 'content-type': 'application/json' });
        res.end(policiesBody(String(req.headers['x-hotel-sn'])));
      };
      const env = await client.get(ctxFor('1721'), 'policies', { type: 'cancellation' });
      expect(env?.hotelSn).toBe('1721');
      expect(String(seen[0].headers['x-signature'])).toMatch(/^v1=[0-9a-f]{64}$/);
    });

    it('has a canonical string / signature that is stable (the vector in the cover note)', () => {
      const fields = {
        method: 'GET' as const,
        path: '/v0/rates',
        query: { roomType: 'DELUXE', date: '2026-10-17', rateType: 'overnight' },
        hotelSn: '1721',
        role: 'manager',
        claimsVerifiedAtSec: 1760000000,
        timestampSec: 1760000100,
        requestId: '11111111-2222-3333-4444-555555555555',
      };
      const canonical = canonicalString(fields);
      expect(canonical).toBe(
        [
          'v1',
          'GET',
          '/v0/rates',
          'date=2026-10-17&rateType=overnight&roomType=DELUXE',
          '1721',
          'manager',
          '1760000000',
          '1760000100',
          '11111111-2222-3333-4444-555555555555',
        ].join('\n'),
      );
      expect(signRequest('test-secret', fields)).toBe(`v1=${createHmac('sha256', 'test-secret').update(canonical).digest('hex')}`);
    });

    it('sorts and RFC 3986 encodes the query', () => {
      expect(sortedQueryString({ b: 'x y', a: "o'k", c: 1 })).toBe('a=o%27k&b=x%20y&c=1');
      expect(sortedQueryString({})).toBe('');
    });
  });

  describe('failures', () => {
    it('times out per attempt and gives up after the attempts are used (all GET)', async () => {
      handler = () => undefined; // never answers
      const e = await failure(make({ timeoutMs: 80, maxAttempts: 2 }).get(ctxFor('1721'), 'policies', {}));
      expect(e.code).toBe('E5100');
      expect(e.reason).toBe('upstream_timeout');
      expect(seen).toHaveLength(2);
      expect(seen.every((s) => s.method === 'GET')).toBe(true);
    });

    it('retries a 5xx once and succeeds — with the SAME request id', async () => {
      handler = (req, res, n) => {
        if (n === 1) {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end('{"error":{"code":"unavailable","message":"x","requestId":"r"}}');
          return;
        }
        correctApi(req, res, n);
      };
      const env = await make().get(ctxFor('1721'), 'policies', {});
      expect(env?.hotelSn).toBe('1721');
      expect(seen).toHaveLength(2);
      expect(seen[0].headers['x-request-id']).toBe(seen[1].headers['x-request-id']);
    });

    it('retries a dropped connection, then reports the partner as unavailable', async () => {
      handler = (req) => req.socket.destroy();
      const e = await failure(make().get(ctxFor('1721'), 'policies', {}));
      expect(e.code).toBe('E5100');
      expect(e.reason).toBe('upstream_network');
      expect(seen).toHaveLength(2);
    });

    it('does NOT retry a 4xx (our request or credentials are wrong)', async () => {
      handler = (_req, res) => {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end('{"error":{"code":"hotel_scope_mismatch","message":"x","requestId":"r"}}');
      };
      const e = await failure(make().get(ctxFor('1721'), 'policies', {}));
      expect(e.code).toBe('E5100');
      expect(e.reason).toBe('upstream_403');
      expect(e.detail?.upstreamCode).toBe('hotel_scope_mismatch');
      expect(seen).toHaveLength(1);
    });

    it('maps a 429 to E5108 without retrying', async () => {
      handler = (_req, res) => {
        res.writeHead(429, { 'retry-after': '5' });
        res.end();
      };
      const e = await failure(make().get(ctxFor('1721'), 'policies', {}));
      expect(e.code).toBe('E5108');
      expect(seen).toHaveLength(1);
    });

    it('treats 404 as "nothing there" — an answer, not an error', async () => {
      handler = (_req, res) => {
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end('{"error":{"code":"not_found","message":"x","requestId":"r"}}');
      };
      expect(await make().get(ctxFor('1721'), 'bookings', { bookingCode: 'ABC123456' })).toBeNull();
      expect(seen).toHaveLength(1);
    });

    it('refuses a reply that is not JSON, not parseable, or too large (E5105)', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html>');
      };
      expect((await failure(make().get(ctxFor('1721'), 'policies', {}))).reason).toBe('reply_not_json');

      handler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{not json');
      };
      expect((await failure(make().get(ctxFor('1721'), 'policies', {}))).reason).toBe('reply_not_parseable');

      handler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('x'.repeat(4096));
      };
      const e = await failure(make({ maxBytes: 1024 }).get(ctxFor('1721'), 'policies', {}));
      expect(e.code).toBe('E5105');
      expect(e.reason).toBe('reply_too_large');
    });

    it('does not follow a redirect (it could point at an internal host)', async () => {
      handler = (_req, res) => {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' });
        res.end();
      };
      const e = await failure(make().get(ctxFor('1721'), 'policies', {}));
      expect(e.code).toBe('E5100');
      expect(seen).toHaveLength(2); // retried as a network failure; the redirect target was never contacted
      expect(seen.every((s) => s.url === '/v0/policies')).toBe(true);
    });

    it('is E5106 (no request at all) when the tenant has not configured the connection', async () => {
      const e = await failure(make({}, null, { get: async () => null }).get(ctxFor('1721'), 'policies', {}));
      expect(e.code).toBe('E5106');
      expect(seen).toHaveLength(0);
    });
  });

  describe('the reply must be about the hotel we asked for', () => {
    it('drops a reply whose echoed hotel differs from the context (E5105) and never caches it', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(policiesBody('2204')); // a mixed-up reply: another hotel's data
      };
      const cache = memoryCache();
      const e = await failure(make({}, cache).get(ctxFor('1721'), 'policies', {}));
      expect(e.code).toBe('E5105');
      expect(e.reason).toBe('hotel_echo_mismatch');
      expect(cache.store.size).toBe(0);
    });

    it('drops a reply with the wrong topic or no echoed hotel', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(policiesBody('1721', { topic: 'settlement' }));
      };
      expect((await failure(make().get(ctxFor('1721'), 'policies', {}))).reason).toBe('envelope_topic_mismatch');
      handler = (_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ apiVersion: '0', topic: 'policies', generatedAt: '2026-10-13T09:00:00+07:00', data: {} }));
      };
      expect((await failure(make().get(ctxFor('1721'), 'policies', {}))).reason).toBe('envelope_no_hotel');
    });
  });

  describe('cache', () => {
    it('keys on tenant AND hotel, and serves the second identical call from the cache', async () => {
      const cache = memoryCache();
      const client = make({}, cache);
      const ctx = ctxFor('1721');
      await client.get(ctx, 'policies', { type: 'refund' });
      await client.get(ctx, 'policies', { type: 'refund' });
      expect(seen).toHaveLength(1);
      const keys = [...cache.store.keys()];
      expect(keys).toHaveLength(1);
      expect(keys[0]).toBe(partnerCacheKey(ctx, 'policies', { type: 'refund' }));
      expect(keys[0]).toContain(':1721:');
      expect(keys[0]).toContain(':1:'); // tenant
      expect(cache.ttl.get(keys[0])).toBe(60); // policies: 60 s (30-60 s window)
    });

    it('never serves one hotel\'s cached reply to another hotel', async () => {
      const cache = memoryCache();
      const client = make({}, cache);
      await client.get(ctxFor('1721'), 'policies', {});
      const other = await client.get(ctxFor('2204'), 'policies', {});
      expect(other?.hotelSn).toBe('2204');
      expect(seen).toHaveLength(2);
      expect(partnerCacheKey(ctxFor('1721'), 'policies', {})).not.toBe(partnerCacheKey(ctxFor('2204'), 'policies', {}));
    });

    it('distinguishes tenants and queries too', () => {
      const a = ctxFor('1721');
      const b = partnerCtxOf({
        tenantId: 2,
        identityClaims: { hotelSn: '1721', role: 'manager', signed: true, verifiedAt: new Date().toISOString() },
      });
      expect(partnerCacheKey(a, 'rates', {})).not.toBe(partnerCacheKey(b, 'rates', {}));
      expect(partnerCacheKey(a, 'rates', { date: '2026-10-17' })).not.toBe(partnerCacheKey(a, 'rates', { date: '2026-10-18' }));
    });

    it('re-validates a cached reply: a poisoned entry (another hotel\'s data under this key) is ignored', async () => {
      const cache = memoryCache();
      const ctx = ctxFor('1721');
      cache.store.set(partnerCacheKey(ctx, 'policies', {}), policiesBody('2204'));
      const env = await make({}, cache).get(ctx, 'policies', {});
      expect(env?.hotelSn).toBe('1721');
      expect(seen).toHaveLength(1); // it went to the server instead of trusting the entry
    });

    it('caches a not-found briefly, and only validated replies otherwise', async () => {
      handler = (_req, res) => {
        res.writeHead(404);
        res.end();
      };
      const cache = memoryCache();
      const ctx = ctxFor('1721');
      expect(await make({}, cache).get(ctx, 'bookings', { bookingCode: 'ABC123456' })).toBeNull();
      expect(await make({}, cache).get(ctx, 'bookings', { bookingCode: 'ABC123456' })).toBeNull();
      expect(seen).toHaveLength(1);
      const [key] = [...cache.store.keys()];
      expect(cache.ttl.get(key)).toBe(15);
    });
  });

  describe('circuit breaker', () => {
    it('opens after repeated failures, fails fast without a request, then recovers after the cooldown', async () => {
      let t = 1_000_000;
      handler = (_req, res) => {
        res.writeHead(503);
        res.end();
      };
      const client = make({ now: () => t, maxAttempts: 1, breakerThreshold: 2, breakerCooldownMs: 30_000 });
      const ctx = ctxFor('1721');
      await failure(client.get(ctx, 'policies', {}));
      await failure(client.get(ctx, 'policies', {}));
      expect(seen).toHaveLength(2);

      const fast = await failure(client.get(ctx, 'policies', {}));
      expect(fast.reason).toBe('breaker_open');
      expect(seen).toHaveLength(2); // nothing was sent

      t += 31_000; // cooldown over: one probe goes through
      handler = correctApi;
      expect((await client.get(ctx, 'policies', {}))?.hotelSn).toBe('1721');
      expect(seen).toHaveLength(3);
      // and the breaker is closed again: the next call goes through at once
      expect((await client.get(ctx, 'policies', { type: 'refund' }))?.hotelSn).toBe('1721');
      expect(seen).toHaveLength(4);
    });

    it('is per tenant: one tenant\'s outage does not stop another', async () => {
      handler = (_req, res) => {
        res.writeHead(503);
        res.end();
      };
      const client = make({ maxAttempts: 1, breakerThreshold: 1 });
      await failure(client.get(ctxFor('1721'), 'policies', {}));
      expect((await failure(client.get(ctxFor('1721'), 'policies', {}))).reason).toBe('breaker_open');
      const tenant2 = partnerCtxOf({
        tenantId: 2,
        identityClaims: { hotelSn: '1721', role: 'manager', signed: true, verifiedAt: new Date().toISOString() },
      });
      handler = correctApi;
      expect((await client.get(tenant2, 'policies', {}))?.hotelSn).toBe('1721');
    });
  });

  describe('base URL guard', () => {
    it('the default guard refuses a loopback host (SSRF) and the call never leaves', async () => {
      const client = make({ urlGuard: undefined });
      const e = await failure(client.get(ctxFor('1721'), 'policies', {}));
      expect(e.code).toBe('E5106');
      expect(e.reason).toBe('base_url_blocked');
      expect(seen).toHaveLength(0);
    });

    it('the operator (env) — not the tenant — can allow a private host', async () => {
      process.env.PARTNER_API_PRIVATE_HOSTS = '127.0.0.1';
      const client = make({ urlGuard: undefined });
      expect((await client.get(ctxFor('1721'), 'policies', {}))?.hotelSn).toBe('1721');
    });

    it('refuses a base URL with credentials, a query or a non-http scheme', async () => {
      for (const baseUrl of ['http://user:pw@127.0.0.1:1', 'http://127.0.0.1:1/?x=1', 'ftp://example.com', 'not a url']) {
        const client = make({}, null, creds({ baseUrl }));
        expect((await failure(client.get(ctxFor('1721'), 'policies', {}))).code).toBe('E5106');
      }
      expect(seen).toHaveLength(0);
    });

    it('assertPartnerApiUrl: https + public only, unless the operator listed the host', async () => {
      await expect(assertPartnerApiUrl('http://example.com')).rejects.toThrow(/https/);
      await expect(assertPartnerApiUrl('https://10.0.0.5')).rejects.toThrow(/non-public/);
      await expect(assertPartnerApiUrl('https://169.254.169.254')).rejects.toThrow(/non-public/);
      process.env.PARTNER_API_PRIVATE_HOSTS = 'partner.internal.example,10.0.0.5';
      await expect(assertPartnerApiUrl('https://10.0.0.5')).resolves.toBeUndefined();
      const prod = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      await expect(assertPartnerApiUrl('http://10.0.0.5')).rejects.toThrow(/not allowed in production/);
      process.env.NODE_ENV = prod;
      await expect(assertPartnerApiUrl('http://10.0.0.5')).resolves.toBeUndefined();
    });
  });
});
