/**
 * Engine health vocabulary (PLN-261007 S2/S3) — pure, shared by the gateway,
 * the connection tests and both consoles.
 *
 * The reasons are kept apart because the fixes differ: credit is a top-up,
 * auth a key to replace, model a name to correct, rate_limit a wait.
 * Collapsing them into "connection failed" sent people to check endpoints
 * that were fine — the go2joy credit outage (2026-10-06) read as
 * "unreachable" in the connection test.
 */
export const ENGINE_FAILURE = {
  CREDIT: 'credit',
  AUTH: 'auth',
  MODEL: 'model',
  RATE_LIMIT: 'rate_limit',
  UNREACHABLE: 'unreachable',
} as const;
export type EngineFailure = (typeof ENGINE_FAILURE)[keyof typeof ENGINE_FAILURE];

/** What a console shows for an engine. */
export const ENGINE_HEALTH = {
  OK: 'ok',
  UNKNOWN: 'unknown',
  NO_KEY: 'no_key',
  STUB: 'stub',
  DISABLED: 'disabled',
  ...ENGINE_FAILURE,
} as const;
export type EngineHealth = (typeof ENGINE_HEALTH)[keyof typeof ENGINE_HEALTH];

/**
 * Provider messages differ; the phrases in them do not. Credit is checked
 * first: Anthropic reports it as a 400 invalid_request_error and OpenAI as a
 * 429, so the status code alone would file it as a bad request or a wait.
 */
export function classifyEngineFailure(message: string): EngineFailure {
  const m = message.toLowerCase();
  if (/credit balance|insufficient[_ ]quota|exceeded your current quota|billing/.test(m)) {
    return ENGINE_FAILURE.CREDIT;
  }
  if (/\b(401|403)\b|unauthorized|invalid[_ ]api[_ ]key|authentication|not configured/.test(m)) {
    return ENGINE_FAILURE.AUTH;
  }
  if (/\b404\b|not[_ ]found|unknown model|model.*does not exist/.test(m)) {
    return ENGINE_FAILURE.MODEL;
  }
  if (/\b429\b|rate[_ ]limit|too many requests|overloaded/.test(m)) {
    return ENGINE_FAILURE.RATE_LIMIT;
  }
  return ENGINE_FAILURE.UNREACHABLE;
}

export interface EngineHealthInput {
  provider: string;
  status: string;
  hasKey: boolean;
  lastOkAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorReason: string | null;
}

/** The one rule both consoles read an engine's state by (PLN §1). */
export function engineHealth(e: EngineHealthInput): EngineHealth {
  if (e.provider === 'stub') return ENGINE_HEALTH.STUB;
  if (e.status !== 'enabled') return ENGINE_HEALTH.DISABLED;
  if (!e.hasKey) return ENGINE_HEALTH.NO_KEY;
  const ok = e.lastOkAt ? new Date(e.lastOkAt).getTime() : 0;
  const err = e.lastErrorAt ? new Date(e.lastErrorAt).getTime() : 0;
  if (err > ok) {
    const reason = e.lastErrorReason as EngineFailure | null;
    return reason && (Object.values(ENGINE_FAILURE) as string[]).includes(reason)
      ? reason
      : ENGINE_HEALTH.UNREACHABLE;
  }
  return ok ? ENGINE_HEALTH.OK : ENGINE_HEALTH.UNKNOWN;
}

/**
 * The provider's own words from an error body, safe to show: `type: message`,
 * single line. The caller redacts secrets; this only shapes.
 */
export function providerErrorSummary(body: string): string {
  try {
    const j = JSON.parse(body);
    const err = j?.error ?? j;
    const type = typeof err?.type === 'string' ? err.type : typeof err?.code === 'string' ? err.code : '';
    const msg = typeof err?.message === 'string' ? err.message : '';
    const out = [type, msg].filter(Boolean).join(': ');
    if (out) return out.replace(/\s+/g, ' ').slice(0, 200);
  } catch {
    /* not JSON — fall through */
  }
  return body.replace(/\s+/g, ' ').slice(0, 200);
}
