import { AnthropicAdapter } from './anthropic.adapter';
import { AiTimeoutError, ProviderHttpError } from '../../../resilience/resilience';
import {
  FakeAnthropicServer,
  endTurn,
  fakeText,
  fakeToolUse,
  protocolViolations,
  toolCalls,
} from '../testing/fake-anthropic.server';
import type { AiRequestMessage, AiToolDef } from '../ai-adapter.interface';

/**
 * PLN-261012 SG-33 — the real AnthropicAdapter against a local fake of the Messages API (real HTTP,
 * strict about the tool_use / tool_result pairing rules). Verified against the FAKE only.
 */
describe('AnthropicAdapter — native tool calling', () => {
  let fake: FakeAnthropicServer;
  const adapter = new AnthropicAdapter();

  beforeAll(async () => {
    fake = await new FakeAnthropicServer(() => endTurn()).start();
  });
  afterAll(() => fake.stop());
  beforeEach(() => {
    fake.requests.length = 0;
    fake.setScript(() => endTurn());
  });

  const tools: AiToolDef[] = [
    {
      name: 'lookup_rates',
      description: 'Read-only rates.',
      inputSchema: { type: 'object', properties: { date: { type: 'string' } }, additionalProperties: false },
    },
  ];
  const base = { model: 'claude-fake', apiKey: 'k', endpoint: '', system: 'S', maxTokens: 300 };
  const call = (over: Record<string, unknown>) => adapter.complete({ ...base, endpoint: fake.url, ...over } as never);

  it('sends tools as `tools[].input_schema`, last in the body', async () => {
    await call({ messages: [{ role: 'user', content: 'q' }], tools });

    expect(fake.requests[0].raw).toBe(
      '{"model":"claude-fake","max_tokens":300,"system":"S","messages":[{"role":"user","content":"q"}],' +
        '"tools":[{"name":"lookup_rates","description":"Read-only rates.","input_schema":{"type":"object","properties":{"date":{"type":"string"}},"additionalProperties":false}}]}',
    );
  });

  it('an empty tools array is the same as none: no `tools` key, no extra result fields', async () => {
    const res = await call({ messages: [{ role: 'user', content: 'q' }], tools: [] });
    expect(fake.requests[0].body).not.toHaveProperty('tools');
    expect(res).not.toHaveProperty('stopReason');
    expect(res).not.toHaveProperty('toolUses');
  });

  it('a tool turn goes out as tool_use / tool_result blocks (is_error only when set)', async () => {
    const messages: AiRequestMessage[] = [
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'tu_1', name: 'lookup_rates', input: { date: '2026-10-17' } },
          { type: 'tool_use', id: 'tu_2', name: 'lookup_rates', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 'tu_1', content: 'DATA ...' },
          { type: 'tool_result', toolUseId: 'tu_2', content: 'invalid arguments', isError: true },
        ],
      },
    ];
    await call({ messages, tools });

    expect(fake.requests[0].body.messages).toEqual([
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'tu_1', name: 'lookup_rates', input: { date: '2026-10-17' } },
          { type: 'tool_use', id: 'tu_2', name: 'lookup_rates', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: 'DATA ...' },
          { type: 'tool_result', tool_use_id: 'tu_2', content: 'invalid arguments', is_error: true },
        ],
      },
    ]);
    // (and the fake accepted it: pairing rules hold)
    expect(protocolViolations(fake.requests[0].body)).toEqual([]);
  });

  it('parses text + parallel tool_use blocks and the stop reason', async () => {
    fake.setScript(() =>
      toolCalls(
        [fakeText('Looking '), fakeText('up.'), fakeToolUse('tu_a', 'lookup_rates', { date: '2026-10-17' }), fakeToolUse('tu_b', 'lookup_rates', {})],
        { input_tokens: 77, output_tokens: 33 },
      ),
    );
    const res = await call({ messages: [{ role: 'user', content: 'q' }], tools });

    expect(res).toEqual({
      text: 'Looking up.',
      tokensIn: 77,
      tokensOut: 33,
      provider: 'anthropic',
      model: 'claude-fake',
      toolUses: [
        { id: 'tu_a', name: 'lookup_rates', input: { date: '2026-10-17' } },
        { id: 'tu_b', name: 'lookup_rates', input: {} },
      ],
      stopReason: 'tool_use',
    });
  });

  it.each([
    ['end_turn', 'end_turn'],
    ['stop_sequence', 'end_turn'],
    ['tool_use', 'tool_use'],
    ['max_tokens', 'max_tokens'],
    ['refusal', 'refusal'],
    ['pause_turn', 'other'],
  ])('stop_reason %s is reported as %s', async (raw, expected) => {
    fake.setScript(() => ({ content: [fakeText('x')], stop_reason: raw }));
    const res = await call({ messages: [{ role: 'user', content: 'q' }], tools });
    expect(res.stopReason).toBe(expected);
  });

  it('a tool_use whose input is not an object is flagged, never passed on as arguments', async () => {
    fake.setScript(() => toolCalls([fakeToolUse('tu_1', 'lookup_rates', 'oops')]));
    const res = await call({ messages: [{ role: 'user', content: 'q' }], tools });
    expect(res.toolUses).toEqual([{ id: 'tu_1', name: 'lookup_rates', input: {}, inputError: 'input_not_object' }]);
  });

  it('a final reply without tool use has no toolUses', async () => {
    fake.setScript(() => endTurn('DONE'));
    const res = await call({ messages: [{ role: 'user', content: 'q' }], tools });
    expect(res.text).toBe('DONE');
    expect(res.toolUses).toBeUndefined();
    expect(res.stopReason).toBe('end_turn');
  });

  it('the fake is strict: an assistant tool_use with no tool_result in the next turn is a provider 400, surfaced as such', async () => {
    const broken: AiRequestMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'lookup_rates', input: {} }] },
      { role: 'user', content: 'and then?' },
    ];
    await expect(call({ messages: broken, tools })).rejects.toMatchObject({
      status: 400,
      message: expect.stringContaining('tool_use id "tu_1" has no tool_result'),
    });
  });

  it('a provider 5xx is a ProviderHttpError with its status (the gateway degrades on it)', async () => {
    fake.setScript(() => ({ status: 529, error: { type: 'overloaded_error', message: 'Overloaded' } }));
    const err = await call({ messages: [{ role: 'user', content: 'q' }], tools }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderHttpError);
    expect(err.status).toBe(529);
  });

  it('keeps the whole-call deadline with tools: a provider that never answers is aborted', async () => {
    fake.setScript(() => ({ hang: true }));
    const started = Date.now();
    const err = await call({ messages: [{ role: 'user', content: 'q' }], tools, timeoutMs: 80 }).catch((e) => e);
    expect(err).toBeInstanceOf(AiTimeoutError);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
