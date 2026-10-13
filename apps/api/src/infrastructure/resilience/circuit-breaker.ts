import { envNumber } from '../../global/util/env-number.util';
import { ProviderHttpError } from './resilience';
import { ENGINE_FAILURE, classifyEngineFailure } from '../external/ai/engine-health';

/**
 * Circuit breaker (PLN-261012 SG-84).
 *
 * Without one, a dead engine costs every customer turn the full request timeout (three
 * model calls per turn: classify, answer, moderate) before the stub fallback kicks in. After
 * `failureThreshold` consecutive engine-level failures the breaker OPENS and callers skip the
 * network call entirely for `openMs`; then ONE probe is let through (half-open) — success
 * closes it, failure re-opens it for another window.
 *
 * Pure state machine with an injectable clock so every transition is testable without timers.
 */
export type BreakerState = 'closed' | 'open' | 'half_open';

export interface BreakerOptions {
  failureThreshold: number;
  openMs: number;
  now?: () => number;
  /** Called on every state change — the gateway hooks metrics and ops alerts here. */
  onTransition?: (from: BreakerState, to: BreakerState) => void;
}

export interface BreakerSnapshot {
  state: BreakerState;
  consecutiveFailures: number;
  /** Epoch ms the breaker last opened; null while closed since boot. */
  openedAt: number | null;
}

export class CircuitBreaker {
  private current: BreakerState = 'closed';
  private failures = 0;
  private openedAt: number | null = null;
  /** When the single half-open probe was handed out; null = the slot is free. */
  private probeAt: number | null = null;
  private readonly now: () => number;

  constructor(private readonly opts: BreakerOptions) {
    this.now = opts.now ?? Date.now;
  }

  /** The state as of now — an open breaker whose window elapsed reads as half-open. */
  state(): BreakerState {
    if (this.current === 'open' && this.openedAt !== null && this.now() - this.openedAt >= this.opts.openMs) {
      this.transition('half_open');
    }
    return this.current;
  }

  /**
   * May the caller make the real call? Every `true` MUST be followed by `recordSuccess` or
   * `recordFailure`, otherwise a half-open probe slot stays taken (it self-heals after another
   * `openMs`, so a lost probe cannot wedge the breaker, but the outcome is how it learns).
   */
  allow(): boolean {
    const s = this.state();
    if (s === 'closed') return true;
    if (s === 'open') return false;
    // half-open: exactly one probe at a time.
    const t = this.now();
    if (this.probeAt !== null && t - this.probeAt < this.opts.openMs) return false;
    this.probeAt = t;
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.probeAt = null;
    if (this.current !== 'closed') {
      this.openedAt = null;
      this.transition('closed');
    }
  }

  recordFailure(): void {
    if (this.state() === 'half_open') {
      this.reopen();
      return;
    }
    if (this.current === 'open') return; // a straggler that started before the breaker opened
    this.failures += 1;
    if (this.failures >= this.opts.failureThreshold) this.reopen();
  }

  snapshot(): BreakerSnapshot {
    return { state: this.state(), consecutiveFailures: this.failures, openedAt: this.openedAt };
  }

  private reopen(): void {
    this.openedAt = this.now();
    this.probeAt = null;
    this.transition('open');
  }

  private transition(to: BreakerState): void {
    if (this.current === to) return;
    const from = this.current;
    this.current = to;
    this.opts.onTransition?.(from, to);
  }
}

/** Breaker knobs from the environment — read at construction so a restart applies a change. */
export function breakerOptionsFromEnv(): Pick<BreakerOptions, 'failureThreshold' | 'openMs'> {
  return {
    failureThreshold: Math.max(1, Math.round(envNumber('AI_BREAKER_FAILURE_THRESHOLD', 5))),
    openMs: Math.max(1, envNumber('AI_BREAKER_OPEN_SEC', 30)) * 1000,
  };
}

/** `AI_BREAKER_ENABLED=0|false` turns the breaker off (kill switch); default on. */
export function breakerEnabled(): boolean {
  const raw = process.env.AI_BREAKER_ENABLED?.trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off');
}

/**
 * Does this error say something about the ENGINE's health, as opposed to this one request?
 * A timeout, a dropped connection, a 5xx/429, a rejected key or an empty account all mean the
 * engine cannot serve the next call either. A plain 400/404/422 means the request was
 * unacceptable — the engine answered, so it counts as reachable and must not trip the breaker
 * (one malformed prompt would otherwise take the whole engine offline for every tenant on it).
 */
export function isEngineFailure(e: unknown): boolean {
  if (e instanceof ProviderHttpError) {
    if (e.status >= 500 || e.status === 429 || e.status === 401 || e.status === 403) return true;
    // Anthropic reports an empty account as a 400, so the status alone would miss it.
    const kind = classifyEngineFailure(e.message);
    return kind === ENGINE_FAILURE.CREDIT || kind === ENGINE_FAILURE.AUTH;
  }
  // Everything the adapters do NOT turn into an HTTP error answer — a timeout, a dropped
  // connection, a missing key, a 200 with an unreadable body — is the engine being unusable.
  // (Request-level rejections are always ProviderHttpError, handled above.)
  return true;
}
