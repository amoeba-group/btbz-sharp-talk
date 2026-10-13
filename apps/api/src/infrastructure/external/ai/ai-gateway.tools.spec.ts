import { AiGatewayService, ENGINE_CAPABILITY_TOOLS, engineHasCapability } from './ai-gateway.service';
import { StubAdapter } from './adapters/stub.adapter';
import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { ProviderHttpError } from '../../resilience/resilience';
import { m, metrics } from '../../observability/app-metrics';
import type { AiToolDef } from './ai-adapter.interface';

/**
 * PLN-261012 SG-33 — what the gateway adds for tool calling, and what it must never do: hand a tools
 * request to an engine that cannot use tools, or let the stub stand in for a failed engine as if it
 * had made (or answered) a tool call.
 */
describe('AiGatewayService — tools', () => {
  const tools: AiToolDef[] = [{ name: 'lookup_rates', description: 'd', inputSchema: { type: 'object', properties: {} } }];
  const engineRow = (over: Record<string, unknown> = {}) => ({
    id: '5',
    tenantId: 4,
    provider: 'anthropic',
    model: 'claude-fake',
    endpoint: null,
    apiKeyEncrypted: null,
    status: 'enabled',
    isDefault: 1,
    capabilities: 'chat,rag,summary,assist,moderation,tools',
    ...over,
  });

  function build(engine: Record<string, unknown> | null, adapterComplete?: (...a: unknown[]) => Promise<unknown>) {
    const engineRepo = { findOne: jest.fn(async () => engine), update: jest.fn(async () => undefined) };
    const settingRepo = { findOne: jest.fn(async () => (engine ? { tenantId: 4, func: 'rag', engineId: 5, paramsJson: null } : null)) };
    const stub = new StubAdapter();
    const anthropic = {
      provider: 'anthropic',
      supportsTools: true,
      complete: jest.fn(adapterComplete ?? (async () => ({ text: '', tokensIn: 3, tokensOut: 4, provider: 'anthropic', model: 'claude-fake', stopReason: 'end_turn' }))),
    };
    const usage = { record: jest.fn(async () => undefined) };
    const gw = new AiGatewayService(
      engineRepo as never,
      settingRepo as never,
      stub,
      anthropic as never,
      { provider: 'openai', supportsTools: true, complete: jest.fn() } as never,
      { provider: 'voyage', complete: jest.fn(), embed: jest.fn() } as never,
      usage as never,
    );
    gw.hooks.sleep = async () => undefined;
    gw.hooks.random = () => 0;
    return { gw, stub, anthropic, usage, engineRepo };
  }

  const req = { tenantId: 4, function: 'rag' as never, feature: 'partner_tool_loop', messages: [{ role: 'user' as const, content: 'q' }] };
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved };
    process.env.AI_MAX_RETRIES = '0';
    process.env.AI_BREAKER_FAILURE_THRESHOLD = '2';
    delete process.env.AI_BREAKER_ENABLED;
    metrics.reset();
  });
  afterAll(() => {
    process.env = saved;
  });

  describe('toolSupport', () => {
    it('is supported only with a tool-capable adapter AND the `tools` capability on the engine row', async () => {
      expect(await build(engineRow()).gw.toolSupport(4, 'rag' as never)).toEqual({ supported: true, reason: 'ok', provider: 'anthropic', engineId: 5 });
    });

    it('no engine row, a stub engine, a provider without an adapter, or a row without the capability: not supported, each with its reason', async () => {
      expect((await build(null).gw.toolSupport(4, 'rag' as never)).reason).toBe('no_engine');
      expect((await build(engineRow({ provider: 'stub' })).gw.toolSupport(4, 'rag' as never)).reason).toBe('adapter_unsupported');
      expect((await build(engineRow({ provider: 'custom' })).gw.toolSupport(4, 'rag' as never)).reason).toBe('adapter_unsupported');
      expect((await build(engineRow({ capabilities: 'chat,rag' })).gw.toolSupport(4, 'rag' as never)).reason).toBe('capability_missing');
      expect((await build(engineRow({ capabilities: '' })).gw.toolSupport(4, 'rag' as never)).reason).toBe('capability_missing');
    });

    it('an adapter written before tools existed (no `supportsTools`) is never handed tools', async () => {
      const b = build(engineRow());
      (b.anthropic as { supportsTools?: boolean }).supportsTools = undefined;
      expect((await b.gw.toolSupport(4, 'rag' as never)).reason).toBe('adapter_unsupported');
    });

    it('capability parsing tolerates spacing and case; a near-miss does not count', () => {
      expect(engineHasCapability('chat, TOOLS ,rag', ENGINE_CAPABILITY_TOOLS)).toBe(true);
      expect(engineHasCapability('chat,toolset,rag', ENGINE_CAPABILITY_TOOLS)).toBe(false);
      expect(engineHasCapability(null, ENGINE_CAPABILITY_TOOLS)).toBe(false);
    });

    it('is pure routing: no provider call and no health write', async () => {
      const b = build(engineRow());
      await b.gw.toolSupport(4, 'rag' as never);
      expect(b.anthropic.complete).not.toHaveBeenCalled();
      expect(b.engineRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('a tools request to an engine that cannot use tools is refused', () => {
    it.each([
      ['a stub engine', engineRow({ provider: 'stub' })],
      ['an Anthropic row without the capability', engineRow({ capabilities: 'chat,rag' })],
      ['no engine at all', null],
    ])('%s: nothing is sent, nothing is metered, the result is degraded + toolsRefused', async (_label, engine) => {
      const b = build(engine);
      const stubComplete = jest.spyOn(b.stub, 'complete');

      const res = await b.gw.complete({ ...req, tools });

      expect(res).toMatchObject({ text: '', degraded: true, toolsRefused: true, tokensIn: 0, tokensOut: 0 });
      expect(res.toolUses).toBeUndefined();
      expect(b.anthropic.complete).not.toHaveBeenCalled();
      expect(stubComplete).not.toHaveBeenCalled(); // not even the stub answers
      expect(b.usage.record).not.toHaveBeenCalled();
    });

    it('the same engines still serve a PLAIN request exactly as before', async () => {
      const b = build(engineRow({ capabilities: 'chat,rag' }));
      const res = await b.gw.complete(req);
      expect(res.degraded).toBeUndefined();
      expect(b.anthropic.complete).toHaveBeenCalledTimes(1);
    });
  });

  describe('a tool-capable engine', () => {
    it('the adapter receives the tools; its tool uses and stop reason come back; the call is metered once', async () => {
      const b = build(engineRow(), async () => ({
        text: 'ok',
        tokensIn: 11,
        tokensOut: 5,
        provider: 'anthropic',
        model: 'claude-fake',
        toolUses: [{ id: 'tu_1', name: 'lookup_rates', input: {} }],
        stopReason: 'tool_use',
      }));

      const res = await b.gw.complete({ ...req, tools });

      expect(b.anthropic.complete.mock.calls[0][0]).toMatchObject({ tools });
      expect(res.toolUses).toEqual([{ id: 'tu_1', name: 'lookup_rates', input: {} }]);
      expect(res.stopReason).toBe('tool_use');
      expect(res.degraded).toBeUndefined();
      expect(b.usage.record).toHaveBeenCalledTimes(1);
      expect(b.usage.record).toHaveBeenCalledWith(expect.objectContaining({ feature: 'partner_tool_loop', tokensIn: 11, tokensOut: 5 }));
    });

    it('a plain request carries NO `tools` key to the adapter (not even undefined)', async () => {
      const b = build(engineRow());
      await b.gw.complete(req);
      expect('tools' in (b.anthropic.complete.mock.calls[0][0] as object)).toBe(false);
    });

    it('a transient provider failure is retried once, like any completion (idempotent: no tool ran yet)', async () => {
      process.env.AI_MAX_RETRIES = '1';
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new ProviderHttpError('Anthropic API error 529: overloaded', 529))
        .mockResolvedValueOnce({ text: 'ok', tokensIn: 1, tokensOut: 1, provider: 'anthropic', model: 'm', stopReason: 'end_turn' });
      const b = build(engineRow(), fn);

      const res = await b.gw.complete({ ...req, tools });

      expect(b.anthropic.complete).toHaveBeenCalledTimes(2);
      expect(res.degraded).toBeUndefined();
      expect(m.llmRetries.get({ provider: 'anthropic' })).toBe(1);
    });
  });

  describe('a failing engine is never covered by invented tool calls', () => {
    it('provider error mid-loop: the stub is called WITHOUT tools and, even scripted to call a tool, returns none', async () => {
      const b = build(engineRow(), async () => {
        throw new ProviderHttpError('Anthropic API error 503: overloaded', 503);
      });
      // A stub that WOULD return a tool call if it were ever handed tools.
      b.stub.toolScript = () => ({ toolUses: [{ id: 'invented', name: 'lookup_rates', input: {} }] });
      const stubComplete = jest.spyOn(b.stub, 'complete');

      const res = await b.gw.complete({
        ...req,
        tools,
        messages: [
          { role: 'user', content: 'q' },
          { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'lookup_rates', input: {} }] },
          { role: 'user', content: [{ type: 'tool_result', toolUseId: 'tu_1', content: 'DATA 475.000' }] },
        ],
      });

      expect(res.degraded).toBe(true);
      expect(res.toolUses).toBeUndefined();
      expect(res.toolsRefused).toBeUndefined();
      expect(stubComplete).toHaveBeenCalledTimes(1);
      expect(stubComplete.mock.calls[0][0]).not.toHaveProperty('tools');
      // The failure is on the books against the engine that should have answered.
      expect(b.usage.record).toHaveBeenCalledWith(expect.objectContaining({ engineId: 5, stub: true, failed: true }));
    });

    it('an open breaker also degrades a tools request without touching the provider', async () => {
      const b = build(engineRow(), async () => {
        throw new ProviderHttpError('Anthropic API error 503: overloaded', 503);
      });
      await b.gw.complete({ ...req, tools });
      await b.gw.complete({ ...req, tools }); // threshold 2 -> open
      b.anthropic.complete.mockClear();

      const res = await b.gw.complete({ ...req, tools });

      expect(b.anthropic.complete).not.toHaveBeenCalled();
      expect(res.degraded).toBe(true);
      expect(res.toolUses).toBeUndefined();
    });
  });

  describe('real Anthropic adapter, real gateway: a plain request is unchanged on the wire', () => {
    it('the adapter body for a gateway request without tools has no tools and the classic message shape', async () => {
      const { FakeAnthropicServer, endTurn } = await import('./testing/fake-anthropic.server');
      const fake = await new FakeAnthropicServer(() => endTurn('hi')).start();
      process.env.ANTHROPIC_API_KEY = 'k';
      try {
        const adapter = new AnthropicAdapter();
        const engine = engineRow({ endpoint: fake.url });
        const b = build(engine, (...a: unknown[]) => adapter.complete(...(a as [never])));
        await b.gw.complete({ ...req, system: 'S', messages: [{ role: 'user', content: 'plain' }] });
        expect(fake.requests[0].body).toEqual({
          model: 'claude-fake',
          max_tokens: 1024,
          system: 'S',
          messages: [{ role: 'user', content: 'plain' }],
        });
      } finally {
        await fake.stop();
      }
    });
  });
});
