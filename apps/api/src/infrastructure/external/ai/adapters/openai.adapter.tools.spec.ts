import * as http from 'http';
import { AddressInfo } from 'net';
import { OpenAiAdapter } from './openai.adapter';
import type { AiRequestMessage, AiToolDef } from '../ai-adapter.interface';

/**
 * PLN-261012 SG-33 — OpenAI Chat Completions parity for tool calling, against a local fake that
 * answers in the documented `tool_calls` shape. Verified against the FAKE only: real OpenAI (or an
 * OpenAI-compatible endpoint) has not been called, which is why the gateway additionally requires the
 * engine row to declare the `tools` capability.
 */
describe('OpenAiAdapter — tool calling', () => {
  let server: http.Server;
  let url = '';
  let lastBody: any = null;
  let reply: any = {};
  const adapter = new OpenAiAdapter();

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        lastBody = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/chat/completions`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const tools: AiToolDef[] = [
    { name: 'lookup_rates', description: 'Read-only rates.', inputSchema: { type: 'object', properties: { date: { type: 'string' } } } },
  ];
  const call = (over: Record<string, unknown>) =>
    adapter.complete({ model: 'gpt-fake', apiKey: 'k', endpoint: url, system: 'S', ...over } as never);

  const toolReply = (calls: unknown[], finish = 'tool_calls') => ({
    choices: [{ message: { role: 'assistant', content: null, tool_calls: calls }, finish_reason: finish }],
    usage: { prompt_tokens: 40, completion_tokens: 9 },
    model: 'gpt-fake-2026',
  });

  it('sends tools as function tools, after temperature; a plain request has no tools key', async () => {
    reply = { choices: [{ message: { content: 'x' }, finish_reason: 'stop' }], usage: {}, model: 'm' };
    await call({ messages: [{ role: 'user', content: 'q' }], tools, temperature: 0.2, maxTokens: 99 });
    expect(Object.keys(lastBody)).toEqual(['model', 'messages', 'max_completion_tokens', 'temperature', 'tools']);
    expect(lastBody.tools).toEqual([
      {
        type: 'function',
        function: { name: 'lookup_rates', description: 'Read-only rates.', parameters: { type: 'object', properties: { date: { type: 'string' } } } },
      },
    ]);

    await call({ messages: [{ role: 'user', content: 'q' }] });
    expect(lastBody).not.toHaveProperty('tools');
  });

  it('maps a tool turn: assistant tool_calls, one `tool` message per result (errors marked in the text)', async () => {
    reply = { choices: [{ message: { content: 'x' }, finish_reason: 'stop' }], usage: {}, model: 'm' };
    const messages: AiRequestMessage[] = [
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Checking.' },
          { type: 'tool_use', id: 'call_1', name: 'lookup_rates', input: { date: '2026-10-17' } },
          { type: 'tool_use', id: 'call_2', name: 'lookup_rates', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', toolUseId: 'call_1', content: 'DATA' },
          { type: 'tool_result', toolUseId: 'call_2', content: 'invalid arguments', isError: true },
        ],
      },
    ];
    await call({ messages, tools });

    expect(lastBody.messages).toEqual([
      { role: 'system', content: 'S' },
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: 'Checking.',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'lookup_rates', arguments: '{"date":"2026-10-17"}' } },
          { id: 'call_2', type: 'function', function: { name: 'lookup_rates', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'DATA' },
      { role: 'tool', tool_call_id: 'call_2', content: 'ERROR: invalid arguments' },
    ]);
  });

  it('an assistant turn with only tool uses has null content (the API rejects an empty string alongside tool_calls)', async () => {
    reply = { choices: [{ message: { content: 'x' }, finish_reason: 'stop' }], usage: {}, model: 'm' };
    await call({
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'c', name: 'lookup_rates', input: {} }] },
        { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c', content: 'r' }] },
      ],
      tools,
    });
    expect(lastBody.messages[2]).toMatchObject({ role: 'assistant', content: null });
  });

  it('parses tool_calls (arguments are a JSON STRING) and the finish reason', async () => {
    reply = toolReply([
      { id: 'call_a', type: 'function', function: { name: 'lookup_rates', arguments: '{"date":"2026-10-17"}' } },
      { id: 'call_b', type: 'function', function: { name: 'lookup_rates', arguments: '' } },
    ]);
    const res = await call({ messages: [{ role: 'user', content: 'q' }], tools });

    expect(res).toEqual({
      text: '',
      tokensIn: 40,
      tokensOut: 9,
      provider: 'openai',
      model: 'gpt-fake-2026',
      toolUses: [
        { id: 'call_a', name: 'lookup_rates', input: { date: '2026-10-17' } },
        { id: 'call_b', name: 'lookup_rates', input: {} },
      ],
      stopReason: 'tool_use',
    });
  });

  it('arguments that are not JSON, or not an object, are flagged and never passed on', async () => {
    reply = toolReply([
      { id: 'c1', type: 'function', function: { name: 'lookup_rates', arguments: '{not json' } },
      { id: 'c2', type: 'function', function: { name: 'lookup_rates', arguments: '[1,2]' } },
    ]);
    const res = await call({ messages: [{ role: 'user', content: 'q' }], tools });
    expect(res.toolUses).toEqual([
      { id: 'c1', name: 'lookup_rates', input: {}, inputError: 'input_not_json' },
      { id: 'c2', name: 'lookup_rates', input: {}, inputError: 'input_not_object' },
    ]);
  });

  it.each([
    ['stop', 'end_turn'],
    ['tool_calls', 'tool_use'],
    ['length', 'max_tokens'],
    ['content_filter', 'refusal'],
    ['something_new', 'other'],
  ])('finish_reason %s -> %s', async (finish, expected) => {
    reply = { choices: [{ message: { content: 'x' }, finish_reason: finish }], usage: {}, model: 'm' };
    const res = await call({ messages: [{ role: 'user', content: 'q' }], tools });
    expect(res.stopReason).toBe(expected);
    expect(res.toolUses).toBeUndefined();
  });

  it('declares tool support (the gateway still needs the engine row to say `tools`)', () => {
    expect(adapter.supportsTools).toBe(true);
  });
});
