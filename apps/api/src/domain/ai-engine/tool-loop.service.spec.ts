import { ToolLoopService, toolLoopLimitsFromEnv } from './tool-loop.service';
import type { ToolExecution, ToolLoopRequest } from './tool-loop.service';
import type { AiCompletionResult, AiToolDef } from '../../infrastructure/external/ai/ai-adapter.interface';

/**
 * PLN-261012 SG-33 — the generic model <-> tools loop, with a scripted gateway (no network).
 * The partner-specific properties are covered end to end in partner-data.step.tools.spec.ts.
 */
describe('ToolLoopService', () => {
  const tools: AiToolDef[] = [{ name: 'echo', description: 'd', inputSchema: { type: 'object', properties: {} } }];
  const OK_SUPPORT = { supported: true, reason: 'ok', provider: 'anthropic', engineId: 1 };

  const result = (over: Partial<AiCompletionResult> = {}): AiCompletionResult => ({
    text: '',
    tokensIn: 10,
    tokensOut: 2,
    provider: 'anthropic',
    model: 'm',
    ...over,
  });
  const asks = (...calls: Array<[string, string, Record<string, unknown>?]>): AiCompletionResult =>
    result({
      text: 'thinking',
      toolUses: calls.map(([id, name, input]) => ({ id, name, input: input ?? {} })),
      stopReason: 'tool_use',
    });
  const done = (text = 'DONE'): AiCompletionResult => result({ text, stopReason: 'end_turn', tokensIn: 7, tokensOut: 1 });

  const build = (replies: Array<AiCompletionResult | Error>, support = OK_SUPPORT) => {
    let i = 0;
    const gateway = {
      toolSupport: jest.fn(async () => support),
      complete: jest.fn(async (_req: Record<string, any>) => {
        const r = replies[Math.min(i++, replies.length - 1)];
        if (r instanceof Error) throw r;
        return r;
      }),
    };
    return { svc: new ToolLoopService(gateway as never), gateway };
  };

  const req = (execute: ToolLoopRequest['execute'], over: Partial<ToolLoopRequest> = {}): ToolLoopRequest => ({
    tenantId: 1,
    function: 'rag' as never,
    feature: 'test_loop',
    system: 'SYS',
    messages: [{ role: 'user', content: 'q' }],
    tools,
    execute,
    ...over,
  });
  const ok = (content = 'result'): ToolExecution => ({ kind: 'ok', content });

  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('a model that asks for nothing completes after one call', async () => {
    const { svc, gateway } = build([done('all good')]);
    const execute = jest.fn();
    const out = await svc.run(req(execute));

    expect(out).toMatchObject({ status: 'completed', iterations: 1, toolCalls: 0, finalText: 'all good', usage: { tokensIn: 7, tokensOut: 1 } });
    expect(execute).not.toHaveBeenCalled();
    expect(gateway.complete.mock.calls[0][0]).toMatchObject({ tenantId: 1, function: 'rag', feature: 'test_loop', system: 'SYS', tools });
  });

  it('executes a call, feeds the result back in the provider-neutral block shape, and sums tokens across iterations', async () => {
    const { svc, gateway } = build([asks(['a', 'echo', { x: 1 }]), done()]);
    const execute = jest.fn(async () => ok('RES'));

    const out = await svc.run(req(execute));

    expect(execute).toHaveBeenCalledWith({ id: 'a', name: 'echo', input: { x: 1 } }, expect.objectContaining({ iteration: 1 }));
    expect(gateway.complete.mock.calls[1][0].messages).toEqual([
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'thinking' },
          { type: 'tool_use', id: 'a', name: 'echo', input: { x: 1 } },
        ],
      },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'a', content: 'RES' }] },
    ]);
    expect(out).toMatchObject({ status: 'completed', iterations: 2, toolCalls: 1, usage: { tokensIn: 17, tokensOut: 3 } });
    expect(out.calls).toEqual([{ name: 'echo', iteration: 1, outcome: 'ok' }]);
  });

  it('does not mutate the caller\'s starting messages', async () => {
    const { svc } = build([asks(['a', 'echo']), done()]);
    const messages = [{ role: 'user' as const, content: 'q' }];
    await svc.run(req(async () => ok(), { messages }));
    expect(messages).toEqual([{ role: 'user', content: 'q' }]);
  });

  it('calls of one response run IN ORDER, one at a time', async () => {
    const { svc } = build([asks(['a', 'echo'], ['b', 'echo'], ['c', 'echo']), done()]);
    const order: string[] = [];
    let running = 0;
    let maxRunning = 0;
    await svc.run(
      req(async (call) => {
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 5));
        order.push(call.id);
        running--;
        return ok(call.id);
      }),
    );
    expect(order).toEqual(['a', 'b', 'c']);
    expect(maxRunning).toBe(1);
  });

  it('the FIRST abort cancels the remaining calls of the turn and no further model call is made', async () => {
    const { svc, gateway } = build([asks(['a', 'echo'], ['b', 'echo'], ['c', 'echo']), done()]);
    const execute = jest.fn(async (call: { id: string }) => (call.id === 'b' ? ({ kind: 'abort', detail: 'boom' } as ToolExecution) : ok()));

    const out = await svc.run(req(execute));

    expect(execute).toHaveBeenCalledTimes(2); // a, b — never c
    expect(gateway.complete).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ status: 'aborted', reason: 'tool_aborted', detail: 'boom' });
    expect(out.calls).toEqual([
      { name: 'echo', iteration: 1, outcome: 'ok' },
      { name: 'echo', iteration: 1, outcome: 'abort' },
      { name: 'echo', iteration: 1, outcome: 'skipped' },
    ]);
  });

  it('a tool that THROWS aborts the loop (the error is the detail), it does not escape', async () => {
    const { svc } = build([asks(['a', 'echo']), done()]);
    const out = await svc.run(req(async () => Promise.reject(new Error('kaboom'))));
    expect(out).toMatchObject({ status: 'aborted', reason: 'tool_aborted' });
    expect((out.detail as Error).message).toBe('kaboom');
  });

  it('a retryable failure goes back as an ERROR result and the loop continues', async () => {
    const { svc, gateway } = build([asks(['a', 'echo']), asks(['b', 'echo']), done()]);
    const execute = jest.fn(async (call: { id: string }) => (call.id === 'a' ? ({ kind: 'retry', content: 'bad args' } as ToolExecution) : ok('fine')));

    const out = await svc.run(req(execute));

    const second = gateway.complete.mock.calls[1][0].messages.at(-1);
    expect(second).toEqual({ role: 'user', content: [{ type: 'tool_result', toolUseId: 'a', content: 'bad args', isError: true }] });
    expect(out).toMatchObject({ status: 'completed', toolCalls: 2 });
    expect(out.calls.map((c) => c.outcome)).toEqual(['retry', 'ok']);
  });

  it('arguments the provider could not give as an object are answered as an error and NEVER executed', async () => {
    const { svc, gateway } = build([
      result({ toolUses: [{ id: 'a', name: 'echo', input: {}, inputError: 'input_not_json' }], stopReason: 'tool_use' }),
      done(),
    ]);
    const execute = jest.fn();

    await svc.run(req(execute));

    expect(execute).not.toHaveBeenCalled();
    expect(gateway.complete.mock.calls[1][0].messages.at(-1)).toEqual({
      role: 'user',
      content: [{ type: 'tool_result', toolUseId: 'a', content: 'invalid arguments: input_not_json', isError: true }],
    });
  });

  describe('limits', () => {
    it('iteration limit: still asking at the last allowed iteration aborts, and its calls are not executed', async () => {
      const { svc, gateway } = build([asks(['a', 'echo'])]);
      const execute = jest.fn(async () => ok());

      const out = await svc.run(req(execute, { maxIterations: 3 }));

      expect(gateway.complete).toHaveBeenCalledTimes(3);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(out).toMatchObject({ status: 'aborted', reason: 'iteration_limit', iterations: 3 });
    });

    it('call limit counts across iterations and is checked BEFORE any call of the response runs', async () => {
      const { svc } = build([asks(['a', 'echo']), asks(['b', 'echo'], ['c', 'echo'])]);
      const execute = jest.fn(async () => ok());

      const out = await svc.run(req(execute, { maxToolCalls: 2 }));

      expect(execute).toHaveBeenCalledTimes(1); // 'a'; the second response (1 + 2 > 2) ran nothing
      expect(out).toMatchObject({ status: 'aborted', reason: 'tool_call_limit', toolCalls: 1 });
    });

    it('time budget: each model call is capped by what is left, and a tool that overruns ends the loop', async () => {
      const { svc, gateway } = build([asks(['a', 'echo']), done()]);

      const out = await svc.run(req(() => new Promise(() => undefined), { budgetMs: 120 }));

      expect(out).toMatchObject({ status: 'aborted', reason: 'time_budget' });
      expect(gateway.complete.mock.calls[0][0].timeoutMs).toBeLessThanOrEqual(120);
      expect(gateway.complete).toHaveBeenCalledTimes(1);
    });

    it('an already-spent budget stops before the next model call', async () => {
      const { svc, gateway } = build([asks(['a', 'echo']), done()]);
      const out = await svc.run(req(async () => {
        await new Promise((r) => setTimeout(r, 40));
        return ok();
      }, { budgetMs: 25 }));
      expect(out.reason).toBe('time_budget');
      expect(gateway.complete).toHaveBeenCalledTimes(1);
    });

    it('defaults (3 / 4 / 20000 ms), env overrides and floors', () => {
      delete process.env.PARTNER_TOOLS_MAX_ITERATIONS;
      delete process.env.PARTNER_TOOLS_MAX_CALLS;
      delete process.env.PARTNER_TOOLS_BUDGET_MS;
      expect(toolLoopLimitsFromEnv()).toEqual({ maxIterations: 3, maxToolCalls: 4, budgetMs: 20_000 });
      process.env.PARTNER_TOOLS_MAX_ITERATIONS = '5';
      process.env.PARTNER_TOOLS_MAX_CALLS = '0';
      process.env.PARTNER_TOOLS_BUDGET_MS = '10';
      expect(toolLoopLimitsFromEnv()).toEqual({ maxIterations: 5, maxToolCalls: 1, budgetMs: 500 });
      process.env.PARTNER_TOOLS_MAX_ITERATIONS = '';
      expect(toolLoopLimitsFromEnv().maxIterations).toBe(3); // blank is "not configured", never zero
    });
  });

  describe('the engine', () => {
    it('does not start (no model call) when the engine cannot use tools', async () => {
      const { svc, gateway } = build([done()], { supported: false, reason: 'capability_missing', provider: 'anthropic', engineId: 1 });
      const out = await svc.run(req(jest.fn()));
      expect(out).toMatchObject({ status: 'aborted', reason: 'tools_unsupported', iterations: 0 });
      expect(gateway.complete).not.toHaveBeenCalled();
    });

    it('a degraded response (the stub stood in for a failed engine) aborts: its text and tokens are not used', async () => {
      const { svc } = build([asks(['a', 'echo']), result({ text: "Here's what I found", degraded: true, tokensIn: 5, tokensOut: 5 })]);
      const execute = jest.fn(async () => ok());

      const out = await svc.run(req(execute));

      expect(out).toMatchObject({ status: 'aborted', reason: 'engine_degraded', iterations: 2, usage: { tokensIn: 10, tokensOut: 2 } });
      expect(out.finalText).toBe('');
    });

    it('a refused tools request (the engine was switched mid-loop) is `tools_unsupported`, not an outage', async () => {
      const { svc } = build([result({ degraded: true, toolsRefused: true })]);
      expect((await svc.run(req(jest.fn()))).reason).toBe('tools_unsupported');
    });

    it('a gateway that throws is an engine error, never an unhandled rejection', async () => {
      const { svc } = build([new Error('bug')]);
      expect(await svc.run(req(jest.fn()))).toMatchObject({ status: 'aborted', reason: 'engine_error' });
    });

    it('a response cut off by max_tokens or refused is not a finished thought', async () => {
      expect((await build([result({ stopReason: 'max_tokens', text: 'half a sent' })]).svc.run(req(jest.fn()))).reason).toBe('truncated_response');
      expect((await build([result({ stopReason: 'refusal' })]).svc.run(req(jest.fn()))).reason).toBe('truncated_response');
    });

    it('tool uses on a response that did not stop for them are never executed', async () => {
      const execute = jest.fn();
      const cut = result({ toolUses: [{ id: 'a', name: 'echo', input: {} }], stopReason: 'max_tokens' });
      expect((await build([cut]).svc.run(req(execute))).reason).toBe('truncated_response');
      const odd = result({ toolUses: [{ id: 'a', name: 'echo', input: {} }], stopReason: 'end_turn' });
      expect((await build([odd]).svc.run(req(execute))).reason).toBe('malformed_response');
      const noId = result({ toolUses: [{ id: '', name: 'echo', input: {} }], stopReason: 'tool_use' });
      expect((await build([noId]).svc.run(req(execute))).reason).toBe('malformed_response');
      const dup = result({ toolUses: [{ id: 'x', name: 'echo', input: {} }, { id: 'x', name: 'echo', input: {} }], stopReason: 'tool_use' });
      expect((await build([dup]).svc.run(req(execute))).reason).toBe('malformed_response');
      expect(execute).not.toHaveBeenCalled();
    });
  });
});
