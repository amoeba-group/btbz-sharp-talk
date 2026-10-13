/**
 * Minimal Prometheus registry (PLN-261012 SG-83) — counters, gauges and fixed-bucket
 * histograms rendered in the text exposition format 0.0.4.
 *
 * Hand-rolled because the environment cannot install `prom-client`, and because the surface we
 * need is small. Two properties matter more than features:
 *  1. Label cardinality is bounded. Every metric has a series cap; a label set past the cap is
 *     dropped (and counted) rather than growing the process heap without limit — an unbounded
 *     label (a tenant id, a path with an id, a free-text reason) is the classic way metrics
 *     take a service down.
 *  2. Nothing personal can reach it. Label values are short, sanitized strings chosen by code.
 */

export type Labels = Record<string, string | number | undefined>;

const LABEL_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const METRIC_NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
/** Longest label value kept; anything longer is cut so one bad caller cannot bloat the scrape. */
const MAX_LABEL_VALUE = 64;
const DEFAULT_MAX_SERIES = 300;

function cleanValue(v: string | number | undefined): string {
  if (v === undefined || v === null) return '';
  return String(v).slice(0, MAX_LABEL_VALUE);
}

function escapeLabelValue(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function escapeHelp(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

function formatNumber(n: number): string {
  if (Number.isNaN(n)) return 'NaN';
  if (n === Infinity) return '+Inf';
  if (n === -Infinity) return '-Inf';
  return String(n);
}

abstract class Metric {
  /** Series insertion order is kept so the scrape output is stable. */
  protected readonly series = new Map<string, { labelValues: string[] }>();

  constructor(
    readonly name: string,
    readonly help: string,
    readonly labelNames: readonly string[],
    protected readonly registry: MetricsRegistry,
    private readonly maxSeries: number,
  ) {
    if (!METRIC_NAME.test(name)) throw new Error(`invalid metric name: ${name}`);
    for (const l of labelNames) if (!LABEL_NAME.test(l)) throw new Error(`invalid label name: ${l}`);
  }

  abstract readonly type: 'counter' | 'gauge' | 'histogram';
  abstract renderSamples(): string[];

  /** Resolve (or create) the series for a label set; null when the cardinality cap is hit. */
  protected slot<T extends { labelValues: string[] }>(labels: Labels | undefined, make: (lv: string[]) => T): T | null {
    const labelValues = this.labelNames.map((n) => cleanValue(labels?.[n]));
    const key = labelValues.join('\u0000');
    const existing = this.series.get(key) as T | undefined;
    if (existing) return existing;
    if (this.series.size >= this.maxSeries) {
      this.registry.noteDropped(this.name);
      return null;
    }
    const created = make(labelValues);
    this.series.set(key, created);
    return created;
  }

  protected labelString(labelValues: string[], extra?: [string, string]): string {
    const parts = this.labelNames.map((n, i) => `${n}="${escapeLabelValue(labelValues[i])}"`);
    if (extra) parts.push(`${extra[0]}="${escapeLabelValue(extra[1])}"`);
    return parts.length ? `{${parts.join(',')}}` : '';
  }

  render(): string[] {
    const samples = this.renderSamples();
    if (!samples.length) return [];
    return [`# HELP ${this.name} ${escapeHelp(this.help)}`, `# TYPE ${this.name} ${this.type}`, ...samples];
  }

  clear(): void {
    this.series.clear();
  }
}

export class Counter extends Metric {
  readonly type = 'counter' as const;

  inc(labels?: Labels, by = 1): void {
    if (by < 0 || !Number.isFinite(by)) return; // counters only go up
    const s = this.slot(labels, (labelValues) => ({ labelValues, value: 0 }));
    if (s) s.value += by;
  }

  /** Current value of one series — used by the watchdog and tests. */
  get(labels?: Labels): number {
    const key = this.labelNames.map((n) => cleanValue(labels?.[n])).join('\u0000');
    return (this.series.get(key) as { value: number } | undefined)?.value ?? 0;
  }

  /** The distinct values one label has taken so far (empty strings excluded). */
  distinct(label: string): string[] {
    const i = this.labelNames.indexOf(label);
    if (i < 0) return [];
    const out = new Set<string>();
    for (const s of this.series.values() as Iterable<{ labelValues: string[] }>) {
      if (s.labelValues[i]) out.add(s.labelValues[i]);
    }
    return [...out];
  }

  /** Sum of every series whose given labels match (others ignored). */
  sum(match: Labels = {}): number {
    let total = 0;
    for (const s of this.series.values() as Iterable<{ labelValues: string[]; value: number }>) {
      const ok = Object.entries(match).every(([k, v]) => {
        const i = this.labelNames.indexOf(k);
        return i >= 0 && s.labelValues[i] === cleanValue(v);
      });
      if (ok) total += s.value;
    }
    return total;
  }

  renderSamples(): string[] {
    return [...(this.series.values() as Iterable<{ labelValues: string[]; value: number }>)].map(
      (s) => `${this.name}${this.labelString(s.labelValues)} ${formatNumber(s.value)}`,
    );
  }
}

export class Gauge extends Metric {
  readonly type = 'gauge' as const;

  set(labels: Labels | undefined, value: number): void {
    const s = this.slot(labels, (labelValues) => ({ labelValues, value: 0 }));
    if (s) s.value = value;
  }

  inc(labels?: Labels, by = 1): void {
    const s = this.slot(labels, (labelValues) => ({ labelValues, value: 0 }));
    if (s) s.value += by;
  }

  renderSamples(): string[] {
    return [...(this.series.values() as Iterable<{ labelValues: string[]; value: number }>)].map(
      (s) => `${this.name}${this.labelString(s.labelValues)} ${formatNumber(s.value)}`,
    );
  }
}

interface HistogramSeries {
  labelValues: string[];
  counts: number[]; // per finite bucket, NOT cumulative
  sum: number;
  count: number;
}

export class Histogram extends Metric {
  readonly type = 'histogram' as const;

  constructor(
    name: string,
    help: string,
    labelNames: readonly string[],
    registry: MetricsRegistry,
    maxSeries: number,
    readonly buckets: readonly number[],
  ) {
    super(name, help, labelNames, registry, maxSeries);
    if (!buckets.length || buckets.some((b, i) => i > 0 && b <= buckets[i - 1])) {
      throw new Error(`histogram ${name}: buckets must be a non-empty, strictly increasing list`);
    }
    if (labelNames.includes('le')) throw new Error(`histogram ${name}: "le" is reserved`);
  }

  observe(labels: Labels | undefined, value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    const s = this.slot<HistogramSeries>(labels, (labelValues) => ({
      labelValues,
      counts: new Array(this.buckets.length).fill(0),
      sum: 0,
      count: 0,
    }));
    if (!s) return;
    const i = this.buckets.findIndex((b) => value <= b);
    if (i >= 0) s.counts[i] += 1;
    s.sum += value;
    s.count += 1;
  }

  renderSamples(): string[] {
    const out: string[] = [];
    for (const s of this.series.values() as Iterable<HistogramSeries>) {
      let cumulative = 0;
      this.buckets.forEach((b, i) => {
        cumulative += s.counts[i];
        out.push(`${this.name}_bucket${this.labelString(s.labelValues, ['le', formatNumber(b)])} ${cumulative}`);
      });
      out.push(`${this.name}_bucket${this.labelString(s.labelValues, ['le', '+Inf'])} ${s.count}`);
      out.push(`${this.name}_sum${this.labelString(s.labelValues)} ${formatNumber(s.sum)}`);
      out.push(`${this.name}_count${this.labelString(s.labelValues)} ${s.count}`);
    }
    return out;
  }
}

/** Runs at scrape time to refresh gauges that are cheaper to read than to keep updated. */
export type Collector = () => void | Promise<void>;

export class MetricsRegistry {
  private readonly metrics = new Map<string, Metric>();
  private readonly collectors: Collector[] = [];
  private readonly dropped = new Map<string, number>();

  counter(name: string, help: string, labelNames: readonly string[] = [], maxSeries = DEFAULT_MAX_SERIES): Counter {
    return this.register(new Counter(name, help, labelNames, this, maxSeries));
  }

  gauge(name: string, help: string, labelNames: readonly string[] = [], maxSeries = DEFAULT_MAX_SERIES): Gauge {
    return this.register(new Gauge(name, help, labelNames, this, maxSeries));
  }

  histogram(
    name: string,
    help: string,
    buckets: readonly number[],
    labelNames: readonly string[] = [],
    maxSeries = DEFAULT_MAX_SERIES,
  ): Histogram {
    return this.register(new Histogram(name, help, labelNames, this, maxSeries, buckets));
  }

  private register<T extends Metric>(m: T): T {
    if (this.metrics.has(m.name)) throw new Error(`metric already registered: ${m.name}`);
    this.metrics.set(m.name, m);
    return m;
  }

  /** Returns a disposer, so a module that registers a collector can remove it on shutdown. */
  addCollector(c: Collector): () => void {
    this.collectors.push(c);
    return () => {
      const i = this.collectors.indexOf(c);
      if (i >= 0) this.collectors.splice(i, 1);
    };
  }

  /** @internal called by a metric that refused a new series. */
  noteDropped(metric: string): void {
    this.dropped.set(metric, (this.dropped.get(metric) ?? 0) + 1);
  }

  /** Text exposition (v0.0.4). A failing collector is skipped — one broken gauge must not blank the scrape. */
  async render(): Promise<string> {
    for (const c of this.collectors) {
      try {
        await c();
      } catch {
        /* a collector that throws leaves its gauges at their last value */
      }
    }
    const lines: string[] = [];
    for (const m of this.metrics.values()) lines.push(...m.render());
    if (this.dropped.size) {
      lines.push(
        '# HELP sharptalk_metrics_series_dropped_total Label sets refused because a metric hit its series cap',
        '# TYPE sharptalk_metrics_series_dropped_total counter',
      );
      for (const [metric, n] of this.dropped) {
        lines.push(`sharptalk_metrics_series_dropped_total{metric="${escapeLabelValue(metric)}"} ${n}`);
      }
    }
    return lines.length ? `${lines.join('\n')}\n` : '';
  }

  /** Test helper: forget every series and drop count (definitions stay). */
  reset(): void {
    for (const m of this.metrics.values()) m.clear();
    this.dropped.clear();
  }
}

/** Latency buckets (seconds) for HTTP — a chat turn that waits on a model can run tens of seconds. */
export const HTTP_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60] as const;
/** Latency buckets (seconds) for one provider call; the default timeout is 25 s. */
export const LLM_BUCKETS = [0.25, 0.5, 1, 2, 5, 10, 20, 30, 60] as const;
