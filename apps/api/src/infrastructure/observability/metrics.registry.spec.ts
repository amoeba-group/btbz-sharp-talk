import { MetricsRegistry } from './metrics.registry';

/** PLN-261012 SG-83 — the hand-rolled registry must emit valid Prometheus text and bound its cardinality. */
describe('MetricsRegistry — text exposition', () => {
  it('renders a counter with HELP, TYPE and labelled samples', async () => {
    const r = new MetricsRegistry();
    const c = r.counter('app_requests_total', 'Requests by route', ['route', 'status']);
    c.inc({ route: 'chat', status: '2xx' });
    c.inc({ route: 'chat', status: '2xx' }, 2);
    c.inc({ route: 'agent', status: '5xx' });

    expect(await r.render()).toBe(
      [
        '# HELP app_requests_total Requests by route',
        '# TYPE app_requests_total counter',
        'app_requests_total{route="chat",status="2xx"} 3',
        'app_requests_total{route="agent",status="5xx"} 1',
        '',
      ].join('\n'),
    );
  });

  it('renders an unlabelled metric without braces', async () => {
    const r = new MetricsRegistry();
    r.gauge('app_uptime_seconds', 'Uptime').set(undefined, 42);
    expect(await r.render()).toContain('\napp_uptime_seconds 42\n');
  });

  it('counters only go up', async () => {
    const r = new MetricsRegistry();
    const c = r.counter('x_total', 'x');
    c.inc(undefined, 5);
    c.inc(undefined, -3);
    c.inc(undefined, NaN);
    expect(c.get()).toBe(5);
  });

  it('histograms emit CUMULATIVE buckets, +Inf, _sum and _count', async () => {
    const r = new MetricsRegistry();
    const h = r.histogram('app_duration_seconds', 'Duration', [0.1, 0.5, 1], ['route']);
    h.observe({ route: 'chat' }, 0.05);
    h.observe({ route: 'chat' }, 0.3);
    h.observe({ route: 'chat' }, 0.4);
    h.observe({ route: 'chat' }, 7);

    const out = await r.render();

    expect(out).toContain('# TYPE app_duration_seconds histogram');
    expect(out).toContain('app_duration_seconds_bucket{route="chat",le="0.1"} 1');
    expect(out).toContain('app_duration_seconds_bucket{route="chat",le="0.5"} 3');
    expect(out).toContain('app_duration_seconds_bucket{route="chat",le="1"} 3');
    expect(out).toContain('app_duration_seconds_bucket{route="chat",le="+Inf"} 4');
    expect(out).toContain('app_duration_seconds_sum{route="chat"} 7.75');
    expect(out).toContain('app_duration_seconds_count{route="chat"} 4');
  });

  it('a value exactly on a bucket boundary falls in that bucket (le is inclusive)', async () => {
    const r = new MetricsRegistry();
    const h = r.histogram('d_seconds', 'd', [0.5, 1]);
    h.observe(undefined, 0.5);
    expect(await r.render()).toContain('d_seconds_bucket{le="0.5"} 1');
  });

  it('rejects bad histogram buckets and invalid names at definition time', () => {
    const r = new MetricsRegistry();
    expect(() => r.histogram('h1', 'h', [1, 1])).toThrow(/strictly increasing/);
    expect(() => r.histogram('h2', 'h', [])).toThrow();
    expect(() => r.counter('bad name', 'x')).toThrow(/invalid metric name/);
    expect(() => r.counter('ok_total', 'x', ['le-bad'])).toThrow(/invalid label name/);
    expect(() => r.histogram('h3', 'h', [1], ['le'])).toThrow(/reserved/);
    r.counter('dup_total', 'x');
    expect(() => r.counter('dup_total', 'x')).toThrow(/already registered/);
  });

  it('escapes backslash, quote and newline in label values (no output injection)', async () => {
    const r = new MetricsRegistry();
    r.counter('e_total', 'e', ['v']).inc({ v: 'a"b\\c\nd' });
    expect(await r.render()).toContain('e_total{v="a\\"b\\\\c\\nd"} 1');
  });

  it('escapes HELP text', async () => {
    const r = new MetricsRegistry();
    r.counter('h_total', 'line1\nline2 \\ end').inc();
    expect(await r.render()).toContain('# HELP h_total line1\\nline2 \\\\ end\n');
  });

  it('emits nothing for a metric with no samples (no empty HELP/TYPE blocks)', async () => {
    const r = new MetricsRegistry();
    r.counter('quiet_total', 'q', ['a']);
    expect(await r.render()).toBe('');
  });

  it('cuts an over-long label value instead of bloating the scrape', async () => {
    const r = new MetricsRegistry();
    r.counter('l_total', 'l', ['v']).inc({ v: 'x'.repeat(500) });
    const line = (await r.render()).split('\n').find((l) => l.startsWith('l_total{'))!;
    expect(line.length).toBeLessThan(100);
  });
});

describe('MetricsRegistry — bounded cardinality', () => {
  it('refuses new label sets past the series cap and counts the refusals', async () => {
    const r = new MetricsRegistry();
    const c = r.counter('capped_total', 'c', ['id'], 3);
    for (let i = 0; i < 10; i++) c.inc({ id: String(i) });
    // Existing series keep counting; new ones are dropped.
    c.inc({ id: '0' });

    const out = await r.render();

    expect(out.match(/^capped_total\{/gm)).toHaveLength(3);
    expect(out).toContain('capped_total{id="0"} 2');
    expect(out).toContain('sharptalk_metrics_series_dropped_total{metric="capped_total"} 7');
  });
});

describe('MetricsRegistry — collectors', () => {
  it('runs collectors at render time and survives one that throws', async () => {
    const r = new MetricsRegistry();
    const g = r.gauge('live_value', 'v');
    r.addCollector(() => {
      throw new Error('boom');
    });
    r.addCollector(async () => g.set(undefined, 9));

    expect(await r.render()).toContain('live_value 9');
  });

  it('a disposed collector no longer runs', async () => {
    const r = new MetricsRegistry();
    const g = r.gauge('live_value', 'v');
    const dispose = r.addCollector(() => g.set(undefined, 1));
    dispose();
    expect(await r.render()).toBe('');
  });

  it('reset() forgets samples but keeps definitions', async () => {
    const r = new MetricsRegistry();
    const c = r.counter('r_total', 'r');
    c.inc();
    r.reset();
    expect(await r.render()).toBe('');
    c.inc();
    expect(c.get()).toBe(1);
  });
});

describe('Counter helpers', () => {
  it('sum() adds the series matching the given labels; distinct() lists label values', () => {
    const r = new MetricsRegistry();
    const c = r.counter('calls_total', 'c', ['provider', 'status']);
    c.inc({ provider: 'anthropic', status: 'ok' }, 4);
    c.inc({ provider: 'anthropic', status: 'error' }, 1);
    c.inc({ provider: 'openai', status: 'ok' }, 2);

    expect(c.sum()).toBe(7);
    expect(c.sum({ provider: 'anthropic' })).toBe(5);
    expect(c.sum({ provider: 'anthropic', status: 'ok' })).toBe(4);
    expect(c.distinct('provider').sort()).toEqual(['anthropic', 'openai']);
    expect(c.distinct('nope')).toEqual([]);
  });
});
