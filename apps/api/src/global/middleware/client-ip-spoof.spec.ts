import { evaluateWidgetAccess } from '@sharptalk/types';
import { XffThrottlerGuard } from '../guard/xff-throttler.guard';
import { getRequestContext, RequestContextMiddleware } from './request-context.middleware';

/**
 * FIX-261023: every reader of "the client IP" counts X-Forwarded-For from the
 * right. Behind host nginx + stack nginx the API sees `<browser claims…>,
 * <real client>, <host nginx>`; the browser controls only the left part.
 */
const REAL = '203.0.113.45';
const spoofed = (claim: string) => `${claim}, ${REAL}, 172.18.0.1`;

function ipSeenBy(xff: string | undefined, socket = '172.18.0.5'): string | null | undefined {
  let seen: string | null | undefined;
  new RequestContextMiddleware().use(
    { headers: xff ? { 'x-forwarded-for': xff } : {}, ip: socket } as never,
    {} as never,
    () => {
      seen = getRequestContext()?.ip;
    },
  );
  return seen;
}

describe('client IP behind our proxies (FIX-261023)', () => {
  it('request context ignores a made-up first hop', () => {
    expect(ipSeenBy(spoofed('6.6.6.6'))).toBe(REAL);
    // An honest browser sends no header: host nginx writes the real client.
    expect(ipSeenBy(`${REAL}, 172.18.0.1`)).toBe(REAL);
    expect(ipSeenBy(undefined, '::ffff:127.0.0.1')).toBe('127.0.0.1');
  });

  it('a spoofed allow-listed IP no longer opens a restricted widget', () => {
    const access = { enabled: true, ips: ['14.161.40.143'], urls: [] } as never;
    const ip = ipSeenBy(spoofed('14.161.40.143'));
    expect(evaluateWidgetAccess(access, { ip }).visible).toBe(false);
    expect(evaluateWidgetAccess(access, { ip: ipSeenBy('14.161.40.143, 172.18.0.1') }).visible).toBe(true);
  });

  it('rate-limit key does not change with the made-up header', async () => {
    const guard = Object.create(XffThrottlerGuard.prototype) as XffThrottlerGuard;
    const tracker = (xff: string) =>
      (guard as unknown as { getTracker(r: unknown): Promise<string> }).getTracker({
        headers: { 'x-forwarded-for': xff },
        ip: '172.18.0.5',
      });
    await expect(tracker(spoofed('1.1.1.1'))).resolves.toBe(REAL);
    await expect(tracker(spoofed('2.2.2.2'))).resolves.toBe(REAL);
  });
});
