import { createHmac } from 'crypto';
import { assertPublicUrl } from '../tenant/ecommerce-probe.util';

/**
 * Go2Joy Partner API client (PLN-261023 hotel profile).
 *
 * Every call is a POST whose body carries `clientId` + `timestamp`, signed as
 * `hex(HMAC-SHA256(secret, URL + "|" + JSON with keys sorted))` in the
 * `Authorization` header (Partner API doc §2–5). The body is sent exactly as
 * signed — a re-serialised body would not match.
 *
 * Response envelope: `{ code: 1 ok | 2 failed | 0 server error, error, data }`,
 * where `error` is an object or an array of `{ code, message }`. Error codes we
 * branch on (measured 2026-10-21/23): 4 parameter (an unknown hotelSn lands
 * here), 6 signature, 8 clientId/IP, 10 permission (a wrong clientId lands
 * here, not 8), 11 not found, 12 rate limit.
 */

export interface PartnerConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
}

export type PartnerErrorKind =
  | 'signature'
  | 'client'
  | 'not_found'
  | 'parameter'
  | 'rate_limited'
  | 'server'
  | 'network';

export class PartnerApiError extends Error {
  constructor(
    readonly kind: PartnerErrorKind,
    message: string,
    readonly code: number | null = null,
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 10_000;

/** The integration credential blob (snake_case keys) → client config; null when incomplete. */
export function readPartnerConfig(raw: Record<string, string> | null | undefined): PartnerConfig | null {
  const baseUrl = String(raw?.base_url ?? '').trim();
  const clientId = String(raw?.client_id ?? '').trim();
  const clientSecret = String(raw?.client_secret ?? '').trim();
  if (!baseUrl || !clientId || !clientSecret) return null;
  return { baseUrl: baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`, clientId, clientSecret };
}

/** Keys sorted, no spaces — the string both sides sign. */
export function sortedJson(body: Record<string, unknown>): string {
  return JSON.stringify(Object.fromEntries(Object.keys(body).sort().map((k) => [k, body[k]])));
}

export function partnerSignature(secret: string, url: string, json: string): string {
  return createHmac('sha256', secret).update(`${url}|${json}`).digest('hex');
}

/** First `{ code, message }` of an error that is an object or an array of them. */
function firstError(error: unknown): { code: number | null; message: string } {
  const e = Array.isArray(error) ? error[0] : error;
  const obj = (e && typeof e === 'object' ? e : {}) as { code?: unknown; message?: unknown };
  return {
    code: typeof obj.code === 'number' ? obj.code : null,
    message: typeof obj.message === 'string' ? obj.message : 'Partner API error',
  };
}

function kindOf(code: number | null, message: string): PartnerErrorKind {
  switch (code) {
    case 6:
      return 'signature';
    case 8:
    case 10:
      return 'client';
    case 11:
      return 'not_found';
    case 12:
      return 'rate_limited';
    case 4:
      // "The selected hotelSn is invalid." — the API's way of saying "no such hotel".
      return /hotelSn/i.test(message) ? 'not_found' : 'parameter';
    default:
      return 'server';
  }
}

/**
 * One signed call. Returns `data` on `code: 1`; throws PartnerApiError otherwise.
 * `fetchImpl` is injectable for tests.
 */
export async function partnerCall<T>(
  cfg: PartnerConfig,
  path: string,
  params: Record<string, unknown>,
  opts: { lang?: 'en' | 'vi'; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const url = `${cfg.baseUrl}${path.replace(/^\//, '')}`;
  await assertPublicUrl(url);
  const json = sortedJson({ ...params, clientId: cfg.clientId, timestamp: Math.floor(Date.now() / 1000) });
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Authorization: partnerSignature(cfg.clientSecret, url, json),
        Localization: opts.lang ?? 'en',
      },
      body: json,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new PartnerApiError('network', `Partner API unreachable: ${(err as Error).message}`);
  }
  type Envelope = { code?: number; error?: unknown; data?: unknown };
  let body: Envelope | null;
  try {
    body = (await res.json()) as Envelope | null;
  } catch {
    throw new PartnerApiError('server', `Partner API returned HTTP ${res.status} without JSON`);
  }
  if (body?.code === 1) return body.data as T;
  const err = firstError(body?.error);
  throw new PartnerApiError(kindOf(err.code, err.message), err.message, err.code);
}

/**
 * Connection test: Hotel Info for a hotel that cannot exist. A "no such hotel"
 * answer proves clientId and signature were both accepted — the API checks them
 * before it looks the hotel up — without depending on any real hotel.
 */
export async function probePartner(
  raw: Record<string, string>,
  fetchImpl?: typeof fetch,
): Promise<{ ok: boolean; detail: string }> {
  const cfg = readPartnerConfig(raw);
  if (!cfg) return { ok: false, detail: 'Server URL, client ID and client secret are required' };
  try {
    await partnerCall(cfg, 'api/v2/hotel/getHotelInfo', { hotelSn: 0 }, { fetchImpl });
    return { ok: true, detail: 'Connected' };
  } catch (err) {
    if (!(err instanceof PartnerApiError)) throw err;
    switch (err.kind) {
      case 'not_found':
        return { ok: true, detail: 'Connected' };
      case 'signature':
        return { ok: false, detail: 'Signature rejected — check the client secret' };
      case 'client':
        return { ok: false, detail: 'Client rejected — check the client ID (or the server IP allowlist)' };
      default:
        return { ok: false, detail: err.message.slice(0, 200) };
    }
  }
}
