import { OpsWatchdogService } from './ops-watchdog.service';
import { m, metrics } from './app-metrics';

/**
 * PLN-261012 SG-83 — the watchdog turns counters, breaker states and readiness probes into alerts,
 * with rates measured over a window and a RESOLVED notice when the condition clears.
 */
describe('OpsWatchdogService', () => {
  const saved = { ...process.env };
  const T = 10_000_000;
  const MIN = 60_000;

  type Breaker = { key: string; component: string; state: 'closed' | 'open' | 'half_open'; consecutiveFailures: number; openedAt: number | null };
  const down = { status: 'down' as const, latencyMs: 5, detail: 'ECONNREFUSED' };
  const up = { status: 'up' as const, latencyMs: 1 };
  const report = (over: Record<string, unknown> = {}) => ({
    status: 'ok',
    required: ['db'],
    checks: { db: up, redis: up, qdrant: { status: 'skipped', latencyMs: null }, ai: { status: 'up', latencyMs: 1, engines: [] }, ...over },
    uptimeSec: 1,
    timestamp: 't',
  });

  const build = () => {
    const state = { breakers: [] as Breaker[], qdrant: null as Breaker | null, report: report() as unknown };
    const alerts = { alert: jest.fn(async () => ({ outcome: 'sent', channels: ['email'] })), resolve: jest.fn(async () => undefined) };
    const svc = new OpsWatchdogService(
      alerts as never,
      { check: jest.fn(async () => state.report) } as never,
      { breakerSnapshots: () => state.breakers } as never,
      { breakerSnapshot: () => (state.qdrant ? { component: 'qdrant', ...state.qdrant } : null) } as never,
    );
    return { svc, alerts, state };
  };
  const raised = (alerts: { alert: jest.Mock }) => alerts.alert.mock.calls.map(([a]) => a.key);
  const llm = (provider: string, status: string, n: number) => m.llmCalls.inc({ feature: 'chat_answer', provider, status }, n);

  beforeEach(() => {
    process.env = { ...saved };
    for (const k of ['OPS_LLM_WINDOW_SEC', 'OPS_LLM_FAILURE_RATE', 'OPS_LLM_MIN_CALLS', 'OPS_VECTOR_FAILURES', 'OPS_DEP_FAILURES', 'OPS_WATCHDOG_SKIP']) delete process.env[k];
    metrics.reset();
  });
  afterAll(() => {
    process.env = saved;
  });

  describe('circuit breakers', () => {
    it('an open breaker raises a critical alert; closing it sends the resolved notice', async () => {
      const { svc, alerts, state } = build();
      state.breakers = [{ key: 'engine:5', component: 'anthropic', state: 'open', consecutiveFailures: 5, openedAt: T }];

      await svc.tick(T);

      expect(alerts.alert).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'breaker:engine:5', kind: 'llm_breaker', severity: 'critical', title: 'Circuit breaker open: anthropic (engine:5)' }),
      );

      state.breakers[0].state = 'closed';
      await svc.tick(T + 30_000);
      expect(alerts.resolve).toHaveBeenCalledWith('breaker:engine:5', 'llm_breaker', expect.stringContaining('closed'));
    });

    it('a half-open breaker is still an active problem (the probe has not proven recovery)', async () => {
      const { svc, alerts, state } = build();
      state.breakers = [{ key: 'embed:voyage', component: 'embedding', state: 'half_open', consecutiveFailures: 5, openedAt: T }];

      await svc.tick(T);

      expect(alerts.alert).toHaveBeenCalledWith(expect.objectContaining({ key: 'breaker:embed:voyage', kind: 'embed_breaker', title: expect.stringContaining('probing') }));
    });

    it('also watches the Qdrant search breaker', async () => {
      const { svc, alerts, state } = build();
      state.qdrant = { key: 'qdrant', component: 'qdrant', state: 'open', consecutiveFailures: 5, openedAt: T };

      await svc.tick(T);

      expect(raised(alerts)).toContain('breaker:qdrant');
    });
  });

  describe('LLM failure rate', () => {
    it('alerts when the window failure ratio crosses the threshold with enough calls', async () => {
      const { svc, alerts } = build();
      await svc.tick(T); // baseline
      llm('anthropic', 'ok', 8);
      llm('anthropic', 'error', 9);
      llm('anthropic', 'timeout', 3);

      await svc.tick(T + MIN);

      expect(alerts.alert).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'llm_failure_rate:anthropic',
          kind: 'llm_failure_rate',
          severity: 'critical',
          title: 'LLM provider anthropic: 60% of calls failing',
        }),
      );
    });

    it('stays quiet below the minimum call count (one failure of two is not a trend)', async () => {
      const { svc, alerts } = build();
      await svc.tick(T);
      llm('anthropic', 'ok', 1);
      llm('anthropic', 'error', 1);

      await svc.tick(T + MIN);

      expect(raised(alerts)).not.toContain('llm_failure_rate:anthropic');
    });

    it('stays quiet when the ratio is under the threshold', async () => {
      const { svc, alerts } = build();
      await svc.tick(T);
      llm('anthropic', 'ok', 40);
      llm('anthropic', 'error', 5);

      await svc.tick(T + MIN);

      expect(alerts.alert).not.toHaveBeenCalled();
    });

    it('skipped-by-breaker calls are not counted as fresh failures (the breaker alert covers them)', async () => {
      const { svc, alerts } = build();
      await svc.tick(T);
      llm('anthropic', 'ok', 3);
      llm('anthropic', 'breaker_open', 200);

      await svc.tick(T + MIN);

      expect(raised(alerts)).not.toContain('llm_failure_rate:anthropic');
    });

    it('resolves once the failure rate is back to normal on real traffic', async () => {
      const { svc, alerts } = build();
      await svc.tick(T);
      llm('anthropic', 'error', 20);
      await svc.tick(T + MIN);
      expect(raised(alerts)).toContain('llm_failure_rate:anthropic');

      // The window slides past the bad minute; healthy traffic follows.
      await svc.tick(T + 7 * MIN);
      llm('anthropic', 'ok', 30);
      await svc.tick(T + 8 * MIN);

      expect(alerts.resolve).toHaveBeenCalledWith('llm_failure_rate:anthropic', 'llm_failure_rate', expect.any(String));
    });

    it('the window forgets old failures', async () => {
      process.env.OPS_LLM_WINDOW_SEC = '120';
      const { svc, alerts } = build();
      await svc.tick(T);
      llm('openai', 'error', 20);
      await svc.tick(T + 30_000); // alert fires here
      alerts.alert.mockClear();

      // 10 minutes later with no new failures: nothing in the window to alert on.
      await svc.tick(T + 10 * MIN);
      await svc.tick(T + 11 * MIN);

      expect(alerts.alert).not.toHaveBeenCalled();
    });

    it('thresholds are configurable', async () => {
      process.env.OPS_LLM_MIN_CALLS = '4';
      process.env.OPS_LLM_FAILURE_RATE = '0.25';
      const { svc, alerts } = build();
      await svc.tick(T);
      llm('anthropic', 'ok', 3);
      llm('anthropic', 'error', 1);

      await svc.tick(T + MIN);

      expect(raised(alerts)).toContain('llm_failure_rate:anthropic');
    });
  });

  describe('vector backend', () => {
    it('alerts on repeated Qdrant/embedding failures inside the window', async () => {
      const { svc, alerts } = build();
      await svc.tick(T);
      m.qdrantFailures.inc({ operation: 'search' }, 3);
      m.embedFailures.inc({ provider: 'voyage', reason: 'timeout' }, 3);

      await svc.tick(T + MIN);

      expect(alerts.alert).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'vector_backend', kind: 'vector_backend', severity: 'warning' }),
      );
    });

    it('does not count breaker-skipped searches as new failures', async () => {
      const { svc, alerts } = build();
      await svc.tick(T);
      m.qdrantFailures.inc({ operation: 'search_skipped' }, 500);
      m.embedFailures.inc({ provider: 'voyage', reason: 'breaker_open' }, 500);

      await svc.tick(T + MIN);

      expect(raised(alerts)).not.toContain('vector_backend');
    });

    it('resolves when a full window passes without a vector failure', async () => {
      const { svc, alerts } = build();
      await svc.tick(T);
      m.qdrantFailures.inc({ operation: 'search' }, 6);
      await svc.tick(T + MIN);
      await svc.tick(T + 7 * MIN); // the bad minute has slid out
      await svc.tick(T + 8 * MIN);

      expect(alerts.resolve).toHaveBeenCalledWith('vector_backend', 'vector_backend', expect.any(String));
    });
  });

  describe('dependencies', () => {
    it('needs consecutive failed probes before alerting (one blip is not an outage)', async () => {
      const { svc, alerts, state } = build();
      state.report = report({ db: down });

      await svc.tick(T);
      expect(alerts.alert).not.toHaveBeenCalled();
      await svc.tick(T + 30_000);

      expect(alerts.alert).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'dependency:db', kind: 'dependency_down', severity: 'critical', title: 'Database not responding' }),
      );
    });

    it('a recovered probe resets the streak and resolves', async () => {
      const { svc, alerts, state } = build();
      state.report = report({ redis: down });
      await svc.tick(T);
      state.report = report();
      await svc.tick(T + 30_000);
      state.report = report({ redis: down });
      await svc.tick(T + 60_000);

      expect(alerts.alert).not.toHaveBeenCalled(); // never two in a row
      expect(alerts.resolve).toHaveBeenCalledWith('dependency:redis', 'dependency_down', 'redis is responding again');
    });

    it('Redis and Qdrant are warnings, the database is critical', async () => {
      const { svc, alerts, state } = build();
      state.report = report({ redis: down, qdrant: down });
      await svc.tick(T);
      await svc.tick(T + 30_000);

      const sev = Object.fromEntries(alerts.alert.mock.calls.map(([a]) => [a.key, a.severity]));
      expect(sev).toEqual({ 'dependency:redis': 'warning', 'dependency:qdrant': 'warning' });
    });

    it('a dependency can be excluded (a deployment that runs without Redis)', async () => {
      process.env.OPS_WATCHDOG_SKIP = 'redis';
      const { svc, alerts, state } = build();
      state.report = report({ redis: down });
      await svc.tick(T);
      await svc.tick(T + 30_000);

      expect(alerts.alert).not.toHaveBeenCalled();
    });

    it('a skipped dependency (Qdrant not configured) is never an alert', async () => {
      const { svc, alerts } = build();
      await svc.tick(T);
      await svc.tick(T + 30_000);
      expect(alerts.alert).not.toHaveBeenCalled();
    });
  });

  it('a failing probe or rule cannot crash the tick, and ticks do not stack', async () => {
    const { svc, alerts } = build();
    alerts.alert.mockRejectedValue(new Error('alerting down'));
    (svc as unknown as { readiness: { check: jest.Mock } }).readiness.check.mockRejectedValue(new Error('probe boom'));

    await expect(svc.tick(T)).resolves.toBeUndefined();

    let release: () => void = () => undefined;
    (svc as unknown as { readiness: { check: jest.Mock } }).readiness.check.mockImplementation(() => new Promise((r) => (release = () => r(report()))));
    const first = svc.tick(T + 1000);
    await new Promise((r) => setImmediate(r)); // let the first tick reach the probe
    const check = (svc as unknown as { readiness: { check: jest.Mock } }).readiness.check;
    const callsBefore = check.mock.calls.length;
    await svc.tick(T + 2000); // returns immediately: a tick is in flight
    expect(check.mock.calls.length).toBe(callsBefore); // the second tick did not probe again
    release();
    await first;
  });

  it('OPS_WATCHDOG_INTERVAL_SEC=0 disables the timer; a CLI never runs one', () => {
    process.env.OPS_WATCHDOG_INTERVAL_SEC = '0';
    const off = build().svc;
    off.onModuleInit();
    expect((off as unknown as { timer: unknown }).timer).toBeNull();

    process.env.OPS_WATCHDOG_INTERVAL_SEC = '30';
    process.env.SHARPTALK_CLI = '1';
    const cli = build().svc;
    cli.onModuleInit();
    expect((cli as unknown as { timer: unknown }).timer).toBeNull();

    delete process.env.SHARPTALK_CLI;
    const on = build().svc;
    on.onModuleInit();
    expect((on as unknown as { timer: unknown }).timer).not.toBeNull();
    on.onModuleDestroy();
  });
});
