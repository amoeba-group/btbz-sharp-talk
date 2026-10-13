import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AiGatewayService } from '../external/ai/ai-gateway.service';
import { QdrantService } from '../external/vector/qdrant.service';
import { envNumber } from '../../global/util/env-number.util';
import { isCliContext } from '../../global/util/cli-context.util';
import { m } from './app-metrics';
import { OpsAlertService } from './ops-alert.service';
import { ReadinessReport, ReadinessService } from './readiness.service';

/**
 * Turns the service's own signals into operational alerts (PLN-261012 SG-83).
 *
 * Why a watchdog instead of an alert call at each failure site: the failure sites are adapters, the
 * gateway and the vector clients — built with `new` in specs and by positional constructors other
 * streams are editing. They already bump counters; this reads those counters (and the breaker states
 * and a readiness probe) on a timer and decides. The cost is up to one interval of latency; the gain
 * is that a rule can look at a RATE ("half of the last 40 calls failed"), which no single call site
 * can see.
 *
 * Rules, all deduped with a cooldown by `OpsAlertService` and each followed by a RESOLVED notice:
 *  - llm_breaker:<engine>      a circuit breaker is open or probing
 *  - llm_failure_rate:<prov>   failure ratio over the window ≥ OPS_LLM_FAILURE_RATE with ≥ OPS_LLM_MIN_CALLS calls
 *  - vector_backend            ≥ OPS_VECTOR_FAILURES Qdrant/embedding failures over the window
 *  - dependency:<db|redis|qdrant>  down on OPS_DEP_FAILURES consecutive probes
 */
export interface WatchdogSettings {
  windowSec: number;
  llmFailureRate: number;
  llmMinCalls: number;
  vectorFailures: number;
  depFailures: number;
  skip: Set<string>;
}

export function watchdogSettings(): WatchdogSettings {
  return {
    windowSec: Math.max(30, envNumber('OPS_LLM_WINDOW_SEC', 300)),
    llmFailureRate: Math.min(1, Math.max(0.01, envNumber('OPS_LLM_FAILURE_RATE', 0.5))),
    llmMinCalls: Math.max(1, Math.round(envNumber('OPS_LLM_MIN_CALLS', 10))),
    vectorFailures: Math.max(1, Math.round(envNumber('OPS_VECTOR_FAILURES', 5))),
    depFailures: Math.max(1, Math.round(envNumber('OPS_DEP_FAILURES', 2))),
    skip: new Set(
      (process.env.OPS_WATCHDOG_SKIP ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  };
}

interface Sample {
  t: number;
  ok: Record<string, number>;
  fail: Record<string, number>;
  vector: number;
}

@Injectable()
export class OpsWatchdogService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OpsWatchdogService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private samples: Sample[] = [];
  private readonly depFails = new Map<string, number>();
  private ticking = false;

  constructor(
    private readonly alerts: OpsAlertService,
    private readonly readiness: ReadinessService,
    private readonly gateway: AiGatewayService,
    private readonly qdrant: QdrantService,
  ) {}

  onModuleInit(): void {
    // A one-off CLI must not run a second watchdog next to the live API (PLN-261008 D2).
    if (isCliContext()) return;
    const sec = envNumber('OPS_WATCHDOG_INTERVAL_SEC', 30);
    if (!(sec > 0)) {
      this.logger.log('Ops watchdog disabled (OPS_WATCHDOG_INTERVAL_SEC <= 0)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), sec * 1000);
    this.timer.unref?.();
    this.logger.log(`Ops watchdog running every ${sec}s`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Counters now, summed per provider. */
  private sample(now: number): Sample {
    const ok: Record<string, number> = {};
    const fail: Record<string, number> = {};
    for (const provider of m.llmCalls.distinct('provider')) {
      ok[provider] = m.llmCalls.sum({ provider, status: 'ok' });
      fail[provider] = m.llmCalls.sum({ provider, status: 'error' }) + m.llmCalls.sum({ provider, status: 'timeout' });
    }
    // Skipped-by-breaker counts are consequences of an earlier failure, not new evidence.
    const vector =
      m.embedFailures.sum() -
      m.embedFailures.sum({ reason: 'breaker_open' }) +
      (m.qdrantFailures.sum() - m.qdrantFailures.sum({ operation: 'search_skipped' }));
    return { t: now, ok, fail, vector };
  }

  /** One evaluation. Public so the rules are testable without timers. */
  async tick(now: number = Date.now()): Promise<void> {
    if (this.ticking) return; // a slow readiness probe must not stack ticks
    this.ticking = true;
    try {
      const cfg = watchdogSettings();
      const current = this.sample(now);
      const windowMs = cfg.windowSec * 1000;
      this.samples = this.samples.filter((s) => now - s.t <= windowMs);
      const baseline = this.samples[0];
      this.samples.push(current);

      await this.checkBreakers();
      if (baseline) {
        await this.checkLlmFailureRate(cfg, baseline, current);
        await this.checkVector(cfg, baseline, current);
      }
      await this.checkDependencies(cfg);
    } catch (e) {
      this.logger.warn(`ops watchdog tick failed: ${(e as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  private async checkBreakers(): Promise<void> {
    const all = [...this.gateway.breakerSnapshots()];
    const q = this.qdrant.breakerSnapshot();
    if (q) all.push({ key: 'qdrant', component: q.component, state: q.state, consecutiveFailures: q.consecutiveFailures, openedAt: q.openedAt });
    for (const b of all) {
      const key = `breaker:${b.key}`;
      const kind = b.component === 'embedding' ? 'embed_breaker' : b.component === 'qdrant' ? 'qdrant_breaker' : 'llm_breaker';
      if (b.state === 'closed') {
        await this.alerts.resolve(key, kind, `Circuit breaker closed: ${b.component} (${b.key})`);
        continue;
      }
      await this.alerts.alert({
        key,
        kind,
        severity: 'critical',
        title: `Circuit breaker ${b.state === 'open' ? 'open' : 'probing'}: ${b.component} (${b.key})`,
        detail:
          `${b.consecutiveFailures} consecutive engine-level failures. Calls are skipped for ${Math.round(envNumber('AI_BREAKER_OPEN_SEC', 30))}s ` +
          'at a time and then one probe decides; customers meanwhile get keyword-only answers or a hand-off to a person. ' +
          'Check provider status, the API key and the account credit.',
      });
    }
  }

  private async checkLlmFailureRate(cfg: WatchdogSettings, base: Sample, now: Sample): Promise<void> {
    for (const provider of Object.keys(now.ok)) {
      const dOk = now.ok[provider] - (base.ok[provider] ?? 0);
      const dFail = now.fail[provider] - (base.fail[provider] ?? 0);
      const calls = dOk + dFail;
      if (calls < cfg.llmMinCalls) continue; // too little traffic to say anything
      const ratio = dFail / calls;
      const key = `llm_failure_rate:${provider}`;
      if (ratio >= cfg.llmFailureRate) {
        await this.alerts.alert({
          key,
          kind: 'llm_failure_rate',
          severity: 'critical',
          title: `LLM provider ${provider}: ${Math.round(ratio * 100)}% of calls failing`,
          detail:
            `${dFail} of ${calls} calls failed in the last ${Math.round((now.t - base.t) / 60_000) || 1} min ` +
            `(threshold ${Math.round(cfg.llmFailureRate * 100)}% with at least ${cfg.llmMinCalls} calls). ` +
            'Customers are getting stub fallbacks / hand-offs for these calls.',
        });
      } else if (ratio < cfg.llmFailureRate / 2) {
        await this.alerts.resolve(key, 'llm_failure_rate', `LLM provider ${provider}: failure rate back to normal`);
      }
    }
  }

  private async checkVector(cfg: WatchdogSettings, base: Sample, now: Sample): Promise<void> {
    const d = now.vector - base.vector;
    const key = 'vector_backend';
    if (d >= cfg.vectorFailures) {
      await this.alerts.alert({
        key,
        kind: 'vector_backend',
        severity: 'warning',
        title: 'Vector retrieval backend failing (Qdrant / embeddings)',
        detail:
          `${d} vector-leg failures in the last ${Math.round((now.t - base.t) / 60_000) || 1} min. Chat keeps answering from keyword search at a ` +
          'capped confidence and hands off when nothing matches; answer quality is reduced until the backend is back.',
      });
    } else if (d === 0) {
      await this.alerts.resolve(key, 'vector_backend', 'Vector retrieval backend recovered');
    }
  }

  private async checkDependencies(cfg: WatchdogSettings): Promise<void> {
    let report: ReadinessReport;
    try {
      report = await this.readiness.check();
    } catch (e) {
      this.logger.warn(`readiness probe failed: ${(e as Error).message}`);
      return;
    }
    for (const name of ['db', 'redis', 'qdrant'] as const) {
      if (cfg.skip.has(name)) continue;
      const c = report.checks[name];
      if (c.status === 'skipped') continue;
      const key = `dependency:${name}`;
      if (c.status === 'down') {
        const n = (this.depFails.get(name) ?? 0) + 1;
        this.depFails.set(name, n);
        if (n >= cfg.depFailures) {
          await this.alerts.alert({
            key,
            kind: 'dependency_down',
            severity: name === 'db' ? 'critical' : 'warning',
            title: `${name === 'db' ? 'Database' : name === 'redis' ? 'Redis' : 'Qdrant'} not responding`,
            detail: `${n} consecutive failed probes. ${c.detail ?? ''}`.trim(),
          });
        }
      } else {
        this.depFails.set(name, 0);
        await this.alerts.resolve(key, 'dependency_down', `${name} is responding again`);
      }
    }
  }
}
