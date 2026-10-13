import { MODERATION_DECISION } from '@sharptalk/types';
import { AiGatewayService } from './ai-gateway.service';
import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { VoyageAdapter } from './adapters/voyage.adapter';
import { ModerationService } from '../../../domain/moderation/moderation.service';
import { AiTimeoutError, ProviderHttpError } from '../../resilience/resilience';
import { m, metrics } from '../../observability/app-metrics';

/**
 * PLN-261012 SG-84 — deadlines, retry and the circuit breaker, end to end through the gateway:
 * the contract (`degraded: true`, stub text) is unchanged, a dead engine just stops costing a
 * full timeout per call, and moderation still fails safe.
 */
describe('AiGatewayService — resilience', () => {
  const ENGINE = { id: '5', tenantId: 4, provider: 'anthropic', model: 'm', endpoint: null, apiKeyEncrypted: null, status: 'enabled', isDefault: 1 };
  const saved = { ...process.env };

  function build(complete: (...a: unknown[]) => Promise<unknown>, voyageEmbed?: (...a: unknown[]) => Promise<unknown>) {
    const engineRepo = { findOne: jest.fn(async () => ENGINE), update: jest.fn(async () => undefined) };
    const settingRepo = { findOne: jest.fn(async () => ({ tenantId: 4, func: 'rag', engineId: 5, paramsJson: null })) };
    const stub = {
      provider: 'stub',
      complete: jest.fn(async () => ({ text: "Here's what I found for you:", tokensIn: 1, tokensOut: 1, provider: 'stub', model: 'stub-1' })),
      embed: jest.fn(async () => ({ vectors: [[0]], tokensIn: 0, provider: 'stub', model: 'stub-embed-1', dimension: 1 })),
    };
    const anthropic = { provider: 'anthropic', complete: jest.fn(complete) };
    const voyage = {
      provider: 'voyage',
      complete: jest.fn(),
      embed: jest.fn(voyageEmbed ?? (async () => ({ vectors: [[1]], tokensIn: 1, provider: 'voyage', model: 'voyage-4', dimension: 1 }))),
    };
    const usage = { record: jest.fn(async () => undefined) };
    const gw = new AiGatewayService(
      engineRepo as never,
      settingRepo as never,
      stub as never,
      anthropic as never,
      { provider: 'openai', complete: jest.fn() } as never,
      voyage as never,
      usage as never,
    );
    let t = 5_000_000;
    gw.hooks.now = () => t;
    gw.hooks.sleep = async () => undefined;
    gw.hooks.random = () => 0;
    return { gw, anthropic, stub, voyage, engineRepo, usage, advance: (ms: number) => void (t += ms) };
  }

  const req = { tenantId: 4, function: 'rag' as never, feature: 'chat_answer', messages: [{ role: 'user' as const, content: 'q' }] };
  const ok = { text: 'real answer', tokensIn: 3, tokensOut: 4, provider: 'anthropic', model: 'm' };
  const unavailable = () => new ProviderHttpError('Anthropic API error 529: overloaded_error: Overloaded', 529);

  beforeEach(() => {
    process.env = { ...saved };
    process.env.AI_BREAKER_FAILURE_THRESHOLD = '3';
    process.env.AI_BREAKER_OPEN_SEC = '30';
    delete process.env.AI_BREAKER_ENABLED;
    delete process.env.AI_MAX_RETRIES;
    metrics.reset();
  });
  afterAll(() => {
    process.env = saved;
  });

  describe('timeout', () => {
    it('a stalled provider is aborted at the deadline and the call surfaces as degraded', async () => {
      // The REAL adapter and a fetch that never answers but honours the abort signal.
      const adapter = new AnthropicAdapter();
      const { gw } = build(async (...a) => adapter.complete(...(a as [never])));
      global.fetch = jest.fn(
        (_url: unknown, init: { signal: AbortSignal }) =>
          new Promise((_res, rej) => {
            init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }),
      ) as unknown as typeof fetch;
      process.env.ANTHROPIC_API_KEY = 'k';

      const started = Date.now();
      const res = await gw.complete({ ...req, timeoutMs: 40 });

      expect(res.degraded).toBe(true);
      expect(Date.now() - started).toBeLessThan(2000);
      expect(m.llmCalls.get({ feature: 'chat_answer', provider: 'anthropic', status: 'timeout' })).toBe(1);
    });

    it('a timeout is NOT retried (the deadline is already the customer\'s patience)', async () => {
      const { gw, anthropic } = build(async () => {
        throw new AiTimeoutError('Anthropic', 25_000);
      });

      await gw.complete(req);

      expect(anthropic.complete).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry', () => {
    it('retries a 5xx once and returns the real answer — not degraded', async () => {
      const fn = jest.fn().mockRejectedValueOnce(unavailable()).mockResolvedValueOnce(ok);
      const { gw, anthropic } = build(fn);

      const res = await gw.complete(req);

      expect(res.text).toBe('real answer');
      expect(res.degraded).toBeUndefined();
      expect(anthropic.complete).toHaveBeenCalledTimes(2);
      expect(m.llmRetries.get({ provider: 'anthropic' })).toBe(1);
    });

    it('gives up after one retry (bounded) and degrades', async () => {
      const { gw, anthropic } = build(async () => {
        throw unavailable();
      });

      const res = await gw.complete(req);

      expect(anthropic.complete).toHaveBeenCalledTimes(2);
      expect(res.degraded).toBe(true);
    });

    it('does not retry a request the provider rejected', async () => {
      const { gw, anthropic } = build(async () => {
        throw new ProviderHttpError('Anthropic API error 400: invalid_request_error: bad', 400);
      });

      const res = await gw.complete(req);

      expect(anthropic.complete).toHaveBeenCalledTimes(1);
      expect(res.degraded).toBe(true);
    });
  });

  describe('circuit breaker', () => {
    const fail = (gw: AiGatewayService, n: number) => Array.from({ length: n }).reduce<Promise<unknown>>((p) => p.then(() => gw.complete(req)), Promise.resolve());

    it('opens after N consecutive failures; the next call skips the engine but keeps the degraded contract', async () => {
      process.env.AI_MAX_RETRIES = '0';
      const { gw, anthropic, stub } = build(async () => {
        throw unavailable();
      });
      await fail(gw, 3);
      expect(anthropic.complete).toHaveBeenCalledTimes(3);

      const res = await gw.complete(req);

      expect(anthropic.complete).toHaveBeenCalledTimes(3); // no network call
      expect(res.degraded).toBe(true);
      expect(res.text).toContain("Here's what I found"); // the stub's canned text, flagged degraded
      expect(stub.complete).toHaveBeenCalledTimes(4);
      expect(gw.breakerSnapshots()).toEqual([expect.objectContaining({ key: 'engine:5', component: 'anthropic', state: 'open' })]);
      expect(m.llmCalls.get({ feature: 'chat_answer', provider: 'anthropic', status: 'breaker_open' })).toBe(1);
      expect(m.breakerTransitions.get({ component: 'anthropic', to: 'open' })).toBe(1);
    });

    it('an open breaker does not rewrite the engine health row on every skipped call', async () => {
      process.env.AI_MAX_RETRIES = '0';
      const { gw, engineRepo } = build(async () => {
        throw unavailable();
      });
      await fail(gw, 3);
      await new Promise((r) => setImmediate(r));
      const writes = engineRepo.update.mock.calls.length;

      await gw.complete(req);
      await gw.complete(req);
      await new Promise((r) => setImmediate(r));

      expect(engineRepo.update.mock.calls.length).toBe(writes);
    });

    it('skipped calls are still metered as failures of the engine that should have answered', async () => {
      process.env.AI_MAX_RETRIES = '0';
      const { gw, usage } = build(async () => {
        throw unavailable();
      });
      await fail(gw, 3);
      usage.record.mockClear();

      await gw.complete(req);

      expect(usage.record).toHaveBeenCalledWith(expect.objectContaining({ engineId: 5, failed: true, stub: true }));
    });

    it('lets ONE probe through after the open window; success closes it', async () => {
      process.env.AI_MAX_RETRIES = '0';
      const behaviour = { fail: true };
      const { gw, anthropic, advance } = build(async () => {
        if (behaviour.fail) throw unavailable();
        return ok;
      });
      await fail(gw, 3);
      expect(gw.breakerSnapshots()[0].state).toBe('open');

      advance(30_000);
      behaviour.fail = false;
      const probe = await gw.complete(req);

      expect(probe.degraded).toBeUndefined();
      expect(anthropic.complete).toHaveBeenCalledTimes(4);
      expect(gw.breakerSnapshots()[0].state).toBe('closed');
      expect((await gw.complete(req)).degraded).toBeUndefined();
    });

    it('a failed probe re-opens it', async () => {
      process.env.AI_MAX_RETRIES = '0';
      const { gw, anthropic, advance } = build(async () => {
        throw unavailable();
      });
      await fail(gw, 3);
      advance(30_000);

      const probe = await gw.complete(req);

      expect(probe.degraded).toBe(true);
      expect(anthropic.complete).toHaveBeenCalledTimes(4);
      expect(gw.breakerSnapshots()[0].state).toBe('open');
      await gw.complete(req);
      expect(anthropic.complete).toHaveBeenCalledTimes(4); // skipped again
    });

    it('request-level rejections (400) never open it, however many arrive', async () => {
      const { gw, anthropic } = build(async () => {
        throw new ProviderHttpError('Anthropic API error 400: invalid_request_error: bad', 400);
      });
      await fail(gw, 6);

      expect(anthropic.complete).toHaveBeenCalledTimes(6);
      expect(gw.breakerSnapshots()[0].state).toBe('closed');
    });

    it('can be switched off (AI_BREAKER_ENABLED=0): every call reaches the engine', async () => {
      process.env.AI_BREAKER_ENABLED = '0';
      process.env.AI_MAX_RETRIES = '0';
      const { gw, anthropic } = build(async () => {
        throw unavailable();
      });
      await fail(gw, 8);

      expect(anthropic.complete).toHaveBeenCalledTimes(8);
      expect(gw.breakerSnapshots()).toEqual([]);
    });

    it('is per engine: one dead engine does not stop another', async () => {
      process.env.AI_MAX_RETRIES = '0';
      const { gw, anthropic } = build(async () => {
        throw unavailable();
      });
      await fail(gw, 3);
      // Route the same function to a different engine id.
      (gw as unknown as { engineRepo: { findOne: jest.Mock } }).engineRepo.findOne.mockResolvedValue({ ...ENGINE, id: '6' });
      (gw as unknown as { settingRepo: { findOne: jest.Mock } }).settingRepo.findOne.mockResolvedValue({ tenantId: 4, func: 'rag', engineId: 6, paramsJson: null });

      await gw.complete(req);

      expect(anthropic.complete).toHaveBeenCalledTimes(4); // engine 6 was tried
    });
  });

  describe('moderation stays fail-safe while the engine is degraded', () => {
    it('blocks when the context classifier runs against an open breaker', async () => {
      process.env.AI_MAX_RETRIES = '0';
      const { gw } = build(async () => {
        throw unavailable();
      });
      await Array.from({ length: 3 }).reduce<Promise<unknown>>((p) => p.then(() => gw.complete(req)), Promise.resolve());
      expect(gw.breakerSnapshots()[0].state).toBe('open');

      const ruleRepo = { find: jest.fn(async () => [{ id: 9, tenantId: 4, scope: 'both', type: 'context', patternOrPrompt: 'unsafe', action: 'block', isActive: 1 }]) };
      const logRepo = { create: jest.fn((x) => x), save: jest.fn(async (x) => x) };
      const redis = { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() };
      // Moderation resolves the engine for function 'moderation'; point the shared fixture at it.
      (gw as unknown as { settingRepo: { findOne: jest.Mock } }).settingRepo.findOne.mockResolvedValue({ tenantId: 4, func: 'moderation', engineId: 5, paramsJson: null });
      const moderation = new ModerationService(ruleRepo as never, logRepo as never, gw, redis as never);

      const res = await moderation.moderate({ tenantId: 4, scope: 'ai', authorType: 'ai', text: 'a perfectly fine answer' });

      // The stub's canned "not flagged" must NOT stand in for the real classifier.
      expect(res.decision).toBe(MODERATION_DECISION.BLOCKED);
    });
  });

  describe('embeddings', () => {
    beforeEach(() => {
      process.env.VOYAGE_API_KEY = 'k';
    });

    it('a stalled Voyage query falls back to the stub embedder', async () => {
      const { gw, stub } = build(async () => ok, async () => {
        throw new AiTimeoutError('Voyage', 8_000);
      });

      const res = await gw.embed(['hello'], 'query');

      expect(res.provider).toBe('stub');
      expect(stub.embed).toHaveBeenCalledTimes(1);
      expect(m.embedFailures.get({ provider: 'voyage', reason: 'timeout' })).toBe(1);
    });

    it('retries a transient query failure once before falling back', async () => {
      const embed = jest
        .fn()
        .mockRejectedValueOnce(new ProviderHttpError('Voyage API error 503', 503))
        .mockResolvedValueOnce({ vectors: [[1]], tokensIn: 1, provider: 'voyage', model: 'voyage-4', dimension: 1 });
      const { gw, voyage } = build(async () => ok, embed);

      const res = await gw.embed(['hello'], 'query');

      expect(res.provider).toBe('voyage');
      expect(voyage.embed).toHaveBeenCalledTimes(2);
    });

    it('stops calling a dead Voyage for live queries once the breaker opens', async () => {
      process.env.EMBED_QUERY_RETRIES = '0';
      const { gw, voyage, stub } = build(async () => ok, async () => {
        throw new AiTimeoutError('Voyage', 8_000);
      });
      for (let i = 0; i < 3; i++) await gw.embed(['q'], 'query');
      expect(voyage.embed).toHaveBeenCalledTimes(3);

      const res = await gw.embed(['q'], 'query');

      expect(voyage.embed).toHaveBeenCalledTimes(3); // skipped
      expect(res.provider).toBe('stub');
      expect(stub.embed).toHaveBeenCalledTimes(4);
      expect(m.embedFailures.get({ provider: 'voyage', reason: 'breaker_open' })).toBe(1);
    });

    it('does not short-circuit KB document embeddings (they must not become stub vectors)', async () => {
      process.env.EMBED_QUERY_RETRIES = '0';
      process.env.EMBED_DOCUMENT_RETRIES = '0';
      const { gw, voyage } = build(async () => ok, async () => {
        throw new AiTimeoutError('Voyage', 8_000);
      });
      for (let i = 0; i < 3; i++) await gw.embed(['q'], 'query');

      await gw.embed(['a document'], 'document');

      expect(voyage.embed).toHaveBeenCalledTimes(4); // the document call still tried Voyage
    });

    it('retries a document batch on a timeout too, up to the document retry budget', async () => {
      process.env.EMBED_DOCUMENT_RETRIES = '2';
      const { gw, voyage } = build(async () => ok, async () => {
        throw new AiTimeoutError('Voyage', 8_000);
      });

      await gw.embed(['a', 'b'], 'document');

      expect(voyage.embed).toHaveBeenCalledTimes(3);
    });
  });
});

describe('VoyageAdapter — deadline', () => {
  it('aborts a stalled embedding request at the per-request deadline', async () => {
    process.env.VOYAGE_API_KEY = 'k';
    global.fetch = jest.fn(
      (_url: unknown, init: { signal: AbortSignal }) =>
        new Promise((_res, rej) => {
          init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
    ) as unknown as typeof fetch;

    await expect(new VoyageAdapter().embed({ texts: ['q'], inputType: 'query', timeoutMs: 30 })).rejects.toBeInstanceOf(AiTimeoutError);
  });

  it('throws a typed HTTP error whose message keeps the old shape', async () => {
    process.env.VOYAGE_API_KEY = 'k';
    global.fetch = jest.fn(async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;

    const err = await new VoyageAdapter().embed({ texts: ['q'], inputType: 'query' }).catch((e) => e);

    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err.message).toBe('Voyage API error 503');
    expect(err.status).toBe(503);
  });
});
