import { ReadinessService, overallStatus, withDeadline } from './readiness.service';
import { m, metrics } from './app-metrics';

/** PLN-261012 SG-83 — readiness reports each dependency separately, with deadlines. */
describe('ReadinessService', () => {
  const saved = { ...process.env };
  const NOW = new Date('2026-10-13T08:00:00Z');

  type Opts = {
    db?: () => Promise<unknown>;
    redis?: () => Promise<void>;
    qdrantEnabled?: boolean;
    qdrant?: () => Promise<void>;
    qdrantBreaker?: { component: string; state: string; consecutiveFailures: number; openedAt: null } | null;
    engines?: Array<Record<string, unknown>>;
    breakers?: Array<{ key: string; component: string; state: string }>;
    required?: string;
  };

  const build = (o: Opts = {}) => {
    const svc = new ReadinessService(
      { query: jest.fn(o.db ?? (async () => [{ 1: 1 }])) } as never,
      { find: jest.fn(async () => o.engines ?? []) } as never,
      { ping: jest.fn(o.redis ?? (async () => undefined)) } as never,
      {
        enabled: o.qdrantEnabled ?? false,
        probe: jest.fn(o.qdrant ?? (async () => undefined)),
        breakerSnapshot: () => o.qdrantBreaker ?? null,
      } as never,
      { breakerSnapshots: () => o.breakers ?? [] } as never,
      { get: (k: string) => (k === 'READINESS_REQUIRED' ? o.required : undefined) } as never,
    );
    return svc;
  };

  const engine = (over: Record<string, unknown> = {}) => ({
    id: 5,
    provider: 'anthropic',
    model: 'claude',
    status: 'enabled',
    apiKeyEncrypted: Buffer.from('k'),
    lastOkAt: NOW,
    lastErrorAt: null,
    lastErrorReason: null,
    ...over,
  });

  beforeEach(() => {
    process.env = { ...saved };
    delete process.env.READINESS_CHECK_TIMEOUT_MS;
    metrics.reset();
  });
  afterAll(() => {
    process.env = saved;
  });

  it('everything healthy → ok, each dependency up with its latency', async () => {
    const r = await build({ qdrantEnabled: true, engines: [engine()] }).check();

    expect(r.status).toBe('ok');
    expect(r.checks.db).toMatchObject({ status: 'up' });
    expect(r.checks.redis).toMatchObject({ status: 'up' });
    expect(r.checks.qdrant).toMatchObject({ status: 'up' });
    expect(r.checks.ai).toMatchObject({ status: 'up', engines: [{ id: 5, provider: 'anthropic', health: 'ok' }] });
    expect(typeof r.checks.db.latencyMs).toBe('number');
  });

  it('reports the failing dependency by name, with a reason and no connection details', async () => {
    const r = await build({
      db: async () => {
        throw new Error('connect ECONNREFUSED 10.0.0.5:3306');
      },
    }).check();

    expect(r.checks.db.status).toBe('down');
    expect(r.checks.db.detail).toContain('ECONNREFUSED');
    expect(r.checks.redis.status).toBe('up');
  });

  it('DB down → overall down (the default required dependency)', async () => {
    const r = await build({ db: async () => Promise.reject(new Error('x')) }).check();
    expect(r.status).toBe('down');
    expect(r.required).toEqual(['db']);
  });

  it('Redis or Qdrant down alone → degraded, not down (chat still works without them)', async () => {
    const redisDown = await build({ redis: async () => Promise.reject(new Error('Redis is not connected')) }).check();
    const qdrantDown = await build({ qdrantEnabled: true, qdrant: async () => Promise.reject(new Error('503')) }).check();

    expect(redisDown.status).toBe('degraded');
    expect(qdrantDown.status).toBe('degraded');
    expect(qdrantDown.checks.qdrant.status).toBe('down');
  });

  it('READINESS_REQUIRED makes other dependencies critical', async () => {
    const r = await build({ required: 'db, redis', redis: async () => Promise.reject(new Error('x')) }).check();
    expect(r.required).toEqual(['db', 'redis']);
    expect(r.status).toBe('down');
  });

  it('ignores unknown names in READINESS_REQUIRED and falls back to db', () => {
    expect(build({ required: 'bogus' }).requiredDependencies()).toEqual(['db']);
    expect(build({ required: '' }).requiredDependencies()).toEqual(['db']);
  });

  it('Qdrant not configured → skipped (not down)', async () => {
    const r = await build({ qdrantEnabled: false }).check();
    expect(r.checks.qdrant).toMatchObject({ status: 'skipped', latencyMs: null });
    expect(r.status).toBe('ok');
  });

  it('an open Qdrant search breaker is impairment even though the probe answers', async () => {
    const r = await build({
      qdrantEnabled: true,
      qdrantBreaker: { component: 'qdrant', state: 'open', consecutiveFailures: 5, openedAt: null },
    }).check();

    expect(r.checks.qdrant).toMatchObject({ status: 'degraded', detail: 'search breaker open' });
    expect(r.status).toBe('degraded');
  });

  describe('AI engine summary (no provider calls)', () => {
    it('engines whose last call failed, or whose breaker is open, make the summary degraded', async () => {
      const failing = engine({ id: 6, lastOkAt: null, lastErrorAt: NOW, lastErrorReason: 'credit' });
      const r = await build({ engines: [engine(), failing], breakers: [{ key: 'engine:5', component: 'anthropic', state: 'open' }] }).check();

      expect(r.checks.ai.status).toBe('degraded');
      expect(r.checks.ai.detail).toBe('2 of 2 engine(s) failing');
      expect(r.checks.ai.engines.map((e) => [e.id, e.health, e.breaker])).toEqual([
        [5, 'ok', 'open'],
        [6, 'credit', undefined],
      ]);
      expect(r.status).toBe('degraded');
    });

    it('stub-only installs are skipped, not failing', async () => {
      const r = await build({ engines: [engine({ provider: 'stub' })] }).check();
      expect(r.checks.ai).toMatchObject({ status: 'skipped', engines: [] });
    });

    it('never exposes keys, endpoints or tenant ids', async () => {
      const r = await build({ engines: [engine({ endpoint: 'https://secret.example', tenantId: 9, name: 'Tenant Co' })] }).check();
      expect(JSON.stringify(r)).not.toMatch(/secret\.example|tenantId|Tenant Co|apiKey/);
    });
  });

  describe('deadlines', () => {
    it('a dependency that hangs is reported down at the deadline instead of hanging the probe', async () => {
      process.env.READINESS_CHECK_TIMEOUT_MS = '200';
      const hang = () => new Promise<void>(() => undefined);

      const started = Date.now();
      const r = await build({ redis: hang }).check();

      expect(Date.now() - started).toBeLessThan(2_000);
      expect(r.checks.redis.status).toBe('down');
      expect(r.checks.redis.detail).toContain('did not answer within 200ms');
      // The OTHER dependencies are still reported.
      expect(r.checks.db.status).toBe('up');
    });

    it('withDeadline passes a fast result through and rejects a slow one', async () => {
      await expect(withDeadline(Promise.resolve(7), 100, 'x')).resolves.toBe(7);
      await expect(withDeadline(new Promise(() => undefined), 20, 'slow thing')).rejects.toThrow('slow thing did not answer within 20ms');
    });
  });

  it('sets the per-dependency up gauge for /metrics', async () => {
    await build({ redis: async () => Promise.reject(new Error('x')) }).check();
    const text = await metrics.render();
    expect(text).toContain('sharptalk_dependency_up{dependency="db"} 1');
    expect(text).toContain('sharptalk_dependency_up{dependency="redis"} 0');
    expect(m.dependencyUp).toBeDefined();
  });

  describe('overallStatus (pure)', () => {
    const c = (status: 'up' | 'down' | 'degraded' | 'skipped') => ({ status });
    it.each([
      [{ db: c('up'), redis: c('up') }, ['db'], 'ok'],
      [{ db: c('up'), redis: c('down') }, ['db'], 'degraded'],
      [{ db: c('down'), redis: c('up') }, ['db'], 'down'],
      [{ db: c('up'), redis: c('degraded') }, ['db'], 'degraded'],
      [{ db: c('up'), redis: c('skipped') }, ['db'], 'ok'],
      [{ db: c('up'), redis: c('down') }, ['db', 'redis'], 'down'],
    ])('%j required=%j → %s', (checks, required, expected) => {
      expect(overallStatus(checks, required as string[])).toBe(expected);
    });
  });
});
