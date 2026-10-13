import * as http from 'http';
import { AddressInfo } from 'net';
import { AnthropicAdapter } from './anthropic.adapter';
import { OpenAiAdapter } from './openai.adapter';
import { StubAdapter } from './stub.adapter';

/**
 * PLN-261012 SG-33 — the adapter contract grew content blocks, tools, tool uses and a stop reason.
 * Every caller that existed before (string content, no tools) must be BYTE-IDENTICAL on the wire and
 * get a result of exactly the previous shape. These literals were captured from the adapters BEFORE
 * the tool-calling change; a diff here means a tenant that never uses tools changed behaviour.
 */
describe('adapters — wire format of plain (string-content, no-tools) requests is unchanged', () => {
  let server: http.Server;
  let url = '';
  let lastBody = '';
  let reply: unknown = {};

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        lastBody = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/messages`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const conversation = [
    { role: 'user' as const, content: 'Hi — "quoted" and unicode: giá qua đêm 425.000 ₫' },
    { role: 'assistant' as const, content: 'Yo' },
    { role: 'system' as const, content: 'dropped by both adapters' },
    { role: 'user' as const, content: 'Q?' },
  ];

  describe('Anthropic', () => {
    const adapter = new AnthropicAdapter();

    it('body is byte-identical (key order, system, filtered messages)', async () => {
      reply = {
        content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'there' }],
        usage: { input_tokens: 11, output_tokens: 7 },
        model: 'claude-x-2026',
        stop_reason: 'end_turn',
      };
      const res = await adapter.complete({
        system: 'You are Ivy.',
        messages: conversation,
        model: 'claude-x',
        apiKey: 'k',
        endpoint: url,
        maxTokens: 321,
        temperature: 0.3,
      });

      expect(lastBody).toBe(
        '{"model":"claude-x","max_tokens":321,"system":"You are Ivy.","messages":[' +
          '{"role":"user","content":"Hi — \\"quoted\\" and unicode: giá qua đêm 425.000 ₫"},' +
          '{"role":"assistant","content":"Yo"},{"role":"user","content":"Q?"}]}',
      );
      // Result shape: no `stopReason` / `toolUses` unless the request carried tools.
      expect(res).toStrictEqual({ text: 'Hello there', tokensIn: 11, tokensOut: 7, provider: 'anthropic', model: 'claude-x-2026' });
    });

    it('without a system prompt the field is omitted, not null', async () => {
      reply = { content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 1, output_tokens: 1 }, model: 'm' };
      await adapter.complete({ messages: [{ role: 'user', content: 'a' }], model: 'm', apiKey: 'k', endpoint: url });
      expect(lastBody).toBe('{"model":"m","max_tokens":1024,"messages":[{"role":"user","content":"a"}]}');
    });
  });

  describe('OpenAI', () => {
    const adapter = new OpenAiAdapter();

    it('body is byte-identical (system first, max_completion_tokens, temperature last)', async () => {
      reply = {
        choices: [{ message: { content: ' Hello! ' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
        model: 'gpt-x-2026',
      };
      const res = await adapter.complete({
        system: 'You are Ivy.',
        messages: conversation,
        model: 'gpt-x',
        apiKey: 'k',
        endpoint: url,
        maxTokens: 321,
        temperature: 0.3,
      });

      expect(lastBody).toBe(
        '{"model":"gpt-x","messages":[{"role":"system","content":"You are Ivy."},' +
          '{"role":"user","content":"Hi — \\"quoted\\" and unicode: giá qua đêm 425.000 ₫"},' +
          '{"role":"assistant","content":"Yo"},{"role":"user","content":"Q?"}],' +
          '"max_completion_tokens":321,"temperature":0.3}',
      );
      expect(res).toStrictEqual({ text: 'Hello!', tokensIn: 11, tokensOut: 7, provider: 'openai', model: 'gpt-x-2026' });
    });
  });

  describe('Stub', () => {
    it('answers exactly as before, ignoring a tools array it cannot honour', async () => {
      const stub = new StubAdapter();
      const plain = await stub.complete({ messages: [{ role: 'user', content: 'hello there' }], model: '' });
      expect(plain).toStrictEqual({
        text: 'Thanks for your question about "hello there". I can help with orders, shipping, returns, and product info. Could you share a bit more, or tap a menu option?',
        tokensIn: 3,
        tokensOut: 39,
        provider: 'stub',
        model: 'stub-1',
      });
      // A request that carries tools but no script gets the same plain text: the stub never invents a tool call.
      const withTools = await stub.complete({
        messages: [{ role: 'user', content: 'hello there' }],
        model: '',
        tools: [{ name: 't', description: 'd', inputSchema: { type: 'object', properties: {} } }],
      });
      expect(withTools.toolUses).toBeUndefined();
      expect(withTools.text).toBe(plain.text);
    });
  });
});
