import {
  buildTurnLatency,
  elapsedMs,
  latenciesFromTraces,
  percentile,
  summarizeLatency,
} from './turn-latency.util';

describe('turn latency helpers (PLN-261012 SG-53)', () => {
  describe('buildTurnLatency', () => {
    it('totals from the start and keeps each stage', () => {
      expect(buildTurnLatency(1000, { classify: 120, retrieve: 80, generate: 900, moderate: 40 }, 2300)).toEqual({
        total: 1300,
        classify: 120,
        retrieve: 80,
        generate: 900,
        moderate: 40,
      });
    });

    it('a stage that did not run is null, never 0', () => {
      const l = buildTurnLatency(0, { classify: 10, moderate: 5 }, 50);
      expect(l.retrieve).toBeNull();
      expect(l.generate).toBeNull();
    });

    it('rounds, and never goes negative on a clock step', () => {
      expect(buildTurnLatency(1000, { classify: 12.6 }, 900).total).toBe(0);
      expect(buildTurnLatency(0, { classify: 12.6 }, 10).classify).toBe(13);
      expect(elapsedMs(500, 400)).toBe(0);
    });

    it('treats a non-finite stage as not measured', () => {
      expect(buildTurnLatency(0, { generate: NaN, retrieve: Infinity }, 5)).toMatchObject({
        generate: null,
        retrieve: null,
      });
    });
  });

  describe('percentile (nearest rank)', () => {
    const values = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    it('returns an observed value for P50 and P95', () => {
      expect(percentile(values, 50)).toBe(50);
      expect(percentile(values, 95)).toBe(100);
      expect(percentile(values, 90)).toBe(90);
    });

    it('is order-independent and ignores non-numbers', () => {
      expect(percentile([100, 10, NaN, 50], 50)).toBe(50);
    });

    it('handles one value, none, and out-of-range p', () => {
      expect(percentile([42], 95)).toBe(42);
      expect(percentile([], 50)).toBeNull();
      expect(percentile(values, 0)).toBe(10);
      expect(percentile(values, 150)).toBe(100);
    });
  });

  describe('summarizeLatency / latenciesFromTraces', () => {
    const traces = [
      { latencyMs: { total: 900, generate: 500 } },
      { latencyMs: { total: 1200, generate: null } },
      { latencyMs: { total: 3000, generate: 2500 } },
      { citations: [] }, // an older turn with no latency
      null,
    ];

    it('reads one stage out of persisted traces and skips rows without it', () => {
      expect(latenciesFromTraces(traces)).toEqual([900, 1200, 3000]);
      expect(latenciesFromTraces(traces, 'generate')).toEqual([500, 2500]);
    });

    it('summarises count, P50, P95 and max', () => {
      expect(summarizeLatency(latenciesFromTraces(traces))).toEqual({ count: 3, p50: 1200, p95: 3000, max: 3000 });
      expect(summarizeLatency([])).toEqual({ count: 0, p50: null, p95: null, max: null });
    });
  });
});
