import { Injectable, NestMiddleware } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

/**
 * Per-request context propagated via AsyncLocalStorage so deep call sites
 * (audit writes, schedulers triggered by a request) can attach the originating
 * request id + client IP without threading them through every signature.
 * Outside an HTTP request (boot schedulers, event-bus consumers) the store is
 * simply absent and accessors return undefined — callers must tolerate that.
 */
export interface RequestContext {
  requestId: string;
  ip: string | null;
  /**
   * The visitor's address as our own proxies recorded it (PLN-261023 S2) —
   * see `trustedClientIp`. Kept apart from `ip`, whose first-hop reading the
   * throttler and audit trail already depend on.
   */
  clientIp?: string | null;
}

/**
 * Proxies of ours that append to X-Forwarded-For in front of the API: the host
 * nginx (TLS) and the stack's nginx — staging and production alike.
 */
export const TRUSTED_PROXY_HOPS = 2;

/**
 * The client address from an X-Forwarded-For chain, counted from the RIGHT.
 * Each proxy appends the address it received from, so the entries our own
 * proxies wrote are the last `hops`; anything left of them came from the
 * client and can be made up (`X-Forwarded-For: 1.2.3.4` sent by the browser
 * would otherwise be "the IP"). A shorter chain (fewer proxies, e.g. a
 * single-nginx install) falls back to its leftmost entry; no header at all
 * (local dev) to the socket address.
 */
export function trustedClientIp(
  xff: string | string[] | undefined,
  socketIp: string | null | undefined,
  hops = TRUSTED_PROXY_HOPS,
): string | null {
  const chain = (Array.isArray(xff) ? xff.join(',') : (xff ?? ''))
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const picked = chain.length === 0 ? socketIp : chain[Math.max(0, chain.length - hops)];
  return picked ? picked.replace(/^::ffff:/, '').slice(0, 45) : null;
}

const als = new AsyncLocalStorage<RequestContext>();

/** Current request's context, or undefined outside an HTTP request scope. */
export function getRequestContext(): RequestContext | undefined {
  return als.getStore();
}

/** Run fn inside an explicit context (middleware internals + tests). */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/**
 * Seeds the AsyncLocalStorage context for every route (Stage 4, audit
 * traceability). requestId honors an incoming `x-request-id` (edge nginx /
 * upstream tracing) and falls back to a fresh UUID; the client IP is the first
 * X-Forwarded-For hop set by the edge proxy (same trust model as
 * XffThrottlerGuard), falling back to the socket address in dev.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const rawId = req.headers['x-request-id'];
    const headerId = Array.isArray(rawId) ? rawId[0] : rawId;
    // Column is VARCHAR(36) (UUID-sized) — clamp arbitrary client input.
    const requestId = (headerId?.trim() || randomUUID()).slice(0, 36);

    const xff = req.headers['x-forwarded-for'];
    const firstHop =
      typeof xff === 'string'
        ? xff.split(',')[0]?.trim()
        : Array.isArray(xff)
          ? String(xff[0]).split(',')[0]?.trim()
          : undefined;
    // ip column is VARCHAR(45) (IPv6 max) — clamp defensively as well.
    const ip = (firstHop || req.ip || null)?.slice(0, 45) ?? null;

    const clientIp = trustedClientIp(xff, req.ip);

    runWithRequestContext({ requestId, ip, clientIp }, () => next());
  }
}
