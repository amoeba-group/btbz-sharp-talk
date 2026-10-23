import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { trustedClientIp } from '../middleware/request-context.middleware';

/**
 * App-wide flood limiter (SEC-H3, secondary to the per-account login limiter).
 * Keys the rate window by the real client IP — X-Forwarded-For read from the
 * right by `trustedClientIp` — instead of the socket address (which, behind the
 * reverse proxy, is the same for every client). The first hop is the browser's
 * own claim: keyed on it, a fresh made-up header per request was a fresh window
 * (FIX-261023). Falls back to the socket IP in dev.
 *
 * The default limit is deliberately generous so it does not affect legitimate
 * shopper traffic (multiple shoppers can share one CGNAT/office IP); the highest-
 * frequency widget poll routes are additionally @SkipThrottle'd. General DoS
 * protection still belongs at the edge/WAF where per-client tuning is possible.
 */
@Injectable()
export class XffThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return trustedClientIp(req.headers?.['x-forwarded-for'], req.ip) ?? 'unknown';
  }
}
