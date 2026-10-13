import { Injectable, Logger } from '@nestjs/common';
import {
  AiAdapter,
  AiCompletionRequest,
  AiCompletionResult,
  AiContentBlock,
  AiRequestMessage,
  AiStopReason,
  AiToolUse,
} from '../ai-adapter.interface';
import { redactSecrets } from '../../../../global/util/secret-redact.util';
import { providerErrorSummary } from '../engine-health';
import {
  ProviderHttpError,
  aiRequestTimeoutMs,
  runWithTimeout,
} from '../../../resilience/resilience';

/** A message as the Messages API wants it: a string for a classic turn, blocks for a tool turn. */
function toWireMessage(m: AiRequestMessage): { role: string; content: string | Array<Record<string, unknown>> } {
  // The classic path keeps `{ role, content }` in that key order: a plain request must stay
  // byte-identical on the wire (PLN-261012 SG-33).
  if (typeof m.content === 'string') return { role: m.role, content: m.content };
  return { role: m.role, content: m.content.map(toWireBlock) };
}

function toWireBlock(b: AiContentBlock): Record<string, unknown> {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text };
    case 'tool_use':
      return { type: 'tool_use', id: b.id, name: b.name, input: b.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: b.toolUseId,
        content: b.content,
        ...(b.isError ? { is_error: true } : {}),
      };
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The provider's `stop_reason` in the vocabulary the tool loop reads. */
function stopReasonOf(raw: unknown): AiStopReason {
  switch (raw) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

/**
 * Anthropic Claude adapter (default real provider). Uses the Messages API via
 * fetch (no SDK dependency). Falls back to throwing so the gateway can degrade
 * to the stub adapter when no key is configured.
 *
 * One attempt per call, with a whole-call deadline (PLN-261012 SG-84): retry and the
 * circuit breaker live in the gateway, which sees every provider the same way.
 *
 * Native tool calling (PLN-261012 SG-33): a request with `tools` sends them as `tools[]`, tool
 * turns go out as `tool_use` / `tool_result` content blocks, and the response's `tool_use` blocks
 * and `stop_reason` come back as `toolUses` / `stopReason`. A request WITHOUT tools is unchanged in
 * both directions. Verified only against a local fake of the Messages API (see the SG-33 RPT) — the
 * real provider's behaviour has not been exercised.
 */
@Injectable()
export class AnthropicAdapter implements AiAdapter {
  readonly provider = 'anthropic';
  readonly supportsTools = true;
  private readonly logger = new Logger(AnthropicAdapter.name);

  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    const apiKey = req.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('Anthropic API key not configured');

    // The deadline spans the body read too: a provider that sends headers and then stalls
    // the stream must not outlive it (the timer is cleared only when the body is in hand).
    return runWithTimeout(req.timeoutMs ?? aiRequestTimeoutMs(), 'Anthropic', async (signal) => {
      const res = await fetch(req.endpoint ?? 'https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        // NOTE: temperature/top_p/top_k are intentionally omitted — the current
        // Claude models (Opus 4.8/4.7, Sonnet 5, Fable 5) reject sampling params
        // with a 400. They are optional on older models too, so omitting is safe
        // for every model. Steer behaviour via the system prompt instead.
        body: JSON.stringify({
          model: req.model || process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
          max_tokens: req.maxTokens ?? 1024,
          system: req.system,
          messages: req.messages.filter((m) => m.role !== 'system').map(toWireMessage),
          // Last, and only when asked: a request without tools has no `tools` key at all.
          ...(req.tools?.length
            ? { tools: req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })) }
            : {}),
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        // Anthropic does not echo the key today, but the body is provider-controlled
        // text: redact before it reaches the log, same as the OpenAI path.
        this.logger.error(
          `Anthropic error ${res.status}: ${redactSecrets(detail, apiKey).slice(0, 300)}`,
        );
        // The provider's reason travels with the error (PLN-261007 S2): "credit
        // balance is too low" used to be thrown away here and the connection
        // test then called a funded-out account "unreachable".
        throw new ProviderHttpError(
          `Anthropic API error ${res.status}: ${redactSecrets(providerErrorSummary(detail), apiKey)}`,
          res.status,
        );
      }
      const data: any = await res.json();
      // A `tool_use` block has no `text`, so a tool-calling reply used to read as an empty string.
      const text = (data.content ?? []).map((c: any) => c.text ?? '').join('');
      const result: AiCompletionResult = {
        text,
        tokensIn: data.usage?.input_tokens ?? 0,
        tokensOut: data.usage?.output_tokens ?? 0,
        provider: this.provider,
        model: data.model ?? req.model,
      };
      // No tools asked → exactly the previous result shape.
      if (!req.tools?.length) return result;

      const toolUses: AiToolUse[] = (data.content ?? [])
        .filter((c: any) => c?.type === 'tool_use')
        .map((c: any) => ({
          id: typeof c.id === 'string' ? c.id : '',
          name: typeof c.name === 'string' ? c.name : '',
          input: isPlainObject(c.input) ? c.input : {},
          ...(isPlainObject(c.input) ? {} : { inputError: 'input_not_object' }),
        }));
      return {
        ...result,
        ...(toolUses.length ? { toolUses } : {}),
        stopReason: stopReasonOf(data.stop_reason),
      };
    });
  }
}
