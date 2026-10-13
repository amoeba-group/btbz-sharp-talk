import * as http from 'http';
import { AddressInfo } from 'net';

/**
 * A local FAKE of the Anthropic Messages API for tests (PLN-261012 SG-33). No live provider exists
 * for this repo's tool loop, so the REAL `AnthropicAdapter` (and, above it, the real gateway and tool
 * loop) is driven through this server over real HTTP.
 *
 * What it models — and it is deliberately strict, because a lenient fake would hide adapter bugs:
 *  - `POST /v1/messages` with the `x-api-key` and `anthropic-version` headers;
 *  - the tool-calling protocol rules the real API enforces with a 400 `invalid_request_error`:
 *    every `tool_use` of an assistant turn must be answered by a `tool_result` in the NEXT user
 *    turn (and only those ids), `tool_result` blocks come first in that turn, a request that has
 *    tool blocks must declare `tools`, tool names are `[a-zA-Z0-9_-]{1,64}`, and `input_schema` is an
 *    object schema without a top-level oneOf/anyOf/allOf;
 *  - replies shaped like the API's: `content` blocks (`text`, `tool_use`), `stop_reason`, `usage`.
 *
 * What it is NOT: the real model, real latency, rate limits or any behaviour of the live service.
 * Everything verified against it is "verified against this fake".
 */

export interface FakeRequest {
  /** 1-based index of the request. */
  n: number;
  raw: string;
  body: {
    model: string;
    max_tokens: number;
    system?: string;
    messages: Array<{ role: string; content: string | Array<Record<string, any>> }>;
    tools?: Array<{ name: string; description?: string; input_schema: Record<string, any> }>;
  };
  headers: http.IncomingHttpHeaders;
}

export type FakeBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown };

export type FakeReply =
  | {
      status?: 200;
      content: FakeBlock[];
      stop_reason?: string;
      usage?: { input_tokens: number; output_tokens: number };
      model?: string;
    }
  /** An HTTP error answer, e.g. `{ status: 529, error: ... }`. */
  | { status: number; error: { type: string; message: string } }
  /** Accept the request and never answer (the client's deadline must fire). */
  | { hang: true };

export const fakeText = (text: string): FakeBlock => ({ type: 'text', text });
export const fakeToolUse = (id: string, name: string, input: unknown): FakeBlock => ({ type: 'tool_use', id, name, input });

/** A tool-calling reply: optional text plus the tool uses, `stop_reason: tool_use`. */
export const toolCalls = (blocks: FakeBlock[], usage = { input_tokens: 100, output_tokens: 20 }): FakeReply => ({
  content: blocks,
  stop_reason: 'tool_use',
  usage,
});

/** A final reply with no tool use. */
export const endTurn = (text = 'DONE', usage = { input_tokens: 120, output_tokens: 3 }): FakeReply => ({
  content: [fakeText(text)],
  stop_reason: 'end_turn',
  usage,
});

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/** The rules above, as a list of violations (empty = the real API would accept it). */
export function protocolViolations(body: FakeRequest['body']): string[] {
  const bad: string[] = [];
  if (!Array.isArray(body.messages) || !body.messages.length) return ['messages: at least one message is required'];
  if (body.messages[0].role !== 'user') bad.push('messages: first message must use the "user" role');

  const hasToolBlocks = body.messages.some(
    (m) => Array.isArray(m.content) && m.content.some((b) => b?.type === 'tool_use' || b?.type === 'tool_result'),
  );
  if (hasToolBlocks && !body.tools?.length) bad.push('tools: requests with tool_use/tool_result blocks must define tools');

  for (const t of body.tools ?? []) {
    if (!TOOL_NAME.test(String(t.name))) bad.push(`tools: invalid name "${t.name}"`);
    const s = t.input_schema;
    if (!s || s.type !== 'object') bad.push(`tools.${t.name}: input_schema.type must be "object"`);
    else if (s.oneOf || s.anyOf || s.allOf) bad.push(`tools.${t.name}: input_schema does not support oneOf, allOf, or anyOf at the top level`);
  }

  body.messages.forEach((m, i) => {
    if (!Array.isArray(m.content)) return;
    const uses = m.role === 'assistant' ? m.content.filter((b) => b?.type === 'tool_use') : [];
    const results = m.role === 'user' ? m.content.filter((b) => b?.type === 'tool_result') : [];
    if (m.role === 'user' && results.length) {
      // tool_result blocks must precede any other content of the turn.
      const firstOther = m.content.findIndex((b) => b?.type !== 'tool_result');
      if (firstOther !== -1 && m.content.slice(firstOther).some((b) => b?.type === 'tool_result')) {
        bad.push(`messages.${i}: tool_result blocks must come first in the user turn`);
      }
      const prev = body.messages[i - 1];
      const prevIds = new Set(
        Array.isArray(prev?.content) && prev.role === 'assistant'
          ? prev.content.filter((b) => b?.type === 'tool_use').map((b) => b.id)
          : [],
      );
      for (const r of results) {
        if (!prevIds.has(r.tool_use_id)) bad.push(`messages.${i}: tool_result for unknown tool_use_id "${r.tool_use_id}"`);
      }
    }
    if (uses.length) {
      const next = body.messages[i + 1];
      const answered = new Set(
        Array.isArray(next?.content) && next.role === 'user'
          ? next.content.filter((b) => b?.type === 'tool_result').map((b) => b.tool_use_id)
          : [],
      );
      for (const u of uses) {
        if (!answered.has(u.id)) bad.push(`messages.${i}: tool_use id "${u.id}" has no tool_result in the next user turn`);
      }
    }
  });
  return bad;
}

export class FakeAnthropicServer {
  readonly requests: FakeRequest[] = [];
  private server!: http.Server;
  private sockets = new Set<import('net').Socket>();
  url = '';

  constructor(
    private script: (req: FakeRequest) => FakeReply | Promise<FakeReply>,
    private readonly opts: { validate?: boolean } = {},
  ) {}

  /** Swap the script between steps of one test. */
  setScript(script: (req: FakeRequest) => FakeReply | Promise<FakeReply>): void {
    this.script = script;
  }

  /** Listen on an ephemeral port (default) or a fixed one (a standalone smoke needs a stable URL). */
  async start(port = 0): Promise<this> {
    this.server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        void this.handle(req, res, Buffer.concat(chunks).toString('utf8'));
      });
    });
    this.server.on('connection', (s) => {
      this.sockets.add(s);
      s.on('close', () => this.sockets.delete(s));
    });
    await new Promise<void>((r) => this.server.listen(port, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/v1/messages`;
    return this;
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse, raw: string): Promise<void> {
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    let body: FakeRequest['body'];
    try {
      body = JSON.parse(raw);
    } catch {
      return send(400, { type: 'error', error: { type: 'invalid_request_error', message: 'body is not JSON' } });
    }
    const fake: FakeRequest = { n: this.requests.length + 1, raw, body, headers: req.headers };
    this.requests.push(fake);

    if (req.method !== 'POST' || req.url !== '/v1/messages') {
      return send(404, { type: 'error', error: { type: 'not_found_error', message: 'unknown route' } });
    }
    if (!req.headers['x-api-key'] || !req.headers['anthropic-version']) {
      return send(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
    }
    if (this.opts.validate !== false) {
      const bad = protocolViolations(body);
      if (bad.length) {
        return send(400, { type: 'error', error: { type: 'invalid_request_error', message: bad.join('; ') } });
      }
    }

    const reply = await this.script(fake);
    if ('hang' in reply) return; // never answered: the client's deadline must fire
    if ('error' in reply) return send(reply.status, { type: 'error', error: reply.error });
    send(200, {
      id: `msg_fake_${fake.n}`,
      type: 'message',
      role: 'assistant',
      model: reply.model ?? body.model,
      content: reply.content,
      stop_reason: reply.stop_reason ?? (reply.content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn'),
      usage: reply.usage ?? { input_tokens: 10, output_tokens: 5 },
    });
  }
}
