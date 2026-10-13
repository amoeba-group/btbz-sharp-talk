import { Injectable, Logger } from '@nestjs/common';
import {
  AiAdapter,
  AiCompletionRequest,
  AiCompletionResult,
  AiEmbeddingRequest,
  AiEmbeddingResult,
} from '../ai-adapter.interface';
import {
  ProviderHttpError,
  embedRequestTimeoutMs,
  runWithTimeout,
} from '../../../resilience/resilience';

/**
 * Voyage AI embedding adapter (PLAN-KB-VectorHybrid-Qdrant W2). voyage-4 is
 * multilingual/cross-lingual (ko/en/es share one vector space) and returns
 * normalized vectors, so dot product == cosine similarity. Embedding-only:
 * complete() is unsupported and the gateway never routes completions here.
 */
@Injectable()
export class VoyageAdapter implements AiAdapter {
  readonly provider = 'voyage';
  private readonly logger = new Logger(VoyageAdapter.name);

  async complete(_req: AiCompletionRequest): Promise<AiCompletionResult> {
    throw new Error('Voyage adapter is embedding-only');
  }

  /** Backoff for 429s — free-tier Voyage rate limits are low (RPM-scale). */
  private static readonly RETRY_429_MS = [15_000, 30_000, 60_000];

  async embed(req: AiEmbeddingRequest): Promise<AiEmbeddingResult> {
    const apiKey = req.apiKey ?? process.env.VOYAGE_API_KEY;
    if (!apiKey) throw new Error('Voyage API key not configured');
    const model = req.model || process.env.VOYAGE_MODEL || 'voyage-4';
    // Per REQUEST, not per call: a batch that waits out a 429 backoff must not have its next
    // request pre-expired by the time it slept. The gateway bounds the retries (PLN-261012 SG-84).
    const timeoutMs = req.timeoutMs ?? embedRequestTimeoutMs();

    // Blocking 429 backoff is for BATCH calls only (reindex CLI). A single-text
    // request is the live chat query path — fail fast there so retrieval
    // degrades to FULLTEXT instead of stalling the reply for up to 105s.
    const maxRetries = req.texts.length > 1 ? VoyageAdapter.RETRY_429_MS.length : 0;
    let res: { ok: boolean; status: number; data: any } | null = null;
    for (let attempt = 0; ; attempt++) {
      res = await runWithTimeout(timeoutMs, 'Voyage', async (signal) => {
        const r = await fetch('https://api.voyageai.com/v1/embeddings', {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            input: req.texts,
            model,
            input_type: req.inputType,
          }),
        });
        // Body inside the deadline: a stalled stream must not outlive it.
        return { ok: r.ok, status: r.status, data: r.ok ? await r.json() : null };
      });
      if (res.status === 429 && attempt < maxRetries) {
        const wait = VoyageAdapter.RETRY_429_MS[attempt];
        this.logger.warn(`Voyage 429 (rate limit) — retrying in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      break;
    }
    if (!res.ok) {
      this.logger.error(`Voyage error ${res.status}`);
      // `alreadyRetried` on a batch 429: the backoff above WAS the retry budget, so the gateway
      // must not stack its own retries on top of up to 105 s of waiting.
      throw new ProviderHttpError(
        `Voyage API error ${res.status}`,
        res.status,
        res.status === 429 && maxRetries > 0,
      );
    }
    const data: any = res.data;
    const byIndex = [...(data.data ?? [])].sort((a: any, b: any) => a.index - b.index);
    const vectors = byIndex.map((d: any) => d.embedding as number[]);
    return {
      vectors,
      tokensIn: data.usage?.total_tokens ?? 0,
      provider: this.provider,
      model: data.model ?? model,
      dimension: vectors[0]?.length ?? 0,
    };
  }
}
