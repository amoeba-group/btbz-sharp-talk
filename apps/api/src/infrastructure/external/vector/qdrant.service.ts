import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { runWithTimeout, qdrantRequestTimeoutMs } from '../../resilience/resilience';
import {
  BreakerSnapshot,
  CircuitBreaker,
  breakerEnabled,
  breakerOptionsFromEnv,
} from '../../resilience/circuit-breaker';
import { m } from '../../observability/app-metrics';

/** Payload stored with every KB point. tenantId 0 = global/platform document. */
export interface KbVectorPayload {
  tenant_id: number;
  category: string | null;
  source: string;
  active: boolean;
}

export interface KbVectorHit {
  id: number;
  score: number;
  payload: KbVectorPayload;
}

/**
 * Qdrant vector index for kb_documents (PLAN-KB-VectorHybrid-Qdrant W3).
 * MySQL stays the source of truth; this collection is derived and fully
 * rebuildable via `npm run kb:reindex`. Plain REST via fetch (repo convention —
 * no SDK dependency). Every read REQUIRES a tenantId: there is deliberately no
 * unscoped search surface (tenant isolation, POL-019 posture).
 */
@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name);
  private readonly collection = 'kb_documents';
  private readonly dimension = 1024; // voyage-4 / stub-embed-1
  private baseUrl: string | null = null;
  private ready = false;
  private readonly breaker: CircuitBreaker | null = breakerEnabled()
    ? new CircuitBreaker({
        ...breakerOptionsFromEnv(),
        onTransition: (from, to) => {
          m.breakerTransitions.inc({ component: 'qdrant', to });
          this.logger.warn(`Circuit breaker qdrant: ${from} -> ${to}`);
        },
      })
    : null;

  constructor(private readonly config: ConfigService) {}

  /** Vector leg is enabled only when QDRANT_URL is configured and reachable. */
  get enabled(): boolean {
    return this.baseUrl !== null;
  }

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('QDRANT_URL');
    if (!url) {
      this.logger.log('QDRANT_URL not set — vector retrieval disabled (FULLTEXT only)');
      return;
    }
    this.baseUrl = url.replace(/\/$/, '');
    // Non-fatal bootstrap: a down Qdrant must never block API startup.
    try {
      await this.ensureCollection();
      this.ready = true;
      this.logger.log(`Qdrant connected (${this.collection}, dim=${this.dimension})`);
    } catch (e) {
      this.logger.warn(`Qdrant unavailable at startup: ${(e as Error).message}`);
    }
  }

  private async ensureCollection(): Promise<void> {
    const exists = await this.request('GET', `/collections/${this.collection}/exists`);
    if (!(exists as any)?.result?.exists) {
      await this.request('PUT', `/collections/${this.collection}`, {
        vectors: { size: this.dimension, distance: 'Dot' },
      });
      for (const [field, schema] of [
        ['tenant_id', 'integer'],
        ['category', 'keyword'],
        ['active', 'bool'],
      ] as const) {
        await this.request('PUT', `/collections/${this.collection}/index?wait=true`, {
          field_name: field,
          field_schema: schema,
        });
      }
    }
  }

  async upsert(id: number, vector: number[], payload: KbVectorPayload): Promise<void> {
    await this.lazyEnsure();
    // Number() everywhere an id or tenant id crosses this boundary: MySQL bigint
    // PKs arrive as strings at runtime and Qdrant rejects string point IDs.
    await this.request('PUT', `/collections/${this.collection}/points?wait=true`, {
      points: [{ id: Number(id), vector, payload: { ...payload, tenant_id: Number(payload.tenant_id) } }],
    });
  }

  /** Toggle visibility without re-embedding (active flag change). */
  async setActive(id: number, active: boolean): Promise<void> {
    await this.lazyEnsure();
    await this.request('POST', `/collections/${this.collection}/points/payload?wait=true`, {
      payload: { active },
      points: [Number(id)],
    });
  }

  async delete(id: number): Promise<void> {
    await this.lazyEnsure();
    await this.request('POST', `/collections/${this.collection}/points/delete?wait=true`, {
      points: [Number(id)],
    });
  }

  /**
   * Dense search scoped to one tenant (+ global docs, tenant_id 0). tenantId is
   * a required positional parameter by design — no unscoped variant exists.
   */
  async search(tenantId: number, vector: number[], limit: number): Promise<KbVectorHit[]> {
    // Live-query path only (PLN-261012 SG-84): after N consecutive failures stop spending the
    // request timeout on every customer turn and let retrieval run on FULLTEXT alone. KB writes
    // (upsert/delete) are not gated — they are operator-driven and must report their own errors.
    if (this.breaker && !this.breaker.allow()) {
      m.qdrantFailures.inc({ operation: 'search_skipped' });
      throw new Error('Qdrant circuit open — search skipped');
    }
    try {
      await this.lazyEnsure();
      const res: any = await this.request('POST', `/collections/${this.collection}/points/search`, {
        vector,
        limit,
        with_payload: true,
        filter: {
          must: [
            { key: 'active', match: { value: true } },
            { key: 'tenant_id', match: { any: [Number(tenantId), 0] } },
          ],
        },
      });
      this.breaker?.recordSuccess();
      return ((res?.result ?? []) as any[]).map((p) => ({
        id: Number(p.id),
        score: Number(p.score),
        payload: p.payload as KbVectorPayload,
      }));
    } catch (e) {
      this.breaker?.recordFailure();
      throw e;
    }
  }

  /** Breaker state for `/metrics`, readiness and the ops watchdog; null when disabled. */
  breakerSnapshot(): (BreakerSnapshot & { component: string }) | null {
    return this.breaker ? { component: 'qdrant', ...this.breaker.snapshot() } : null;
  }

  /**
   * Cheap reachability probe for readiness — one bounded GET, no side effects, and independent of
   * the breaker (readiness must see the backend's real state, not our own opinion of it).
   */
  async probe(): Promise<void> {
    if (!this.baseUrl) throw new Error('Qdrant disabled (QDRANT_URL not set)');
    await this.request('GET', '/collections');
  }

  private async lazyEnsure(): Promise<void> {
    if (!this.baseUrl) throw new Error('Qdrant disabled (QDRANT_URL not set)');
    if (!this.ready) {
      await this.ensureCollection();
      this.ready = true;
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    try {
      // Whole-call deadline, body read included (PLN-261012 SG-84): Qdrant had none, so a hung
      // instance stalled every live retrieval until the HTTP layer gave up on its own.
      return await runWithTimeout(qdrantRequestTimeoutMs(), 'Qdrant', async (signal) => {
        const res = await fetch(`${this.baseUrl}${path}`, {
          method,
          signal,
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(`Qdrant ${method} ${path} → ${res.status} ${detail.slice(0, 200)}`);
        }
        return res.json().catch(() => ({}));
      });
    } catch (e) {
      m.qdrantFailures.inc({ operation: QdrantService.operationOf(method, path) });
      throw e;
    }
  }

  /** A bounded label for the failure counter — never the raw path (it carries ids). */
  static operationOf(method: string, path: string): string {
    if (path.includes('/points/search')) return 'search';
    if (path.includes('/points/delete')) return 'delete';
    if (path.includes('/points/payload')) return 'set_active';
    if (path.includes('/points')) return 'upsert';
    if (path === '/collections') return 'probe';
    return method === 'GET' || path.includes('/index') ? 'ensure' : 'other';
  }
}
