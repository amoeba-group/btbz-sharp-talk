import { m, metrics, observeTurnLatency } from './app-metrics';

/**
 * Per-stage chat-turn latency as Prometheus histograms (PLN-261012 SG-52 follow-up).
 * Fed from the persisted turn latency, so /metrics and the rows the pilot analytics read
 * their P50/P95 from are one set of numbers.
 */
describe('observeTurnLatency', () => {
  beforeEach(() => m.turnStageDuration.clear());

  it('returns the very object it was given, so the call site can wrap what it already persists', () => {
    const latency = { total: 1500, classify: 200, retrieve: 100, generate: 900, moderate: 50 };
    expect(observeTurnLatency(latency)).toBe(latency);
  });

  it('observes every stage that ran, once, converting milliseconds to seconds', async () => {
    observeTurnLatency({ total: 1500, classify: 200, retrieve: 100, generate: 900, moderate: 50 });
    const out = await metrics.render();
    for (const stage of ['total', 'classify', 'retrieve', 'generate', 'moderate']) {
      expect(out).toContain(`sharptalk_chat_turn_stage_duration_seconds_count{stage="${stage}"} 1`);
    }
    expect(out).toContain('sharptalk_chat_turn_stage_duration_seconds_sum{stage="total"} 1.5');
    expect(out).toContain('sharptalk_chat_turn_stage_duration_seconds_sum{stage="moderate"} 0.05');
  });

  it('a stage the turn did not run (null/undefined) is skipped — it must not read as an instant 0 ms', async () => {
    observeTurnLatency({ total: 800, classify: 100, retrieve: null, generate: null, moderate: 40 });
    const out = await metrics.render();
    expect(out).not.toContain('stage="retrieve"');
    expect(out).not.toContain('stage="generate"');
    expect(out).toContain('stage="total"');
  });

  it('ignores NaN, Infinity and negative values instead of poisoning the sum', async () => {
    observeTurnLatency({ total: NaN, classify: Infinity, retrieve: -5, generate: 300, moderate: undefined });
    const out = await metrics.render();
    expect(out).toContain('sharptalk_chat_turn_stage_duration_seconds_count{stage="generate"} 1');
    expect(out).not.toContain('stage="total"');
    expect(out).not.toContain('stage="classify"');
    expect(out).not.toContain('stage="retrieve"');
  });

  it('has bucket edges on the NFR-001 targets (2 s first answer, 6 s complete) so a quantile answers them exactly', async () => {
    observeTurnLatency({ total: 5000 });
    const out = await metrics.render();
    expect(out).toContain('sharptalk_chat_turn_stage_duration_seconds_bucket{stage="total",le="2"} 0');
    expect(out).toContain('sharptalk_chat_turn_stage_duration_seconds_bucket{stage="total",le="6"} 1');
  });

  it('never throws into the chat path, whatever it is handed', () => {
    expect(() => observeTurnLatency(null as never)).not.toThrow();
    expect(() => observeTurnLatency({} as never)).not.toThrow();
  });

  it('keeps cardinality at the five fixed stage labels', async () => {
    for (let i = 0; i < 50; i += 1) observeTurnLatency({ total: 100 + i, classify: 10, retrieve: 20, generate: 30, moderate: 5 });
    const out = await metrics.render();
    const series = new Set(out.match(/_count\{stage="[a-z]+"\}/g));
    expect(series.size).toBe(5);
  });
});
