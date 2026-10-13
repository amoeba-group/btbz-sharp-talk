import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AllExceptionFilter } from '../../global/filter/all-exception.filter';
import { TransformInterceptor } from '../../global/interceptor/transform.interceptor';
import { CacheControlInterceptor } from '../../global/interceptor/cache-control.interceptor';
import { ObservabilityController } from './observability.controller';
import { OpsAlertService } from './ops-alert.service';
import { ReadinessService } from './readiness.service';
import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { m, metrics } from './app-metrics';
import { assertOpsToken, bearerOf, safeEqual, weakOpsTokens } from './ops-token';

/**
 * PLN-261012 SG-83 — the operations surface over REAL HTTP: a Nest app with the production filter,
 * validation pipe and global-prefix exclusion, driven with fetch. Auth contract: token unset → 404
 * (the route does not exist), wrong/missing bearer → 401 + E5120, right bearer → the payload.
 */
describe('ObservabilityController (HTTP)', () => {
  let app: INestApplication;
  let base: string;
  const alerts = { alert: jest.fn(), resolve: jest.fn(), configured: jest.fn() };
  const readiness = { check: jest.fn() };
  const saved = { ...process.env };
  const TOKEN = 'metrics-token-0123456789abcdef';
  const OPS = 'ops-alert-token-0123456789abcdef';

  const readyReport = (status: 'ok' | 'degraded' | 'down') => ({
    status,
    required: ['db'],
    checks: {
      db: { status: status === 'down' ? 'down' : 'up', latencyMs: 3 },
      redis: { status: 'up', latencyMs: 1 },
      qdrant: { status: 'skipped', latencyMs: null },
      ai: { status: 'up', latencyMs: 2, engines: [] },
    },
    uptimeSec: 10,
    timestamp: '2026-10-13T00:00:00.000Z',
  });

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ObservabilityController],
      providers: [
        { provide: OpsAlertService, useValue: alerts },
        { provide: ReadinessService, useValue: readiness },
      ],
    }).compile();
    app = mod.createNestApplication();
    // Mirrors main.ts: prefix with `metrics` excluded, the production filter and pipe.
    app.setGlobalPrefix('api/v1', { exclude: ['metrics'] });
    app.useGlobalFilters(new AllExceptionFilter());
    app.useGlobalInterceptors(new CacheControlInterceptor(), new TransformInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });
  afterAll(async () => {
    process.env = saved;
    await app.close();
  });
  beforeEach(() => {
    process.env = { ...saved };
    delete process.env.METRICS_TOKEN;
    delete process.env.OPS_ALERT_TOKEN;
    metrics.reset();
    jest.clearAllMocks();
  });

  const auth = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

  describe('GET /metrics', () => {
    it('404s when METRICS_TOKEN is not configured — the surface does not exist', async () => {
      const res = await fetch(`${base}/metrics`);
      expect(res.status).toBe(404);
      // Even with a bearer: nothing to match against.
      expect((await fetch(`${base}/metrics`, auth('anything'))).status).toBe(404);
    });

    it('401s with E5120 on a missing or wrong bearer', async () => {
      process.env.METRICS_TOKEN = TOKEN;

      const missing = await fetch(`${base}/metrics`);
      const wrong = await fetch(`${base}/metrics`, auth('not-the-token-0123456789abcdef'));

      expect(missing.status).toBe(401);
      expect(wrong.status).toBe(401);
      expect((await wrong.json()).error.code).toBe('E5120');
    });

    it('does not accept the token in the query string (it would land in access logs)', async () => {
      process.env.METRICS_TOKEN = TOKEN;
      expect((await fetch(`${base}/metrics?token=${TOKEN}`)).status).toBe(401);
    });

    it('serves Prometheus text exposition 0.0.4 with the right content type', async () => {
      process.env.METRICS_TOKEN = TOKEN;
      m.chatTurns.inc({ outcome: 'answered' }, 3);
      m.llmCalls.inc({ feature: 'chat_answer', provider: 'anthropic', status: 'ok' });
      m.llmDuration.observe({ provider: 'anthropic' }, 1.2);

      const res = await fetch(`${base}/metrics`, auth(TOKEN));
      const body = await res.text();

      expect(res.status).toBe(200);
      const contentType = res.headers.get('content-type') ?? '';
      expect(contentType).toMatch(/^text\/plain;/);
      expect(contentType).toContain('version=0.0.4');
      expect(contentType).toContain('charset=utf-8');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(body).toContain('# TYPE sharptalk_chat_turns_total counter');
      expect(body).toContain('sharptalk_chat_turns_total{outcome="answered"} 3');
      expect(body).toContain('sharptalk_llm_calls_total{feature="chat_answer",provider="anthropic",status="ok"} 1');
      expect(body).toContain('sharptalk_llm_call_duration_seconds_bucket{provider="anthropic",le="2"} 1');
      expect(body).toContain('sharptalk_llm_call_duration_seconds_bucket{provider="anthropic",le="+Inf"} 1');
      // Every non-comment line is `name{labels} number`.
      for (const line of body.split('\n').filter((l) => l && !l.startsWith('#'))) {
        expect(line).toMatch(/^[a-zA-Z_:][a-zA-Z0-9_:]*(\{[^}]*\})? (-?\d+(\.\d+)?(e[+-]?\d+)?|\+Inf|-Inf|NaN)$/);
      }
    });

    it('is also reachable under the API prefix for proxies that only forward /api/', async () => {
      process.env.METRICS_TOKEN = TOKEN;
      expect((await fetch(`${base}/api/v1/ops/metrics`, auth(TOKEN))).status).toBe(200);
      expect((await fetch(`${base}/api/v1/metrics`, auth(TOKEN))).status).toBe(404);
    });

    it('exposes no tenant id, customer text or free-form label', async () => {
      process.env.METRICS_TOKEN = TOKEN;
      m.handoffs.inc({ reason: 'low_confidence' });
      const body = await (await fetch(`${base}/metrics`, auth(TOKEN))).text();
      expect(body).not.toMatch(/tenant|session|email|@/i);
    });
  });

  describe('GET /api/v1/health/readiness', () => {
    it('is protected like /metrics', async () => {
      expect((await fetch(`${base}/api/v1/health/readiness`)).status).toBe(404);
      process.env.METRICS_TOKEN = TOKEN;
      expect((await fetch(`${base}/api/v1/health/readiness`)).status).toBe(401);
      expect(readiness.check).not.toHaveBeenCalled();
    });

    it('200 with the per-dependency report while required dependencies are up', async () => {
      process.env.METRICS_TOKEN = TOKEN;
      readiness.check.mockResolvedValue(readyReport('degraded'));

      const res = await fetch(`${base}/api/v1/health/readiness`, auth(TOKEN));
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe('degraded');
      expect(Object.keys(body.data.checks)).toEqual(['db', 'redis', 'qdrant', 'ai']);
    });

    it('503 + E5122 when a required dependency is down, still carrying the whole report', async () => {
      process.env.METRICS_TOKEN = TOKEN;
      readiness.check.mockResolvedValue(readyReport('down'));

      const res = await fetch(`${base}/api/v1/health/readiness`, auth(TOKEN));
      const body = await res.json();

      expect(res.status).toBe(503);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('E5122');
      expect(body.data.checks.db.status).toBe('down');
    });
  });

  describe('POST /api/v1/internal/ops-alert', () => {
    const post = (token: string | null, body: unknown) =>
      fetch(`${base}/api/v1/internal/ops-alert`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });

    it('404 when OPS_ALERT_TOKEN is unset; the metrics token does not open it', async () => {
      process.env.METRICS_TOKEN = TOKEN;
      expect((await post(TOKEN, { kind: 'backup_failed' })).status).toBe(404);
    });

    it('401 + E5120 on a wrong bearer, and the alert is not raised', async () => {
      process.env.OPS_ALERT_TOKEN = OPS;
      process.env.METRICS_TOKEN = TOKEN;

      const res = await post(TOKEN, { kind: 'backup_failed' }); // the READ token must not raise alerts

      expect(res.status).toBe(401);
      expect((await res.json()).error.code).toBe('E5120');
      expect(alerts.alert).not.toHaveBeenCalled();
    });

    it('raises a backup_failed alert with the fixed title and the supplied detail', async () => {
      process.env.OPS_ALERT_TOKEN = OPS;
      alerts.alert.mockResolvedValue({ outcome: 'sent', channels: ['email'] });

      const res = await post(OPS, { kind: 'backup_failed', detail: 'mysqldump exited 2', title: 'ignored for fixed kinds' });

      expect(res.status).toBe(201);
      expect((await res.json()).data).toEqual({ outcome: 'sent', channels: ['email'] });
      expect(alerts.alert).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'backup_failed', kind: 'backup_failed', severity: 'critical', title: 'Backup failed', detail: 'mysqldump exited 2' }),
      );
    });

    it('a deduped repeat is still a success for the caller', async () => {
      process.env.OPS_ALERT_TOKEN = OPS;
      alerts.alert.mockResolvedValue({ outcome: 'suppressed', channels: [] });
      expect((await post(OPS, { kind: 'backup_failed' })).status).toBe(201);
    });

    it('503 + E5123 when no channel took the alert, so `curl -f` in the script notices', async () => {
      process.env.OPS_ALERT_TOKEN = OPS;
      alerts.alert.mockResolvedValue({ outcome: 'unconfigured', channels: [] });

      const res = await post(OPS, { kind: 'backup_failed' });

      expect(res.status).toBe(503);
      expect((await res.json()).error.code).toBe('E5123');
    });

    it('validates the body: unknown kind and oversized detail are 400', async () => {
      process.env.OPS_ALERT_TOKEN = OPS;
      expect((await post(OPS, { kind: 'format_disk' })).status).toBe(400);
      expect((await post(OPS, { kind: 'backup_failed', detail: 'x'.repeat(2001) })).status).toBe(400);
      expect(alerts.alert).not.toHaveBeenCalled();
    });

    it('a custom alert keys on its title so different jobs do not dedupe each other', async () => {
      process.env.OPS_ALERT_TOKEN = OPS;
      alerts.alert.mockResolvedValue({ outcome: 'sent', channels: ['webhook'] });

      await post(OPS, { kind: 'custom', title: 'Nightly KB reindex failed', severity: 'warning' });

      expect(alerts.alert).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'custom:nightly_kb_reindex_failed', severity: 'warning', title: 'Nightly KB reindex failed' }),
      );
    });
  });
});

describe('ops token helpers', () => {
  it('bearerOf extracts only a well-formed Bearer value', () => {
    expect(bearerOf('Bearer abc.def')).toBe('abc.def');
    expect(bearerOf('bearer abc')).toBe('abc');
    expect(bearerOf('Basic abc')).toBe('');
    expect(bearerOf('Bearer')).toBe('');
    expect(bearerOf(undefined)).toBe('');
    expect(bearerOf(['Bearer first', 'Bearer second'])).toBe('first');
  });

  it('safeEqual compares by value, including different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });

  it('assertOpsToken: unset → 404, wrong → 401, right → returns', () => {
    expect(() => assertOpsToken({}, 'X_TOKEN', {})).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => assertOpsToken({ authorization: 'Bearer nope' }, 'X_TOKEN', { X_TOKEN: 'secret-secret-secret' })).toThrow(
      expect.objectContaining({ status: 401, errorCode: 'E5120' }),
    );
    expect(() => assertOpsToken({ authorization: 'Bearer secret-secret-secret' }, 'X_TOKEN', { X_TOKEN: 'secret-secret-secret' })).not.toThrow();
  });

  it('an empty/whitespace token counts as unset', () => {
    expect(() => assertOpsToken({ authorization: 'Bearer x' }, 'X_TOKEN', { X_TOKEN: '   ' })).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });

  it('weakOpsTokens flags configured tokens under 16 characters', () => {
    expect(weakOpsTokens({ METRICS_TOKEN: 'short', OPS_ALERT_TOKEN: 'a-sufficiently-long-token' })).toEqual(['METRICS_TOKEN']);
    expect(weakOpsTokens({})).toEqual([]);
  });
});

describe('HttpMetricsMiddleware (over HTTP)', () => {
  it('counts requests by route GROUP and status class — never by raw URL', async () => {
    metrics.reset();
    const mod = await Test.createTestingModule({
      controllers: [ObservabilityController],
      providers: [
        { provide: OpsAlertService, useValue: {} },
        { provide: ReadinessService, useValue: { check: jest.fn(async () => readyOk) } },
      ],
    }).compile();
    const readyOk = { status: 'ok', required: ['db'], checks: {}, uptimeSec: 1, timestamp: 't' };
    const app = mod.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['metrics'] });
    app.useGlobalFilters(new AllExceptionFilter());
    const mw = new HttpMetricsMiddleware();
    app.use((req: never, res: never, next: never) => mw.use(req, res, next));
    await app.listen(0, '127.0.0.1');
    const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
    const saved = process.env.METRICS_TOKEN;
    process.env.METRICS_TOKEN = 'metrics-token-0123456789abcdef';
    try {
      await fetch(`${url}/api/v1/health/readiness`, { headers: { authorization: 'Bearer metrics-token-0123456789abcdef' } });
      await fetch(`${url}/api/v1/health/readiness`); // 401
      await fetch(`${url}/api/v1/nothing/here/48213?session_token=SECRET`); // 404, unmatched
      await new Promise((r) => setTimeout(r, 50)); // 'finish' handlers run after the response is flushed

      expect(m.httpRequests.get({ route_group: 'health', method: 'GET', status_class: '2xx' })).toBe(1);
      expect(m.httpRequests.get({ route_group: 'health', method: 'GET', status_class: '4xx' })).toBe(1);
      expect(m.httpRequests.get({ route_group: 'unmatched', method: 'GET', status_class: '4xx' })).toBe(1);
      const text = await metrics.render();
      expect(text).not.toContain('48213');
      expect(text).not.toContain('SECRET');
      expect(text).toContain('sharptalk_http_request_duration_seconds_count{route_group="health"} 2');
    } finally {
      if (saved === undefined) delete process.env.METRICS_TOKEN;
      else process.env.METRICS_TOKEN = saved;
      await app.close();
    }
  });
});
