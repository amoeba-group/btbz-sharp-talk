import * as http from 'http';
import type { AddressInfo } from 'net';
import { INTEGRATION_FIELDS, GENERIC_INTEGRATION_PROVIDERS } from '@sharptalk/types';
import { probeEcommerce } from './ecommerce-probe.util';

/**
 * "Test connection" for the Go2Joy partner-data API (PLN-261012 SG-32): a
 * credential check against OUR draft contract's /v0/ping — it needs no hotel and
 * proves only that the host answers and the key is accepted.
 */
describe('probeEcommerce — go2joy_partner_api', () => {
  let server: http.Server;
  let base: string;
  let seen: http.IncomingMessage[];
  let reply: (res: http.ServerResponse) => void;

  beforeEach(async () => {
    seen = [];
    reply = (res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"apiVersion":"0","status":"ok"}');
    };
    server = http.createServer((req, res) => {
      seen.push(req);
      reply(res);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    delete process.env.PARTNER_API_PRIVATE_HOSTS;
  });

  it('is a registered generic provider with base_url + api_key (+ optional signing_secret)', () => {
    expect(GENERIC_INTEGRATION_PROVIDERS).toContain('go2joy_partner_api');
    expect(INTEGRATION_FIELDS.go2joy_partner_api).toEqual([
      { key: 'base_url', secret: false, required: true },
      { key: 'api_key', secret: true, required: true },
      { key: 'signing_secret', secret: true, required: false },
    ]);
  });

  it('asks for the credentials when they are missing', async () => {
    const r = await probeEcommerce('go2joy_partner_api', { base_url: '', api_key: '' });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/Required credentials are missing/);
  });

  it('refuses a plain-http or internal base URL (SSRF) before any request', async () => {
    for (const base_url of ['http://example.com', 'https://127.0.0.1', 'https://169.254.169.254', 'https://10.0.0.5']) {
      const r = await probeEcommerce('go2joy_partner_api', { base_url, api_key: 'k' });
      expect(r.ok).toBe(false);
      expect(r.detail).toMatch(/Blocked/);
    }
    expect(seen).toHaveLength(0);
  });

  it('refuses a key that cannot travel in a header', async () => {
    process.env.PARTNER_API_PRIVATE_HOSTS = '127.0.0.1';
    const r = await probeEcommerce('go2joy_partner_api', { base_url: base, api_key: 'kéy with space' });
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/invalid characters/);
  });

  it('pings /v0/ping with the bearer key and no hotel headers', async () => {
    process.env.PARTNER_API_PRIVATE_HOSTS = '127.0.0.1';
    const r = await probeEcommerce('go2joy_partner_api', { base_url: `${base}/`, api_key: 'KEY-123' });
    expect(r).toEqual({ ok: true, detail: 'Connected' });
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('GET');
    expect(seen[0].url).toBe('/v0/ping');
    expect(seen[0].headers.authorization).toBe('Bearer KEY-123');
    expect(seen[0].headers['x-hotel-sn']).toBeUndefined();
  });

  it('reports a rejected key and other failures without leaking the key', async () => {
    process.env.PARTNER_API_PRIVATE_HOSTS = '127.0.0.1';
    reply = (res) => {
      res.writeHead(401);
      res.end();
    };
    const denied = await probeEcommerce('go2joy_partner_api', { base_url: base, api_key: 'SECRET-KEY' });
    expect(denied).toEqual({ ok: false, detail: 'Partner API key was rejected' });

    reply = (res) => {
      res.writeHead(500);
      res.end();
    };
    const broken = await probeEcommerce('go2joy_partner_api', { base_url: base, api_key: 'SECRET-KEY' });
    expect(broken).toEqual({ ok: false, detail: 'Partner API returned 500' });
    expect(JSON.stringify([denied, broken])).not.toContain('SECRET-KEY');
  });

  it('does not follow a redirect', async () => {
    process.env.PARTNER_API_PRIVATE_HOSTS = '127.0.0.1';
    reply = (res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/' });
      res.end();
    };
    const r = await probeEcommerce('go2joy_partner_api', { base_url: base, api_key: 'k' });
    expect(r.ok).toBe(false);
    expect(seen).toHaveLength(1);
  });
});
