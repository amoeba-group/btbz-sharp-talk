import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { AiUsageDaily, ENGINE_OWNER, EngineOwner } from './entity/ai-usage-daily.entity';

/** One call's worth of metering, as the gateway sees it. */
export interface UsageRecord {
  tenantId: number;
  feature: string;
  aiFunction: string;
  engineId: number | null;
  provider: string;
  model: string;
  engineOwner: EngineOwner;
  tokensIn: number;
  tokensOut: number;
  /** The call fell through to the stub: no tokens, and not a real answer. */
  stub?: boolean;
  /** The engine refused or errored, whether or not the stub caught it. */
  failed?: boolean;
}

export interface UsageQuery {
  from: string;
  to: string;
  groupBy: 'feature' | 'function' | 'engine' | 'owner';
}

export interface UsageBucket {
  key: string;
  label: string;
  owner: string | null;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  stubCalls: number;
  failures: number;
}

export interface UsageSummary {
  /**
   * The first day with any recorded usage, anywhere in the installation.
   *
   * Reported so the screen can say when counting began. Without it, a range
   * that predates the meter reads as "we used nothing that month", which is a
   * different and wrong statement.
   */
  since: string | null;
  buckets: UsageBucket[];
  totals: { calls: number; tokensIn: number; tokensOut: number; stubCalls: number; failures: number };
}

/**
 * AI token usage (PLN-260824 A).
 *
 * Written from exactly one place — the gateway — because every AI call goes
 * through it. Metering at the ten call sites instead would miss the eleventh
 * silently, and silence is indistinguishable from "that feature is cheap".
 */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(
    @InjectRepository(AiUsageDaily) private readonly repo: Repository<AiUsageDaily>,
  ) {}

  /**
   * Add one call to today's row.
   *
   * An upsert rather than read-modify-write: two conversations finishing in the
   * same second would otherwise race and one would be lost.
   */
  async record(r: UsageRecord, today = new Date()): Promise<void> {
    const statDate = today.toISOString().slice(0, 10);
    const feature = (r.feature || r.aiFunction).slice(0, 32);
    // Written as SQL because the accumulation is the point: `calls = calls + 1`
    // is not something the query builder's orUpdate can express, and a
    // read-modify-write would lose one of two conversations finishing in the
    // same second.
    await this.repo.query(
      `INSERT INTO ai_usage_daily
         (tenant_id, stat_date, feature, ai_function, engine_id, provider, model, engine_owner,
          calls, tokens_in, tokens_out, stub_calls, failures)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         calls      = calls + 1,
         tokens_in  = tokens_in + VALUES(tokens_in),
         tokens_out = tokens_out + VALUES(tokens_out),
         stub_calls = stub_calls + VALUES(stub_calls),
         failures   = failures + VALUES(failures)`,
      [
        r.tenantId,
        statDate,
        feature,
        r.aiFunction,
        r.engineId,
        r.provider,
        r.model,
        r.engineOwner,
        r.tokensIn,
        r.tokensOut,
        r.stub ? 1 : 0,
        r.failed ? 1 : 0,
      ],
    );
  }

  /**
   * Today's calls and failures per engine (PLN-261007 S4). UTC day, the same
   * one `record` writes under. Failures are the calls the stub had to catch.
   */
  async todayByEngine(today = new Date()): Promise<Map<number, { calls: number; failures: number }>> {
    const rows: Array<{ engine_id: string | number; calls: string; failures: string }> = await this.repo.query(
      `SELECT engine_id, SUM(calls) calls, SUM(failures) failures
         FROM ai_usage_daily WHERE stat_date = ? AND engine_id IS NOT NULL GROUP BY engine_id`,
      [today.toISOString().slice(0, 10)],
    );
    return new Map(rows.map((r) => [Number(r.engine_id), { calls: Number(r.calls), failures: Number(r.failures) }]));
  }

  /** Today's calls and failures per AI function for one tenant (PLN-261007 S5). */
  async todayByFunction(
    tenantId: number,
    today = new Date(),
  ): Promise<Map<string, { calls: number; failures: number }>> {
    const rows: Array<{ ai_function: string; calls: string; failures: string }> = await this.repo.query(
      `SELECT ai_function, SUM(calls) calls, SUM(failures) failures
         FROM ai_usage_daily WHERE tenant_id = ? AND stat_date = ? GROUP BY ai_function`,
      [tenantId, today.toISOString().slice(0, 10)],
    );
    return new Map(rows.map((r) => [r.ai_function, { calls: Number(r.calls), failures: Number(r.failures) }]));
  }

  /** Usage over a date range, grouped on one axis. Days, weeks and months are all sums of rows. */
  async summarize(tenantId: number, q: UsageQuery): Promise<UsageSummary> {
    const rows = await this.repo.find({
      where: { tenantId, statDate: Between(q.from, q.to) },
    });

    const buckets = new Map<string, UsageBucket>();
    for (const row of rows) {
      const key =
        q.groupBy === 'feature'
          ? row.feature
          : q.groupBy === 'function'
            ? row.aiFunction
            : q.groupBy === 'engine'
              ? `${row.engineId ?? 'removed'}`
              : row.engineOwner;
      const label =
        q.groupBy === 'engine' ? `${row.provider} / ${row.model}` : key;
      const b =
        buckets.get(key) ??
        ({
          key,
          label,
          // Only meaningful when the axis does not already split by owner.
          owner: q.groupBy === 'owner' ? row.engineOwner : null,
          calls: 0,
          tokensIn: 0,
          tokensOut: 0,
          stubCalls: 0,
          failures: 0,
        } satisfies UsageBucket);
      b.calls += row.calls;
      b.tokensIn += Number(row.tokensIn);
      b.tokensOut += Number(row.tokensOut);
      b.stubCalls += row.stubCalls;
      b.failures += row.failures;
      buckets.set(key, b);
    }

    const list = [...buckets.values()].sort((a, b) => b.tokensIn - a.tokensIn);
    const totals = list.reduce(
      (acc, b) => ({
        calls: acc.calls + b.calls,
        tokensIn: acc.tokensIn + b.tokensIn,
        tokensOut: acc.tokensOut + b.tokensOut,
        stubCalls: acc.stubCalls + b.stubCalls,
        failures: acc.failures + b.failures,
      }),
      { calls: 0, tokensIn: 0, tokensOut: 0, stubCalls: 0, failures: 0 },
    );

    return { since: await this.meteringSince(tenantId), buckets: list, totals };
  }

  /** Earliest recorded day for this tenant, or null when nothing has been metered yet. */
  async meteringSince(tenantId: number): Promise<string | null> {
    const first = await this.repo.findOne({
      where: { tenantId },
      order: { statDate: 'ASC' },
    });
    return first?.statDate ?? null;
  }

  /** Owner of an engine, in the terms the invoice uses. */
  static ownerOf(engineTenantId: number | null | undefined): EngineOwner {
    return engineTenantId == null ? ENGINE_OWNER.PLATFORM : ENGINE_OWNER.TENANT;
  }
}
