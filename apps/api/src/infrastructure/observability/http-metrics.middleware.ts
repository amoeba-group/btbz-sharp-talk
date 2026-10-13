import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { m } from './app-metrics';

/**
 * HTTP request count and latency (PLN-261012 SG-83).
 *
 * Labelled by ROUTE GROUP — the first path segment after the API prefix of the route PATTERN the
 * request matched (`chat`, `agent`, `admin`…), never by the raw URL. A URL carries ids, tokens and
 * query strings: as a label it would be both a cardinality bomb and a privacy leak. A request that
 * matched no route is `unmatched`, so a scanner probing random paths cannot mint new series.
 */
const PREFIX = () => `/${(process.env.API_PREFIX || 'api/v1').replace(/^\/+|\/+$/g, '')}`;

/** The route group of a matched route pattern (`/api/v1/chat/message` → `chat`), or `unmatched`. */
export function routeGroupOf(routePath: string | undefined | null, prefix = PREFIX()): string {
  if (!routePath) return 'unmatched';
  let p = routePath;
  if (p === prefix || p.startsWith(`${prefix}/`)) p = p.slice(prefix.length);
  const first = p.split('/').filter(Boolean)[0];
  if (!first || first.startsWith(':')) return 'root';
  // Route patterns are defined in code, so this alphabet is already safe; the cut is a backstop.
  return first.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32).toLowerCase();
}

export function statusClassOf(status: number): string {
  return `${Math.floor(status / 100)}xx`;
}

/** The scrape endpoint itself is not application traffic. */
const SKIPPED_GROUPS = new Set(['metrics']);

@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      try {
        // `req.route` is only set once the router matched — it is read at finish, not now.
        const group = routeGroupOf((req.route as { path?: string } | undefined)?.path ?? null);
        if (SKIPPED_GROUPS.has(group)) return;
        m.httpRequests.inc({
          route_group: group,
          method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(req.method) ? req.method : 'OTHER',
          status_class: statusClassOf(res.statusCode),
        });
        m.httpDuration.observe({ route_group: group }, Number(process.hrtime.bigint() - start) / 1e9);
      } catch {
        /* metrics must never affect a response */
      }
    });
    next();
  }
}
