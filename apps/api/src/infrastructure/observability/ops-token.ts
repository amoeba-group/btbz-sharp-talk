import { HttpStatus, Logger } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/**
 * Bearer-token gate for the operations surface (PLN-261012 SG-83): `/metrics`,
 * `/health/readiness` and the ops-alert hook. These endpoints are not user-facing and the JWT
 * guard has no principal for a Prometheus scraper or a backup cron job, so each is protected by a
 * static token from the environment (`METRICS_TOKEN`, `OPS_ALERT_TOKEN`).
 *
 * Two deliberate behaviours:
 *  - UNSET token → 404, as if the route did not exist. A deployment that never configured the
 *    surface must not advertise it, and an operator who forgot the variable finds out immediately.
 *  - WRONG or missing bearer → 401 plus a server-side warning (4xx are not logged by default, and a
 *    probe with the wrong token is worth seeing — never the supplied value).
 */
const logger = new Logger('OpsToken');

/** Shortest token accepted without a boot-time warning. */
export const MIN_OPS_TOKEN_LENGTH = 16;

/** Constant-time comparison that does not leak the length either (both sides hashed first). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** The bearer value of an Authorization header, or '' when absent or malformed. */
export function bearerOf(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(raw ?? '');
  return match?.[1] ?? '';
}

/**
 * Throws unless the request carries the bearer configured in `envName`.
 * `env` is injectable for tests.
 */
export function assertOpsToken(
  headers: { authorization?: string | string[] },
  envName: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const expected = env[envName]?.trim();
  if (!expected) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
  const given = bearerOf(headers.authorization);
  if (!given || !safeEqual(given, expected)) {
    logger.warn(`${envName} endpoint rejected: ${given ? 'wrong' : 'missing'} bearer token`);
    throw new BusinessException(ERROR_CODE.OPS_TOKEN_INVALID, HttpStatus.UNAUTHORIZED);
  }
}

/** Names of configured ops tokens that are too short to be a real secret — for a boot warning. */
export function weakOpsTokens(env: NodeJS.ProcessEnv = process.env): string[] {
  return ['METRICS_TOKEN', 'OPS_ALERT_TOKEN'].filter((k) => {
    const v = env[k]?.trim();
    return !!v && v.length < MIN_OPS_TOKEN_LENGTH;
  });
}
