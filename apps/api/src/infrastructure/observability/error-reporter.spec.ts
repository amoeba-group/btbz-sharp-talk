import { HttpException, HttpStatus } from '@nestjs/common';
import { AllExceptionFilter } from '../../global/filter/all-exception.filter';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import {
  ErrorEvent,
  ErrorReporterService,
  ErrorSink,
  SentryErrorSink,
  buildErrorEvent,
  fingerprintOf,
  loadSentry,
  normalizePath,
  scrubErrorText,
  truncateStack,
} from './error-reporter';
import { m, metrics } from './app-metrics';

/**
 * PLN-261012 SG-83 — error tracking: PII-scrubbed, bounded, rate-limited, best-effort.
 * The Sentry adapter is tested against a stand-in with the documented `init`/`captureException`
 * surface — NOT against the real SDK or a real Sentry project.
 */
describe('scrubErrorText', () => {
  it('removes emails, phones, bearer/provider keys and JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123456ghiJKL';
    const out = scrubErrorText(
      `Validation failed for jane.doe@example.com phone 415-555-0100 header Bearer abcdef0123456789abcdef key sk-ant-api03-ABCDEFGH1234 jwt ${jwt}`,
    );

    expect(out).not.toContain('jane.doe@example.com');
    expect(out).not.toContain('415-555-0100');
    expect(out).not.toContain('abcdef0123456789abcdef');
    expect(out).not.toContain('sk-ant-api03');
    expect(out).not.toContain('eyJhbGci');
    expect(out).toContain('[JWT]');
  });

  it('drops URL query strings (session tokens ride there) but keeps the path', () => {
    const out = scrubErrorText('GET https://api.example.test/api/v1/chat/conversation?session_token=abc123&after_id=9 failed');
    expect(out).toContain('https://api.example.test/api/v1/chat/conversation?[redacted]');
    expect(out).not.toContain('abc123');
  });

  it('redacts key=value credentials wherever they appear', () => {
    const out = scrubErrorText('connect failed: password=hunter2 token: s3cr3t-value api_key="abcd1234" session_token=xyz');
    expect(out).not.toContain('hunter2');
    expect(out).not.toContain('s3cr3t-value');
    expect(out).not.toContain('abcd1234');
    expect(out).not.toContain('xyz');
  });

  it('leaves ordinary text alone', () => {
    expect(scrubErrorText('Cannot read properties of undefined (reading id)')).toBe('Cannot read properties of undefined (reading id)');
  });
});

describe('truncateStack / normalizePath / fingerprintOf', () => {
  it('keeps only the first frames and caps the size', () => {
    const stack = ['Error: boom', ...Array.from({ length: 80 }, (_, i) => `    at fn${i} (/app/src/file${i}.ts:${i}:1)`)].join('\n');
    const out = truncateStack(stack);
    expect(out.split('\n')).toHaveLength(12);
    expect(out.length).toBeLessThanOrEqual(3_001);
  });

  it('scrubs the stack too (a message with an email is on its first line)', () => {
    expect(truncateStack('Error: no customer jane@example.com\n    at x (/a.ts:1:1)')).not.toContain('jane@example.com');
  });

  it('replaces numeric and hex ids in paths and drops the query', () => {
    expect(normalizePath('/api/v1/orders/48213/items/9f1c2b7a-1111-2222-3333-444455556666?session_token=abc')).toBe(
      '/api/v1/orders/:id/items/:id',
    );
    expect(normalizePath('/api/v1/chat/message')).toBe('/api/v1/chat/message');
    expect(normalizePath(undefined)).toBeUndefined();
  });

  it('gives the same fingerprint to the same fault with different ids/numbers, a different one to a different fault', () => {
    const stack = 'Error: x\n    at Service.run (/app/svc.ts:10:5)';
    const a = fingerprintOf('TypeError', 'order 123 not found', stack);
    const b = fingerprintOf('TypeError', 'order 456 not found', stack);
    const c = fingerprintOf('TypeError', 'cannot read id', stack);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('buildErrorEvent', () => {
  it('carries a scrubbed message, bounded stack and a normalised path — and no query string or body', () => {
    const err = new Error('boom for jane@example.com');
    const ev = buildErrorEvent(
      err,
      { method: 'POST', path: '/api/v1/chat/message?session_token=SECRET', status: 500, requestId: 'req-1' },
      { service: 'sharptalk-api', environment: 'test', now: new Date('2026-10-13T00:00:00Z') },
    );

    expect(ev.message).toBe('boom for [EMAIL]');
    expect(JSON.stringify(ev)).not.toContain('SECRET');
    expect(ev.context).toEqual({ method: 'POST', path: '/api/v1/chat/message', status: 500, requestId: 'req-1', source: 'http' });
    expect(ev.timestamp).toBe('2026-10-13T00:00:00.000Z');
  });

  it('survives a non-Error throw', () => {
    expect(buildErrorEvent('just a string', {}, { service: 's', environment: 'e' }).message).toBe('just a string');
    expect(buildErrorEvent({ weird: true }, {}, { service: 's', environment: 'e' }).message).toBe('non-Error thrown');
  });
});

describe('ErrorReporterService', () => {
  const saved = { ...process.env };
  let sent: ErrorEvent[];
  let t: number;
  const sink: ErrorSink = { name: 'test', report: (e) => void sent.push(e) };
  const flush = () => new Promise((r) => setImmediate(r));

  const build = (extra: Record<string, string> = {}) => {
    Object.assign(process.env, extra);
    const svc = new ErrorReporterService({ get: () => undefined } as never, { sinks: [sink], now: () => t });
    svc.onModuleInit();
    return svc;
  };
  const boom = (msg = 'boom') => {
    const e = new Error(msg);
    e.stack = `Error: ${msg}\n    at Thing.run (/app/thing.ts:1:1)`;
    return e;
  };

  beforeEach(() => {
    process.env = { ...saved };
    delete process.env.ERROR_REPORT_DEDUPE_SEC;
    delete process.env.ERROR_REPORT_MAX_PER_MIN;
    sent = [];
    t = 1_000_000;
    metrics.reset();
  });
  afterAll(() => {
    process.env = saved;
  });

  it('delivers a scrubbed event to every sink', async () => {
    const svc = build();

    svc.report(boom('failed for jane@example.com'), { method: 'GET', path: '/api/v1/orders/123', status: 500 });
    await flush();

    expect(sent).toHaveLength(1);
    expect(sent[0].message).toBe('failed for [EMAIL]');
    expect(sent[0].context.path).toBe('/api/v1/orders/:id');
    expect(m.errorReports.get({ sink: 'test', result: 'sent' })).toBe(1);
    svc.onModuleDestroy();
  });

  it('rate-limits the same fingerprint: one per window, with the swallowed count on the next', async () => {
    const svc = build();

    svc.report(boom(), {});
    svc.report(boom(), {});
    svc.report(boom(), {});
    await flush();
    expect(sent).toHaveLength(1);
    expect(m.errorReports.get({ sink: 'all', result: 'deduped' })).toBe(2);

    t += 61_000;
    svc.report(boom(), {});
    await flush();
    expect(sent).toHaveLength(2);
    expect(sent[1].suppressedSince).toBe(2);
    svc.onModuleDestroy();
  });

  it('caps the total per minute across different errors (an outage must not become the receiver\'s outage)', async () => {
    const svc = build({ ERROR_REPORT_MAX_PER_MIN: '3' });

    for (let i = 0; i < 10; i++) svc.report(boom(`distinct failure #${'x'.repeat(i + 1)}`), {});
    await flush();

    expect(sent).toHaveLength(3);
    expect(m.errorReports.get({ sink: 'all', result: 'rate_limited' })).toBe(7);

    t += 60_001; // the bucket refills
    svc.report(boom('a brand new failure'), {});
    await flush();
    expect(sent).toHaveLength(4);
    svc.onModuleDestroy();
  });

  it('is inert with no sink configured (no work, no throw)', () => {
    const svc = new ErrorReporterService({ get: () => undefined } as never, { sinks: [] });
    svc.onModuleInit();
    expect(svc.active()).toBe(false);
    expect(() => svc.report(boom(), {})).not.toThrow();
    svc.onModuleDestroy();
  });

  it('a sink that throws or rejects is counted, never propagated', async () => {
    const bad: ErrorSink = { name: 'bad', report: () => Promise.reject(new Error('receiver down')) };
    const svc = new ErrorReporterService({ get: () => undefined } as never, { sinks: [bad, { name: 'throws', report: () => { throw new Error('sync'); } }], now: () => t });
    svc.onModuleInit();

    expect(() => svc.report(boom(), {})).not.toThrow();
    await flush();

    expect(m.errorReports.get({ sink: 'bad', result: 'failed' })).toBe(1);
    expect(m.errorReports.get({ sink: 'throws', result: 'failed' })).toBe(1);
    svc.onModuleDestroy();
  });

  it('observes a process crash without suppressing it (uncaughtExceptionMonitor, not uncaughtException)', () => {
    const before = process.listenerCount('uncaughtException');
    const monitors = process.listenerCount('uncaughtExceptionMonitor');
    const svc = build();

    expect(process.listenerCount('uncaughtException')).toBe(before); // default crash behaviour untouched
    expect(process.listenerCount('uncaughtExceptionMonitor')).toBe(monitors + 1);
    svc.onModuleDestroy();
    expect(process.listenerCount('uncaughtExceptionMonitor')).toBe(monitors);
  });

  it('builds the webhook sink from ERROR_WEBHOOK_URL and posts the scrubbed event', async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const svc = new ErrorReporterService({ get: (k: string) => (k === 'ERROR_WEBHOOK_URL' ? 'https://errors.example.test/hook' : undefined) } as never, { now: () => t });
    svc.onModuleInit();

    svc.report(boom('db password=hunter2 refused'), { method: 'POST', path: '/api/v1/x', status: 500 });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body.message).not.toContain('hunter2');
    expect(body.text).toContain('Error');
    expect(body.environment).toBeDefined();
    svc.onModuleDestroy();
  });
});

describe('Sentry adapter (stand-in, not the real SDK)', () => {
  const fakeSentry = () => {
    const calls: Array<{ fn: string; args: unknown[] }> = [];
    return {
      calls,
      sdk: {
        init: (...args: unknown[]) => void calls.push({ fn: 'init', args }),
        captureException: (...args: unknown[]) => void calls.push({ fn: 'captureException', args }),
      },
    };
  };

  it('loadSentry returns null when the package is not installed (the default in this repo)', () => {
    expect(loadSentry(() => {
      throw new Error("Cannot find module '@sentry/node'");
    })).toBeNull();
    expect(loadSentry(() => ({}))).toBeNull(); // present but not the expected surface
    // And the REAL loader, in this repo, finds nothing.
    expect(loadSentry()).toBeNull();
  });

  it('activates only with SENTRY_DSN set AND the package resolvable', () => {
    const f = fakeSentry();
    const cfg = (dsn?: string) => ({ get: (k: string) => (k === 'SENTRY_DSN' ? dsn : undefined) }) as never;

    const off1 = new ErrorReporterService(cfg(undefined), { loadSentry: () => f.sdk });
    off1.onModuleInit();
    expect(f.calls).toHaveLength(0);
    off1.onModuleDestroy();

    const off2 = new ErrorReporterService(cfg('https://k@sentry.example.test/1'), { loadSentry: () => null });
    off2.onModuleInit();
    expect(off2.active()).toBe(false);
    off2.onModuleDestroy();

    const on = new ErrorReporterService(cfg('https://k@sentry.example.test/1'), { loadSentry: () => f.sdk });
    on.onModuleInit();
    expect(on.active()).toBe(true);
    expect(f.calls[0].fn).toBe('init');
    expect(f.calls[0].args[0]).toMatchObject({ dsn: 'https://k@sentry.example.test/1', sendDefaultPii: false, tracesSampleRate: 0 });
    on.onModuleDestroy();
  });

  it('beforeSend scrubs exception text and strips request bodies, cookies and users', () => {
    const f = fakeSentry();
    SentryErrorSink.init(f.sdk, 'https://k@sentry.example.test/1', 'test');
    const { beforeSend } = f.calls[0].args[0] as { beforeSend: (e: Record<string, any>) => Record<string, any> };

    const out = beforeSend({
      exception: { values: [{ value: 'fail for jane@example.com with Bearer abcdef0123456789abcdef' }] },
      message: 'password=hunter2',
      request: { data: { card: '4111111111111111' }, cookies: { s: 1 }, headers: { authorization: 'x' }, query_string: 'session_token=SECRET', url: 'https://x.test/a' },
      user: { email: 'jane@example.com' },
    });

    expect(JSON.stringify(out)).not.toMatch(/jane@example|abcdef0123456789abcdef|hunter2|4111111111111111|SECRET/);
    expect(out.user).toBeUndefined();
    expect(out.request.url).toBe('https://x.test/a');
  });

  it('forwards an error with a stable fingerprint and path-only context', () => {
    const f = fakeSentry();
    const sink = SentryErrorSink.init(f.sdk, 'https://k@sentry.example.test/1', 'test');
    const err = new Error('kaboom');
    const ev = buildErrorEvent(err, { method: 'GET', path: '/api/v1/a/12345', status: 500 }, { service: 's', environment: 'test' });

    sink.report(ev, err);

    const call = f.calls.find((c) => c.fn === 'captureException')!;
    expect(call.args[0]).toBe(err);
    expect(call.args[1]).toMatchObject({ fingerprint: [ev.fingerprint], tags: { source: 'http', status: '500' }, extra: { path: '/api/v1/a/:id' } });
  });
});

describe('AllExceptionFilter → reporter hook', () => {
  const host = (path = '/api/v1/orders/77?session_token=S') => {
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) };
    return {
      res,
      json,
      host: { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ method: 'GET', path: path.split('?')[0] }) }) } as never,
    };
  };

  it('reports an UNHANDLED error (500) with method, normalised-able path and status', () => {
    const report = jest.fn();
    const h = host();

    new AllExceptionFilter({ report }).catch(new TypeError('x is undefined'), h.host);

    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][1]).toMatchObject({ method: 'GET', path: '/api/v1/orders/77', status: 500, source: 'http' });
    expect(h.res.status).toHaveBeenCalledWith(500); // the response is unchanged
  });

  it('reports a HANDLED 5xx (BusinessException/HttpException with a 5xx status) — previously invisible', () => {
    const report = jest.fn();

    new AllExceptionFilter({ report }).catch(new BusinessException(ERROR_CODE.EXTERNAL_SERVICE_ERROR, HttpStatus.BAD_GATEWAY), host().host);
    new AllExceptionFilter({ report }).catch(new HttpException('down', HttpStatus.SERVICE_UNAVAILABLE), host().host);

    expect(report).toHaveBeenCalledTimes(2);
    expect(report.mock.calls.map((c) => c[1].status)).toEqual([502, 503]);
  });

  it('does NOT report 4xx — those are the caller\'s mistakes and would bury the signal', () => {
    const report = jest.fn();
    const f = new AllExceptionFilter({ report });

    f.catch(new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND), host().host);
    f.catch(new BusinessException(ERROR_CODE.UNAUTHORIZED, HttpStatus.UNAUTHORIZED), host().host);
    f.catch(new HttpException('bad', HttpStatus.BAD_REQUEST), host().host);

    expect(report).not.toHaveBeenCalled();
  });

  it('a reporter that throws cannot change or break the response', () => {
    const h = host();
    const filter = new AllExceptionFilter({ report: () => { throw new Error('reporter bug'); } });

    expect(() => filter.catch(new Error('real failure'), h.host)).not.toThrow();
    expect(h.res.status).toHaveBeenCalledWith(500);
    expect(h.json.mock.calls[0][0]).toMatchObject({ success: false, error: { code: 'E9001' } });
  });

  it('works with no reporter at all (the pre-existing construction)', () => {
    const h = host();
    expect(() => new AllExceptionFilter().catch(new Error('x'), h.host)).not.toThrow();
  });
});
