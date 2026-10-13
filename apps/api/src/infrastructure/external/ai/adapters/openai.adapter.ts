import { Injectable, Logger } from '@nestjs/common';
import {
  AiAdapter,
  AiCompletionRequest,
  AiCompletionResult,
  AiRequestMessage,
  AiStopReason,
  AiToolUse,
} from '../ai-adapter.interface';
import { redactSecrets } from '../../../../global/util/secret-redact.util';
import { providerErrorSummary } from '../engine-health';
import {
  AiTimeoutError,
  ProviderHttpError,
  aiRequestTimeoutMs,
  runWithTimeout,
} from '../../../resilience/resilience';

/** Body fields the API may reject per model; each has a documented fallback. */
type Negotiable = 'temperature' | 'max_completion_tokens';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The conversation in Chat Completions form (PLN-261012 SG-33). A classic string message goes out as
 * `{ role, content }`, exactly as before. A tool turn is split the way this API wants it: the
 * assistant's `tool_use` blocks become `tool_calls` on one assistant message, and each
 * `tool_result` becomes its own `role: 'tool'` message (there is no error flag, so a failed call is
 * marked in the text).
 */
function toWireMessages(messages: AiRequestMessage[]): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === 'assistant') {
      const text = m.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      const calls = m.content.flatMap((b) =>
        b.type === 'tool_use'
          ? [{ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } }]
          : [],
      );
      out.push({ role: 'assistant', content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    for (const b of m.content) {
      if (b.type === 'tool_result') {
        out.push({ role: 'tool', tool_call_id: b.toolUseId, content: b.isError ? `ERROR: ${b.content}` : b.content });
      } else if (b.type === 'text') {
        out.push({ role: 'user', content: b.text });
      }
    }
  }
  return out;
}

function stopReasonOf(finish: unknown): AiStopReason {
  switch (finish) {
    case 'stop':
      return 'end_turn';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'other';
  }
}

/** The model's `tool_calls`, arguments parsed (OpenAI sends them as a JSON string). */
function toolUsesOf(message: any): AiToolUse[] {
  const calls: any[] = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  return calls.map((c) => {
    let input: Record<string, unknown> = {};
    let inputError: string | undefined;
    try {
      const parsed: unknown = JSON.parse(c?.function?.arguments || '{}');
      if (isPlainObject(parsed)) input = parsed;
      else inputError = 'input_not_object';
    } catch {
      inputError = 'input_not_json';
    }
    return {
      id: typeof c?.id === 'string' ? c.id : '',
      name: typeof c?.function?.name === 'string' ? c.function.name : '',
      input,
      ...(inputError ? { inputError } : {}),
    };
  });
}

/**
 * OpenAI Chat Completions adapter. Uses fetch (no SDK dependency), mirroring
 * the Anthropic adapter, and throws when unusable so the gateway can degrade to
 * the stub rather than hard-fail a live conversation.
 *
 * Two things differ from Anthropic and are the whole reason this file is more
 * than a URL swap:
 *
 * 1. There is no top-level `system` field — the persona goes in as the first
 *    message with role 'system'.
 * 2. The parameter names are model-dependent. Reasoning models (o-series, gpt-5)
 *    reject `max_tokens` and require `max_completion_tokens`; they also reject
 *    any `temperature` other than the default. Older chat models are the other
 *    way round on the token cap. Nothing in the console tells us which family a
 *    tenant typed into the model field, so instead of guessing we send the
 *    modern form and renegotiate once per rejected field: a 400 naming a field
 *    drops or swaps exactly that field and retries.
 *
 * This is deliberate. The Anthropic adapter learned the same lesson the hard
 * way (sampling params → 400 on current models, PR #67), except there the fix
 * was to omit them forever. Here the values are worth keeping when the model
 * accepts them, so we let the API tell us.
 */
@Injectable()
export class OpenAiAdapter implements AiAdapter {
  readonly provider = 'openai';
  /**
   * Tool calling is mapped to Chat Completions `tools` / `tool_calls` (PLN-261012 SG-33) and
   * covered against a local fake only. The gateway additionally requires the ENGINE row to declare
   * the `tools` capability, because an OpenAI-compatible custom endpoint may not implement it.
   */
  readonly supportsTools = true;
  private readonly logger = new Logger(OpenAiAdapter.name);

  /** One attempt per negotiable field, plus the initial try. */
  private static readonly MAX_ATTEMPTS = 3;

  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const apiKey = req.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API key not configured');

    const url = req.endpoint ?? 'https://api.openai.com/v1/chat/completions';
    const body: Record<string, unknown> = {
      model: req.model || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [
        ...(req.system ? [{ role: 'system', content: req.system }] : []),
        ...toWireMessages(req.messages),
      ],
      max_completion_tokens: req.maxTokens ?? 1024,
    };
    // Only sent when the tenant actually configured it: an absent temperature
    // can never be the thing a model rejects.
    if (req.temperature != null) body.temperature = req.temperature;
    // After every other field, and only when asked: a plain request has no `tools` key.
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    }

    const settled = new Set<Negotiable>();
    // One deadline for the whole call, negotiation retries included (PLN-261012 SG-84): three
    // sequential attempts each granted a full window would triple the worst case.
    const budgetMs = req.timeoutMs ?? aiRequestTimeoutMs();
    const startedAt = Date.now();
    for (let attempt = 1; attempt <= OpenAiAdapter.MAX_ATTEMPTS; attempt++) {
      const remaining = budgetMs - (Date.now() - startedAt);
      if (remaining <= 0) throw new AiTimeoutError('OpenAI', budgetMs);
      // The body is read inside the deadline too, so a stalled stream cannot outlive it.
      const res = await runWithTimeout(remaining, 'OpenAI', async (signal) => {
        const r = await fetch(url, {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body),
        });
        return r.ok
          ? { ok: true as const, status: r.status, data: (await r.json()) as any, detail: '' }
          : { ok: false as const, status: r.status, data: null, detail: await r.text().catch(() => '') };
      });

      if (res.ok) {
        const data: any = res.data;
        const text = (data.choices ?? [])
          .map((c: any) => c.message?.content ?? '')
          .join('')
          .trim();
        const result: AiCompletionResult = {
          text,
          tokensIn: data.usage?.prompt_tokens ?? 0,
          tokensOut: data.usage?.completion_tokens ?? 0,
          provider: this.provider,
          model: data.model ?? (body.model as string),
        };
        // No tools asked → exactly the previous result shape.
        if (!req.tools?.length) return result;
        const toolUses = toolUsesOf(data.choices?.[0]?.message);
        return {
          ...result,
          ...(toolUses.length ? { toolUses } : {}),
          stopReason: stopReasonOf(data.choices?.[0]?.finish_reason),
        };
      }

      const detail = res.detail;
      const field = res.status === 400 ? this.rejectedField(detail, body, settled) : null;
      if (!field) {
        // A 401 body quotes the rejected key verbatim — never log it raw.
        this.logger.error(
          `OpenAI error ${res.status}: ${redactSecrets(detail, apiKey).slice(0, 300)}`,
        );
        throw new ProviderHttpError(
          `OpenAI API error ${res.status}: ${redactSecrets(providerErrorSummary(detail), apiKey)}`,
          res.status,
        );
      }
      settled.add(field);
      this.renegotiate(body, field);
      this.logger.warn(`OpenAI rejected '${field}' for model ${body.model}; retrying without it`);
    }

    throw new ProviderHttpError('OpenAI API error 400 (parameter negotiation exhausted)', 400);
  }

  /**
   * Which negotiable field this 400 blames, if any. Prefers the structured
   * `error.param`; falls back to the message text, which is where the
   * "use 'max_completion_tokens' instead" wording lives. A field is only
   * returned once — a second rejection of something we already dropped means
   * the model is unhappy about something else and the call must fail loudly.
   */
  private rejectedField(
    detail: string,
    body: Record<string, unknown>,
    settled: Set<Negotiable>,
  ): Negotiable | null {
    let param = '';
    try {
      param = String(JSON.parse(detail)?.error?.param ?? '');
    } catch {
      /* non-JSON error body — fall through to text matching */
    }
    const haystack = `${param} ${detail}`.toLowerCase();

    for (const field of ['temperature', 'max_completion_tokens'] as Negotiable[]) {
      if (settled.has(field)) continue;
      if (body[field] === undefined) continue;
      if (haystack.includes(field)) return field;
    }
    // "Unsupported parameter: 'max_tokens' ..." — the model wants the modern
    // name while we are already sending it; not a field we can renegotiate.
    return null;
  }

  /** Drop or downgrade a rejected field in place. */
  private renegotiate(body: Record<string, unknown>, field: Negotiable): void {
    if (field === 'temperature') {
      delete body.temperature;
      return;
    }
    // Older chat models know only the legacy name.
    body.max_tokens = body.max_completion_tokens;
    delete body.max_completion_tokens;
  }
}
