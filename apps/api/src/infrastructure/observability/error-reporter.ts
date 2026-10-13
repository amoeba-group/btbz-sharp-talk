import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { redactSecrets } from '../../global/util/secret-redact.util';
import { scrubPii } from '../../global/util/pii-scrub.util';
import { envNumber } from '../../global/util/env-number.util';
import { m } from './app-metrics';

/**
 * Server error tracking (PLN-261012 SG-83).
 *
 * A port with two sinks:
 *  - a generic WEBHOOK sink (`ERROR_WEBHOOK_URL`): rate-limited, PII-scrubbed JSON, stack truncated;
 *  - an optional SENTRY sink that activates only when `SENTRY_DSN` is set AND `@sentry/node` can be
 *    resolved at runtime. The package is deliberately NOT in package.json (the build environment has
 *    no network and the dependency is optional). This adapter is "Sentry-compatible" — it calls the
 *    documented `init` / `captureException` surface — but it has NOT been exercised against a real
 *    Sentry project or the real SDK, only against a stand-in with that surface (see the unit tests).
 *
 * Everything is best-effort and non-throwing: reporting an error must never raise another one.
 * Only 5xx and unhandled errors are reported; a 4xx is the client's problem and would drown the signal.
 */

export interface ErrorContext {
  method?: string;
  /** Request path WITHOUT the query string; ids are normalised by `normalizePath`. */
  path?: string;
  status?: number;
  requestId?: string;
  source?: 'http' | 'process';
}

export interface ErrorEvent {
  name: string;
  message: string;
  stack: string;
  fingerprint: string;
  context: ErrorContext;
  timestamp: string;
  service: string;
  environment: string;
  /** Occurrences of this fingerprint swallowed by the rate limit since the last send. */
  suppressedSince: number;
}

export interface ErrorSink {
  readonly name: string;
  report(event: ErrorEvent, original: unknown): Promise<void> | void;
}

const MAX_MESSAGE = 500;
const MAX_STACK_LINES = 12;
const MAX_STACK_CHARS = 3_000;

/**
 * Scrub free text that came out of an exception: emails/phones/cards (the shared PII scrubber),
 * provider and bearer keys, JWTs, and anything that looks like a credential in a URL or key=value.
 * An error message is whatever some library decided to interpolate — a query string with a session
 * token, a customer's email in a validation message — so nothing is assumed safe.
 */
export function scrubErrorText(raw: string): string {
  let out = scrubPii(redactSecrets(raw)).text;
  out = out.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g, '[JWT]');
  // URL query strings carry session tokens and ids; the path stays, the query goes.
  out = out.replace(/(https?:\/\/[^\s?#"')]+)\?[^\s"')]*/g, '$1?[redacted]');
  out = out.replace(
    /\b(session[_-]?token|access[_-]?token|refresh[_-]?token|token|password|passwd|secret|api[_-]?key|authorization)(["']?\s*[:=]\s*["']?)[^\s"'&,;)}\]]+/gi,
    '$1$2[redacted]',
  );
  return out;
}

/** Truncate a stack to its first frames — enough to locate the fault, not enough to be a data dump. */
export function truncateStack(stack: string): string {
  const lines = scrubErrorText(stack).split('\n').slice(0, MAX_STACK_LINES).join('\n');
  return lines.length > MAX_STACK_CHARS ? `${lines.slice(0, MAX_STACK_CHARS)}…` : lines;
}

/** `/api/v1/orders/48213/items/9f1c…` → `/api/v1/orders/:id/items/:id`. */
export function normalizePath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return path
    .split('?')[0]
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) || /^[0-9a-f]{8,}(-[0-9a-f]{4,})*$/i.test(seg) || seg.length > 40 ? ':id' : seg))
    .join('/')
    .slice(0, 200);
}

/** Stable identity of "the same error": class, normalised message, and the top frame. */
export function fingerprintOf(name: string, message: string, stack: string): string {
  const top = stack.split('\n').find((l) => /^\s+at /.test(l)) ?? '';
  const frame = top.replace(/:\d+:\d+\)?$/, '').trim();
  const msg = message.replace(/\d+/g, '#').replace(/[0-9a-f]{8,}/gi, '#').slice(0, 120);
  return createHash('sha1').update(`${name}|${msg}|${frame}`).digest('hex').slice(0, 16);
}

/** Build the scrubbed, bounded event for one error. Pure — the reporter only decides whether to send it. */
export function buildErrorEvent(
  err: unknown,
  ctx: ErrorContext,
  meta: { service: string; environment: string; now?: Date },
): ErrorEvent {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'non-Error thrown');
  const message = scrubErrorText(e.message ?? '').slice(0, MAX_MESSAGE);
  return {
    name: e.name || 'Error',
    message,
    stack: truncateStack(e.stack ?? ''),
    fingerprint: fingerprintOf(e.name, e.message ?? '', e.stack ?? ''),
    context: {
      method: ctx.method,
      path: normalizePath(ctx.path),
      status: ctx.status,
      requestId: ctx.requestId?.slice(0, 36),
      source: ctx.source ?? 'http',
    },
    timestamp: (meta.now ?? new Date()).toISOString(),
    service: meta.service,
    environment: meta.environment,
    suppressedSince: 0,
  };
}

/** Generic webhook sink: one JSON POST per event, 5 s deadline. */
export class WebhookErrorSink implements ErrorSink {
  readonly name = 'webhook';
  private readonly logger = new Logger('ErrorWebhook');

  constructor(private readonly url: string) {}

  async report(event: ErrorEvent): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json' },
        // `text` doubles as the Slack/Teams/Discord readable line.
        body: JSON.stringify({
          text: `[${event.environment}] ${event.name}: ${event.message}${event.context.path ? ` (${event.context.method ?? ''} ${event.context.path})` : ''}`,
          ...event,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      // The URL may embed a secret; never log it.
      this.logger.warn(`error webhook delivery failed: ${(e as Error).message}`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** The slice of `@sentry/node` this adapter touches. */
export interface SentryLike {
  init(options: Record<string, unknown>): void;
  captureException(error: unknown, hint?: Record<string, unknown>): unknown;
}

/** Resolve `@sentry/node` if — and only if — it is installed. Injectable for tests. */
export function loadSentry(
  load: (name: string) => unknown = (name) => {
    // A variable specifier keeps the compiler and any bundler from treating this as a hard dependency.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(name);
  },
): SentryLike | null {
  try {
    const mod = load('@sentry/node') as Partial<SentryLike> | null;
    return mod && typeof mod.init === 'function' && typeof mod.captureException === 'function'
      ? (mod as SentryLike)
      : null;
  } catch {
    return null;
  }
}

/** Sentry sink. The error is handed over raw for grouping, but every string Sentry stores goes through `beforeSend`. */
export class SentryErrorSink implements ErrorSink {
  readonly name = 'sentry';

  constructor(private readonly sentry: SentryLike) {}

  /** Initialise the SDK with privacy-first options; returns the sink. */
  static init(sentry: SentryLike, dsn: string, environment: string, release?: string): SentryErrorSink {
    sentry.init({
      dsn,
      environment,
      release,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: (event: Record<string, any>) => {
        for (const v of event.exception?.values ?? []) {
          if (typeof v.value === 'string') v.value = scrubErrorText(v.value).slice(0, MAX_MESSAGE);
        }
        if (typeof event.message === 'string') event.message = scrubErrorText(event.message);
        // Request bodies, cookies and query strings never leave.
        if (event.request) {
          delete event.request.data;
          delete event.request.cookies;
          delete event.request.query_string;
          delete event.request.headers;
        }
        delete event.user;
        return event;
      },
    });
    return new SentryErrorSink(sentry);
  }

  report(event: ErrorEvent, original: unknown): void {
    this.sentry.captureException(original instanceof Error ? original : new Error(event.message), {
      fingerprint: [event.fingerprint],
      tags: { source: event.context.source ?? 'http', status: String(event.context.status ?? '') },
      extra: { method: event.context.method, path: event.context.path, requestId: event.context.requestId },
    });
  }
}

@Injectable()
export class ErrorReporterService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ErrorReporterService.name);
  private sinks: ErrorSink[] = [];
  /** Global send timestamps inside the last minute — the token bucket. */
  private readonly sentAt: number[] = [];
  /** fingerprint → { last send time, occurrences swallowed since } */
  private readonly seen = new Map<string, { at: number; suppressed: number }>();
  private monitor: ((err: Error) => void) | null = null;

  constructor(
    private readonly config: ConfigService,
    /** Test seam: replacement sinks, the Sentry loader and the clock. Never provided by DI. */
    @Optional() private readonly overrides: { sinks?: ErrorSink[]; loadSentry?: typeof loadSentry; now?: () => number } = {},
  ) {}

  onModuleInit(): void {
    this.sinks = this.overrides.sinks ?? this.buildSinks();
    // Observes a crash without changing it: `uncaughtExceptionMonitor` fires before the normal
    // handling and does NOT suppress it (a plain 'uncaughtException' listener would turn a crash into
    // a zombie process). Delivery of the very last event is best effort — the process is dying.
    this.monitor = (err: Error) => this.report(err, { source: 'process' });
    process.on('uncaughtExceptionMonitor', this.monitor);
  }

  onModuleDestroy(): void {
    if (this.monitor) process.removeListener('uncaughtExceptionMonitor', this.monitor);
  }

  private buildSinks(): ErrorSink[] {
    const sinks: ErrorSink[] = [];
    const url = (this.config.get<string>('ERROR_WEBHOOK_URL') ?? '').trim();
    if (url) sinks.push(new WebhookErrorSink(url));
    const dsn = (this.config.get<string>('SENTRY_DSN') ?? '').trim();
    if (dsn) {
      const sentry = (this.overrides.loadSentry ?? loadSentry)();
      if (sentry) {
        sinks.push(
          SentryErrorSink.init(sentry, dsn, process.env.NODE_ENV || 'development', process.env.APP_RELEASE || undefined),
        );
        this.logger.log('Sentry error tracking active (@sentry/node adapter)');
      } else {
        this.logger.warn('SENTRY_DSN is set but @sentry/node is not installed — Sentry error tracking is inactive');
      }
    }
    if (sinks.length) this.logger.log(`Error reporting sinks: ${sinks.map((s) => s.name).join(', ')}`);
    return sinks;
  }

  /** Is anything listening? Lets the exception filter skip the work entirely when not. */
  active(): boolean {
    return this.sinks.length > 0;
  }

  /**
   * Report one error. Rate-limited twice: the same fingerprint at most once per
   * `ERROR_REPORT_DEDUPE_SEC` (default 60; the swallowed count rides on the next event), and at most
   * `ERROR_REPORT_MAX_PER_MIN` (default 20) events overall — an outage that throws on every request
   * must not become a second outage at the receiver.
   */
  report(err: unknown, ctx: ErrorContext = {}): void {
    try {
      if (!this.sinks.length) return;
      const now = this.overrides.now?.() ?? Date.now();
      const event = buildErrorEvent(err, ctx, {
        service: 'sharptalk-api',
        environment: process.env.NODE_ENV || 'development',
        now: new Date(now),
      });

      const dedupeMs = Math.max(0, envNumber('ERROR_REPORT_DEDUPE_SEC', 60)) * 1000;
      const prev = this.seen.get(event.fingerprint);
      if (prev && now - prev.at < dedupeMs) {
        prev.suppressed += 1;
        m.errorReports.inc({ sink: 'all', result: 'deduped' });
        return;
      }
      const perMin = Math.max(1, Math.round(envNumber('ERROR_REPORT_MAX_PER_MIN', 20)));
      while (this.sentAt.length && now - this.sentAt[0] >= 60_000) this.sentAt.shift();
      if (this.sentAt.length >= perMin) {
        if (prev) prev.suppressed += 1;
        m.errorReports.inc({ sink: 'all', result: 'rate_limited' });
        return;
      }

      this.sentAt.push(now);
      event.suppressedSince = prev?.suppressed ?? 0;
      this.seen.set(event.fingerprint, { at: now, suppressed: 0 });
      this.pruneSeen(now, dedupeMs);
      for (const sink of this.sinks) {
        // Fire-and-forget: never awaited, never allowed to reject.
        void Promise.resolve()
          .then(() => sink.report(event, err))
          .then(() => m.errorReports.inc({ sink: sink.name, result: 'sent' }))
          .catch(() => m.errorReports.inc({ sink: sink.name, result: 'failed' }));
      }
    } catch (e) {
      this.logger.warn(`error reporter failed: ${(e as Error).message}`);
    }
  }

  /** Bound the fingerprint table: an attacker-varied message must not grow it without limit. */
  private pruneSeen(now: number, dedupeMs: number): void {
    if (this.seen.size <= 500) return;
    for (const [k, v] of this.seen) if (now - v.at >= dedupeMs) this.seen.delete(k);
    while (this.seen.size > 500) this.seen.delete(this.seen.keys().next().value as string);
  }
}
