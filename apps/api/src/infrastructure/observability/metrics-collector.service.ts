import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AiGatewayService } from '../external/ai/ai-gateway.service';
import { QdrantService } from '../external/vector/qdrant.service';
import { BREAKER_STATE_VALUE, m, metrics } from './app-metrics';

/**
 * Gauges read at scrape time (PLN-261012 SG-83): values that are cheaper to look at when asked than
 * to keep updated — circuit-breaker state, queued conversations, the DB pool, process memory.
 *
 * Registered on the shared registry from `onModuleInit` and removed on shutdown, so a second Nest
 * application in the same process (tests) never ends up with two collectors.
 */
@Injectable()
export class MetricsCollectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MetricsCollectorService.name);
  private dispose: Array<() => void> = [];
  private conversationsCache: { at: number; byStatus: Record<string, number> } | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly gateway: AiGatewayService,
    private readonly qdrant: QdrantService,
  ) {}

  onModuleInit(): void {
    this.dispose.push(metrics.addCollector(() => this.collectBreakers()));
    this.dispose.push(metrics.addCollector(() => this.collectProcess()));
    this.dispose.push(metrics.addCollector(() => this.collectDbPool()));
    this.dispose.push(metrics.addCollector(() => this.collectConversations()));
  }

  onModuleDestroy(): void {
    for (const d of this.dispose) d();
    this.dispose = [];
  }

  /** Worst state per component: with two engines of one provider, one open breaker must show as open. */
  collectBreakers(): void {
    const worst = new Map<string, number>();
    const all = [...this.gateway.breakerSnapshots().map((b) => ({ component: b.component, state: b.state }))];
    const q = this.qdrant.breakerSnapshot();
    if (q) all.push({ component: q.component, state: q.state });
    for (const b of all) {
      worst.set(b.component, Math.max(worst.get(b.component) ?? 0, BREAKER_STATE_VALUE[b.state]));
    }
    for (const [component, value] of worst) m.breakerState.set({ component }, value);
  }

  collectProcess(): void {
    m.uptime.set(undefined, Math.round(process.uptime()));
    const mem = process.memoryUsage();
    m.rss.set(undefined, mem.rss);
    m.heapUsed.set(undefined, mem.heapUsed);
  }

  /**
   * mysql2 pool occupancy. Reaches into the driver (TypeORM exposes no stable API for it), so every
   * access is defensive: a driver that changes shape costs the gauge, never the scrape.
   */
  collectDbPool(): void {
    try {
      // TypeORM hands back the callback-style mysql2 pool, whose bookkeeping lives directly on it;
      // the promise wrapper keeps the same pool one level down. Accept either shape.
      const driverPool = (this.dataSource.driver as unknown as { pool?: Record<string, any> }).pool;
      const pool: Record<string, unknown> | undefined = driverPool?._allConnections ? driverPool : driverPool?.pool;
      const total = (pool?._allConnections as { length?: number } | undefined)?.length;
      const free = (pool?._freeConnections as { length?: number } | undefined)?.length;
      if (typeof total === 'number') {
        m.dbPool.set({ state: 'total' }, total);
        if (typeof free === 'number') m.dbPool.set({ state: 'in_use' }, Math.max(0, total - free));
      }
    } catch {
      /* gauge unavailable */
    }
  }

  /**
   * Queue depth and open conversations — the numbers an operator wants beside the error rate. One
   * indexed GROUP BY (idx_conv_status), cached 30 s so a scraper at 5 s does not become load.
   */
  async collectConversations(): Promise<void> {
    const now = Date.now();
    if (!this.conversationsCache || now - this.conversationsCache.at > 30_000) {
      try {
        const rows: Array<{ status: string; n: string | number }> = await this.dataSource.query(
          "SELECT status, COUNT(*) AS n FROM conversations WHERE status IN ('ai_active','waiting','agent') GROUP BY status",
        );
        const byStatus: Record<string, number> = { ai_active: 0, waiting: 0, agent: 0 };
        for (const r of rows) byStatus[r.status] = Number(r.n);
        this.conversationsCache = { at: now, byStatus };
      } catch (e) {
        this.logger.debug(`open-conversation gauge unavailable: ${(e as Error).message}`);
        return;
      }
    }
    for (const [status, n] of Object.entries(this.conversationsCache.byStatus)) {
      m.conversationsOpen.set({ status }, n);
    }
  }
}
