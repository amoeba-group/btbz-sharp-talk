import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { runWithTimeout, qdrantRequestTimeoutMs } from '../../resilience/resilience';

/** Payload stored with every reuse-question point. */
export interface ReuseVectorPayload {
  tenant_id: number;
  lang: string;
  active: boolean;
}

export interface ReuseVectorHit {
  id: number;
  score: number;
  payload: ReuseVectorPayload;
}

/**
 * Qdrant index of past QUESTION embeddings for answer reuse (PLN-260808 Track C).
 * Deliberately a separate collection (`reuse_questions`) from kb_documents —
 * different lifecycle (TTL/deactivation vs KB reindex) and different payload.
 * MySQL (`answer_reuse`) is the source of truth; point id = row id. Same REST
 * plumbing as QdrantService (repo convention: no SDK), same tenant-scoped-only
 * search posture. Every failure is the caller's cue to fall back to the LLM.
 */
@Injectable()
export class ReuseQdrantService implements OnModuleInit {
  private readonly logger = new Logger(ReuseQdrantService.name);
  private readonly collection = 'reuse_questions';
  private readonly dimension = 1024; // voyage-4 / stub-embed-1 (same space as KB)
  private baseUrl: string | null = null;
  private ready = false;

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return this.baseUrl !== null;
  }

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('QDRANT_URL');
    if (!url) return; // vector reuse disabled with the rest of the vector leg
    this.baseUrl = url.replace(/\/$/, '');
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
    if (!(exists as { result?: { exists?: boolean } })?.result?.exists) {
      await this.request('PUT', `/collections/${this.collection}`, {
        vectors: { size: this.dimension, distance: 'Dot' },
      });
      for (const [field, schema] of [
        ['tenant_id', 'integer'],
        ['lang', 'keyword'],
        ['active', 'bool'],
      ] as const) {
        await this.request('PUT', `/collections/${this.collection}/index?wait=true`, {
          field_name: field,
          field_schema: schema,
        });
      }
    }
  }

  async upsert(id: number, vector: number[], payload: ReuseVectorPayload): Promise<void> {
    await this.lazyEnsure();
    // Number() at the boundary — MySQL bigint PKs arrive as strings.
    await this.request('PUT', `/collections/${this.collection}/points?wait=true`, {
      points: [
        { id: Number(id), vector, payload: { ...payload, tenant_id: Number(payload.tenant_id) } },
      ],
    });
  }

  async setActive(id: number, active: boolean): Promise<void> {
    await this.lazyEnsure();
    await this.request('POST', `/collections/${this.collection}/points/payload?wait=true`, {
      payload: { active },
      points: [Number(id)],
    });
  }

  /** Bulk visibility flip for one tenant (console "deactivate all"). */
  async setActiveByTenant(tenantId: number, active: boolean): Promise<void> {
    await this.lazyEnsure();
    await this.request('POST', `/collections/${this.collection}/points/payload?wait=true`, {
      payload: { active },
      filter: { must: [{ key: 'tenant_id', match: { value: Number(tenantId) } }] },
    });
  }

  async delete(ids: number[]): Promise<void> {
    if (!ids.length) return;
    await this.lazyEnsure();
    await this.request('POST', `/collections/${this.collection}/points/delete?wait=true`, {
      points: ids.map((i) => Number(i)),
    });
  }

  /** Dense search scoped to one tenant + language. No unscoped variant exists. */
  async search(
    tenantId: number,
    lang: string,
    vector: number[],
    limit: number,
  ): Promise<ReuseVectorHit[]> {
    await this.lazyEnsure();
    const res = (await this.request('POST', `/collections/${this.collection}/points/search`, {
      vector,
      limit,
      with_payload: true,
      filter: {
        must: [
          { key: 'active', match: { value: true } },
          { key: 'tenant_id', match: { value: Number(tenantId) } },
          { key: 'lang', match: { value: lang } },
        ],
      },
    })) as { result?: Array<{ id: number; score: number; payload: ReuseVectorPayload }> };
    return (res?.result ?? []).map((p) => ({
      id: Number(p.id),
      score: Number(p.score),
      payload: p.payload,
    }));
  }

  private async lazyEnsure(): Promise<void> {
    if (!this.baseUrl) throw new Error('Qdrant disabled (QDRANT_URL not set)');
    if (!this.ready) {
      await this.ensureCollection();
      this.ready = true;
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    // Deadline for the answer-reuse index too (PLN-261012 SG-84) — a lookup runs before every
    // chat answer, so a hung Qdrant would stall the turn here as well.
    return runWithTimeout(qdrantRequestTimeoutMs(), 'Qdrant', async (signal) => {
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
  }
}
