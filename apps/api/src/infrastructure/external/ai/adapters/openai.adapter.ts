import { Injectable, Logger } from '@nestjs/common';
import { AiAdapter, AiCompletionRequest, AiCompletionResult } from '../ai-adapter.interface';
import { redactSecrets } from '../../../../global/util/secret-redact.util';
import { providerErrorSummary } from '../engine-health';

/** Body fields the API may reject per model; each has a documented fallback. */
type Negotiable = 'temperature' | 'max_completion_tokens';

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
        ...req.messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role, content: m.content })),
      ],
      max_completion_tokens: req.maxTokens ?? 1024,
    };
    // Only sent when the tenant actually configured it: an absent temperature
    // can never be the thing a model rejects.
    if (req.temperature != null) body.temperature = req.temperature;

    const settled = new Set<Negotiable>();
    for (let attempt = 1; attempt <= OpenAiAdapter.MAX_ATTEMPTS; attempt++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        const data: any = await res.json();
        const text = (data.choices ?? [])
          .map((c: any) => c.message?.content ?? '')
          .join('')
          .trim();
        return {
          text,
          tokensIn: data.usage?.prompt_tokens ?? 0,
          tokensOut: data.usage?.completion_tokens ?? 0,
          provider: this.provider,
          model: data.model ?? (body.model as string),
        };
      }

      const detail = await res.text().catch(() => '');
      const field = res.status === 400 ? this.rejectedField(detail, body, settled) : null;
      if (!field) {
        // A 401 body quotes the rejected key verbatim — never log it raw.
        this.logger.error(
          `OpenAI error ${res.status}: ${redactSecrets(detail, apiKey).slice(0, 300)}`,
        );
        throw new Error(
          `OpenAI API error ${res.status}: ${redactSecrets(providerErrorSummary(detail), apiKey)}`,
        );
      }
      settled.add(field);
      this.renegotiate(body, field);
      this.logger.warn(`OpenAI rejected '${field}' for model ${body.model}; retrying without it`);
    }

    throw new Error('OpenAI API error 400 (parameter negotiation exhausted)');
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
