import { promises as dns } from 'dns';
import { isIP } from 'net';
import { GenericIntegrationProvider } from '@sharptalk/types';
import { probePartner } from '../go2joy/partner-client';

export interface ProbeResult {
  ok: boolean;
  detail: string;
}

const TIMEOUT_MS = 6000;
/** Header-bound secrets must be printable ASCII, else fetch throws a ByteString error. */
const ASCII = /^[\x21-\x7e]+$/;

/** Raised when a tenant-supplied URL fails the SSRF allowlist (SEC-M3). */
export class SsrfBlockedError extends Error {}

/**
 * Reject a tenant-supplied URL that could reach internal infrastructure (SEC-M3).
 * Requires https, then resolves the host and blocks any private / loopback /
 * link-local / CGNAT / cloud-metadata address. Applied to the free-form Woo/Odoo
 * URLs before any fetch (Cafe24/Haravan are pinned to their vendor domains).
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('URL is malformed');
  }
  if (parsed.protocol !== 'https:') {
    throw new SsrfBlockedError('URL must use https');
  }
  const host = parsed.hostname;
  const literal = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
  const addrs = isIP(literal)
    ? [literal]
    : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length) throw new SsrfBlockedError('host did not resolve');
  for (const addr of addrs) {
    if (isBlockedAddress(addr)) {
      throw new SsrfBlockedError('URL resolves to a non-public address');
    }
  }
}

/** True for loopback / private / link-local / CGNAT / metadata / unspecified IPs. */
function isBlockedAddress(addr: string): boolean {
  const v = isIP(addr);
  if (v === 4) {
    const p = addr.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true;
    const [a, b] = p;
    if (a === 10 || a === 127 || a === 0) return true; // private / loopback / this-host
    if (a === 169 && b === 254) return true; // link-local + 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (100.64/10)
    return false;
  }
  // IPv6: block loopback, unspecified, ULA (fc00::/7), link-local (fe80::/10),
  // and IPv4-mapped (::ffff:a.b.c.d) by re-checking the embedded v4.
  const lower = addr.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true;
  }
  const mapped = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedAddress(mapped[1]);
  return false;
}

async function httpFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function missing(): ProbeResult {
  return { ok: false, detail: 'Required credentials are missing — fill in and save first' };
}

function normHost(v: string): string {
  return v.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/**
 * Live connectivity probe per e-commerce provider. Never throws — any failure is
 * returned as { ok:false, detail }. Each provider hits a lightweight authenticated
 * endpoint with the stored credentials.
 */
export async function probeEcommerce(
  provider: GenericIntegrationProvider,
  config: Record<string, string>,
): Promise<ProbeResult> {
  try {
    switch (provider) {
      case 'woocommerce':
        return await probeWoocommerce(config);
      case 'odoo':
        return await probeOdoo(config);
      case 'cafe24':
        return await probeCafe24(config);
      case 'haravan':
        return await probeHaravan(config);
      case 'klaviyo':
        return await probeKlaviyo(config);
      case 'yotpo':
        return await probeYotpo(config);
      case 'gorgias':
        return await probeGorgias(config);
      case 'go2joy_partner':
        return await probePartner(config);
      default:
        return { ok: false, detail: 'Unsupported provider' };
    }
  } catch (e) {
    if (e instanceof SsrfBlockedError) {
      return { ok: false, detail: `Blocked: ${e.message}` };
    }
    return { ok: false, detail: `Connection failed: ${(e as Error).message}` };
  }
}

/** WooCommerce REST v3 — Basic auth (consumer key/secret) against system_status. */
async function probeWoocommerce(c: Record<string, string>): Promise<ProbeResult> {
  const base = (c.store_url ?? '').trim().replace(/\/+$/, '');
  const key = (c.consumer_key ?? '').trim();
  const secret = (c.consumer_secret ?? '').trim();
  if (!base || !key || !secret) return missing();
  if (!ASCII.test(key) || !ASCII.test(secret)) {
    return { ok: false, detail: 'Consumer key/secret contain invalid characters' };
  }
  await assertPublicUrl(base); // SEC-M3: tenant-supplied store URL
  const auth = Buffer.from(`${key}:${secret}`).toString('base64');
  const res = await httpFetch(`${base}/wp-json/wc/v3/system_status`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  if (res.ok) return { ok: true, detail: 'Connected' };
  return { ok: false, detail: `WooCommerce returned ${res.status}` };
}

/** Odoo external API — JSON-RPC common.authenticate returns a numeric uid on success. */
async function probeOdoo(c: Record<string, string>): Promise<ProbeResult> {
  const url = (c.url ?? '').trim().replace(/\/+$/, '');
  const db = (c.db ?? '').trim();
  const username = (c.username ?? '').trim();
  const apiKey = (c.api_key ?? '').trim();
  if (!url || !db || !username || !apiKey) return missing();
  await assertPublicUrl(url); // SEC-M3: tenant-supplied Odoo URL
  const res = await httpFetch(`${url}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { service: 'common', method: 'authenticate', args: [db, username, apiKey, {}] },
      id: 1,
    }),
  });
  if (!res.ok) return { ok: false, detail: `Odoo returned ${res.status}` };
  const data = (await res.json()) as { result?: unknown; error?: { data?: { message?: string } } };
  if (typeof data.result === 'number' && data.result > 0) {
    return { ok: true, detail: `Connected (uid ${data.result})` };
  }
  if (data.error) return { ok: false, detail: data.error.data?.message ?? 'Odoo authentication failed' };
  return { ok: false, detail: 'Odoo authentication failed — check db / user / API key' };
}

/** Cafe24 Admin API v2 — Bearer OAuth token against the store resource. */
async function probeCafe24(c: Record<string, string>): Promise<ProbeResult> {
  const mall = (c.mall_id ?? '').trim().replace(/\.cafe24api\.com.*$/, '');
  const token = (c.access_token ?? '').trim();
  if (!mall || !token) return missing();
  if (!ASCII.test(token)) return { ok: false, detail: 'Access token contains invalid characters' };
  const res = await httpFetch(`https://${mall}.cafe24api.com/api/v2/admin/store`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Cafe24-Api-Version': '2024-06-01',
    },
  });
  if (res.ok) return { ok: true, detail: 'Connected' };
  if (res.status === 401) return { ok: false, detail: 'Cafe24 token invalid or expired' };
  return { ok: false, detail: `Cafe24 returned ${res.status}` };
}

/** Klaviyo API — private API key against the accounts resource (read-only, cheap). */
async function probeKlaviyo(c: Record<string, string>): Promise<ProbeResult> {
  const key = (c.api_key ?? '').trim();
  if (!key) return missing();
  if (!ASCII.test(key)) return { ok: false, detail: 'API key contains invalid characters' };
  const res = await httpFetch('https://a.klaviyo.com/api/accounts/', {
    headers: {
      Authorization: `Klaviyo-API-Key ${key}`,
      Accept: 'application/vnd.api+json',
      // Klaviyo requires a dated revision header on every call.
      revision: '2025-07-15',
    },
  });
  if (res.ok) return { ok: true, detail: 'Connected' };
  if (res.status === 401 || res.status === 403) {
    return { ok: false, detail: 'Klaviyo API key invalid or lacks accounts:read' };
  }
  return { ok: false, detail: `Klaviyo returned ${res.status}` };
}

/** Yotpo core API — client_credentials token mint proves the app/secret pair. */
async function probeYotpo(c: Record<string, string>): Promise<ProbeResult> {
  const appKey = (c.app_key ?? '').trim();
  const secret = (c.secret_key ?? '').trim();
  if (!appKey || !secret) return missing();
  const res = await httpFetch('https://api.yotpo.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: appKey,
      client_secret: secret,
      grant_type: 'client_credentials',
    }),
  });
  if (!res.ok) return { ok: false, detail: `Yotpo returned ${res.status}` };
  const data = (await res.json().catch(() => ({}))) as { access_token?: string };
  return data.access_token
    ? { ok: true, detail: 'Connected' }
    : { ok: false, detail: 'Yotpo rejected the app key / secret pair' };
}

/** Gorgias REST — Basic (account email + REST API key) against the account resource. */
async function probeGorgias(c: Record<string, string>): Promise<ProbeResult> {
  const subdomain = normHost(c.subdomain ?? '').replace(/\.gorgias\.com.*$/i, '');
  const email = (c.email ?? '').trim();
  const key = (c.api_key ?? '').trim();
  if (!subdomain || !email || !key) return missing();
  if (!ASCII.test(email) || !ASCII.test(key)) {
    return { ok: false, detail: 'Email / API key contain invalid characters' };
  }
  const auth = Buffer.from(`${email}:${key}`).toString('base64');
  const res = await httpFetch(`https://${subdomain}.gorgias.com/api/account`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
  });
  if (res.ok) return { ok: true, detail: 'Connected' };
  if (res.status === 401) return { ok: false, detail: 'Gorgias credentials invalid' };
  return { ok: false, detail: `Gorgias returned ${res.status}` };
}

/** Haravan Admin API (Shopify-compatible) — Bearer access token against shop.json. */
async function probeHaravan(c: Record<string, string>): Promise<ProbeResult> {
  const shop = normHost(c.shop_domain ?? '');
  const token = (c.access_token ?? '').trim();
  if (!shop || !token) return missing();
  if (!ASCII.test(token)) return { ok: false, detail: 'Access token contains invalid characters' };
  const res = await httpFetch(`https://${shop}/admin/shop.json`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (res.ok) return { ok: true, detail: 'Connected' };
  if (res.status === 401) return { ok: false, detail: 'Haravan token invalid or expired' };
  return { ok: false, detail: `Haravan returned ${res.status}` };
}
