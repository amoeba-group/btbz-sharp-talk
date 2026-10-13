import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AiEngine } from '../../domain/ai-engine/entity/ai-engine.entity';
import { AiGatewayService } from '../external/ai/ai-gateway.service';
import { ENGINE_FAILURE, engineHealth } from '../external/ai/engine-health';
import { QdrantService } from '../external/vector/qdrant.service';
import { RedisService } from '../cache/redis.service';
import { envNumber } from '../../global/util/env-number.util';
import { m } from './app-metrics';

/**
 * Dependency readiness (PLN-261012 SG-83): the database, Redis, Qdrant, and a summary of the AI
 * engines — each with its own deadline and its own verdict.
 *
 * `/health` (liveness) only proves the process answers; `/health/ready` is an admin DB ping. Neither
 * says which dependency is the problem, and neither sees Redis or Qdrant — so a dead vector backend
 * looked exactly like a healthy API while every answer degraded.
 *
 * Verdicts. A dependency is `up`, `down`, `degraded` (reachable but impaired — an open breaker, an
 * engine reporting failures) or `skipped` (not configured). The overall status is `down` only when a
 * REQUIRED dependency is down (`READINESS_REQUIRED`, default `db`: the API can still serve chat on
 * FULLTEXT without Redis or Qdrant, and on the stub without an engine), `degraded` when anything is
 * down or impaired, else `ok`.
 */
export type DependencyStatus = 'up' | 'down' | 'degraded' | 'skipped';

export interface DependencyCheck {
  status: DependencyStatus;
  latencyMs: number | null;
  /** Short machine reason; never a connection string or a secret. */
  detail?: string;
}

export interface AiSummary extends DependencyCheck {
  engines: Array<{ id: number; provider: string; model: string; health: string; breaker?: string }>;
}

export interface ReadinessReport {
  status: 'ok' | 'degraded' | 'down';
  required: string[];
  checks: { db: DependencyCheck; redis: DependencyCheck; qdrant: DependencyCheck; ai: AiSummary };
  uptimeSec: number;
  timestamp: string;
}

/** Engine health values that mean "the last real call failed". */
const FAILING = new Set<string>([
  ENGINE_FAILURE.CREDIT,
  ENGINE_FAILURE.AUTH,
  ENGINE_FAILURE.MODEL,
  ENGINE_FAILURE.RATE_LIMIT,
  ENGINE_FAILURE.UNREACHABLE,
]);

/** Reject after `ms` — the readiness probe must answer even when a dependency hangs. */
export function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} did not answer within ${ms}ms`)), ms);
  });
  return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

/** Overall verdict from the per-dependency checks and the required list (pure). */
export function overallStatus(
  checks: Record<string, { status: DependencyStatus }>,
  required: string[],
): ReadinessReport['status'] {
  if (required.some((k) => checks[k]?.status === 'down')) return 'down';
  return Object.values(checks).some((c) => c.status === 'down' || c.status === 'degraded') ? 'degraded' : 'ok';
}

@Injectable()
export class ReadinessService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(AiEngine) private readonly engineRepo: Repository<AiEngine>,
    private readonly redis: RedisService,
    private readonly qdrant: QdrantService,
    private readonly gateway: AiGatewayService,
    private readonly config: ConfigService,
  ) {}

  private timeoutMs(): number {
    return Math.max(200, envNumber('READINESS_CHECK_TIMEOUT_MS', 2_000));
  }

  /** `READINESS_REQUIRED` (csv of db,redis,qdrant); default the database only. */
  requiredDependencies(): string[] {
    const raw = (this.config.get<string>('READINESS_REQUIRED') ?? '').trim();
    const list = raw
      ? raw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => ['db', 'redis', 'qdrant'].includes(s))
      : ['db'];
    return list.length ? list : ['db'];
  }

  private async timed(run: () => Promise<void>, label: string): Promise<DependencyCheck> {
    const started = Date.now();
    try {
      await withDeadline(run(), this.timeoutMs(), label);
      return { status: 'up', latencyMs: Date.now() - started };
    } catch (e) {
      return { status: 'down', latencyMs: Date.now() - started, detail: (e as Error).message.slice(0, 160) };
    }
  }

  async check(): Promise<ReadinessReport> {
    const [db, redis, qdrant, ai] = await Promise.all([
      this.timed(async () => void (await this.dataSource.query('SELECT 1')), 'database'),
      this.timed(() => this.redis.ping(), 'redis'),
      this.qdrant.enabled
        ? this.timed(() => this.qdrant.probe(), 'qdrant')
        : Promise.resolve<DependencyCheck>({ status: 'skipped', latencyMs: null, detail: 'QDRANT_URL not set' }),
      this.aiSummary(),
    ]);
    // An open Qdrant breaker is impairment even when the probe (which bypasses it) answers.
    const qBreaker = this.qdrant.breakerSnapshot();
    if (qdrant.status === 'up' && qBreaker && qBreaker.state !== 'closed') {
      qdrant.status = 'degraded';
      qdrant.detail = `search breaker ${qBreaker.state}`;
    }
    const checks = { db, redis, qdrant, ai };
    const required = this.requiredDependencies();
    for (const [name, c] of Object.entries(checks)) {
      if (name !== 'ai') m.dependencyUp.set({ dependency: name }, c.status === 'up' ? 1 : c.status === 'skipped' ? 1 : 0);
    }
    return {
      status: overallStatus(checks, required),
      required,
      checks,
      uptimeSec: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * What the engines last did (from the health columns the gateway maintains) plus breaker state.
   * Makes NO provider call: readiness must not spend credit or wait on an LLM.
   */
  private async aiSummary(): Promise<AiSummary> {
    const started = Date.now();
    try {
      const rows = await withDeadline(
        this.engineRepo.find({ where: { status: 'enabled' } }),
        this.timeoutMs(),
        'ai engines',
      );
      const breakers = new Map(this.gateway.breakerSnapshots().map((b) => [b.key, b.state]));
      const engines = rows
        .filter((e) => e.provider !== 'stub')
        .map((e) => ({
          id: Number(e.id),
          provider: e.provider,
          model: e.model,
          health: engineHealth({
            provider: e.provider,
            status: e.status,
            hasKey: !!e.apiKeyEncrypted,
            lastOkAt: e.lastOkAt,
            lastErrorAt: e.lastErrorAt,
            lastErrorReason: e.lastErrorReason,
          }) as string,
          breaker: breakers.get(`engine:${e.id}`),
        }));
      const impaired = engines.filter((e) => FAILING.has(e.health) || (e.breaker && e.breaker !== 'closed'));
      const status: DependencyStatus = !engines.length ? 'skipped' : impaired.length ? 'degraded' : 'up';
      return {
        status,
        latencyMs: Date.now() - started,
        ...(status === 'skipped' ? { detail: 'no real engine configured (stub only)' } : {}),
        ...(impaired.length ? { detail: `${impaired.length} of ${engines.length} engine(s) failing` } : {}),
        engines,
      };
    } catch (e) {
      return { status: 'down', latencyMs: Date.now() - started, detail: (e as Error).message.slice(0, 160), engines: [] };
    }
  }
}
