import { envNumber } from '../../global/util/env-number.util';
import { ENGINE_FAILURE, classifyEngineFailure } from '../external/ai/engine-health';

/**
 * Timeout / retry primitives for outbound provider calls (PLN-261012 SG-84, D-19).
 *
 * Hand-rolled on purpose: the repo calls Anthropic, OpenAI, Voyage and Qdrant over plain
 * `fetch` (no SDKs), and none of those calls had a deadline — a provider that accepts
 * the connection and then stalls held a customer's turn open until the widget gave up.
 * Pure and clock/random-injectable so the behaviour is unit-testable without sleeping.
 */

/** The request ran past its deadline and was aborted. Never retried for completions. */
export class AiTimeoutError extends Error {
  readonly name = 'AiTimeoutError';
  constructor(
    readonly label: string,
    readonly timeoutMs: number,
  ) {
    super(`${label} request timed out after ${timeoutMs}ms`);
  }
}

/**
 * An HTTP error answer from a provider. The message keeps the exact shape the adapters
 * always threw ("Anthropic API error 529: ..."), because `classifyEngineFailure` and the
 * console health column read it; the status rides alongside so retry/breaker code does not
 * have to re-parse text.
 */
export class ProviderHttpError extends Error {
  readonly name = 'ProviderHttpError';
  constructor(
    message: string,
    readonly status: number,
    /** True when the adapter already spent its own retries (Voyage batch 429 backoff). */
    readonly alreadyRetried = false,
  ) {
    super(message);
  }
}

/** Whole-call deadline for an LLM completion (connect + generation + body read). */
export function aiRequestTimeoutMs(): number {
  return Math.max(1000, envNumber('AI_REQUEST_TIMEOUT_MS', 25_000));
}

/** Deadline for one embedding request — the live chat path waits on this. */
export function embedRequestTimeoutMs(): number {
  return Math.max(500, envNumber('EMBED_REQUEST_TIMEOUT_MS', 8_000));
}

/** Deadline for one Qdrant REST call. */
export function qdrantRequestTimeoutMs(): number {
  return Math.max(500, envNumber('QDRANT_REQUEST_TIMEOUT_MS', 5_000));
}

/**
 * Run `op` with an AbortController deadline. The timer covers the WHOLE operation, so `op`
 * must read the response body inside the callback — a server that sends headers and then
 * stalls the body would otherwise outlive the deadline.
 */
export async function runWithTimeout<T>(
  ms: number,
  label: string,
  op: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await op(controller.signal);
  } catch (e) {
    // Only OUR abort is a timeout; a caller-supplied abort or a plain network error stays itself.
    if (controller.signal.aborted) throw new AiTimeoutError(label, ms);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** A transport-level failure: the request never produced an HTTP answer. */
export function isNetworkError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  if (e instanceof AiTimeoutError || e instanceof ProviderHttpError) return false;
  const err = e as { name?: string; message?: string; code?: string; cause?: { code?: string } };
  if (err.code && NETWORK_CODES.has(err.code)) return true;
  if (err.cause?.code && NETWORK_CODES.has(err.cause.code)) return true;
  // Node's fetch (undici) reports every connection problem as `TypeError: fetch failed`.
  return err.name === 'TypeError' && /fetch failed/i.test(err.message ?? '');
}

/**
 * Worth trying again right away: network blips, 5xx, and 429. Not a timeout (the deadline
 * is the budget; a second one doubles the customer's wait for an engine that is already
 * slow), not a 4xx (the request itself is wrong), and not an out-of-credit 429 (OpenAI
 * reports a drained account that way, and no amount of retrying refills it).
 */
export function isTransientError(e: unknown): boolean {
  if (e instanceof AiTimeoutError) return false;
  if (e instanceof ProviderHttpError) {
    if (e.alreadyRetried) return false;
    if (classifyEngineFailure(e.message) === ENGINE_FAILURE.CREDIT) return false;
    return e.status === 429 || e.status >= 500;
  }
  return isNetworkError(e);
}

export interface RetryOptions {
  /** Retries AFTER the first attempt. 0 = a single attempt. */
  retries: number;
  /** Base backoff; the n-th wait is a random slice of `min(maxMs, baseMs * 2^n)` (full jitter). */
  baseMs?: number;
  maxMs?: number;
  retryOn?: (e: unknown) => boolean;
  /** Injected in tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (e: unknown, attempt: number, delayMs: number) => void;
}

/**
 * Bounded retry with full jitter. Full jitter (a uniform draw over the whole backoff window)
 * is what keeps a fleet of turns that all failed on the same blip from retrying in lockstep
 * and hitting the recovering provider as one wave.
 */
export async function retryWithJitter<T>(
  op: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const base = opts.baseMs ?? 300;
  const cap = opts.maxMs ?? 2_000;
  const retryOn = opts.retryOn ?? isTransientError;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const random = opts.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return await op(attempt);
    } catch (e) {
      if (attempt >= opts.retries || !retryOn(e)) throw e;
      const delay = Math.round(random() * Math.min(cap, base * 2 ** attempt));
      opts.onRetry?.(e, attempt + 1, delay);
      await sleep(delay);
    }
  }
}

/**
 * A small, fixed vocabulary for "why did the provider call fail" — used as a metric label and
 * in ops alerts, so it must stay bounded (never the raw message).
 */
export function failureReason(e: unknown): string {
  if (e instanceof AiTimeoutError) return 'timeout';
  if (isNetworkError(e)) return 'network';
  if (e instanceof ProviderHttpError) {
    if (classifyEngineFailure(e.message) === ENGINE_FAILURE.CREDIT) return 'credit';
    if (e.status === 429) return 'rate_limit';
    if (e.status >= 500) return 'server_error';
    if (e.status === 401 || e.status === 403) return 'auth';
    return 'rejected';
  }
  return 'other';
}
