import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  AiAdapter,
  AiCompletionRequest,
  AiCompletionResult,
  AiEmbeddingRequest,
  AiEmbeddingResult,
  AiStopReason,
  AiToolUse,
  messageText,
} from '../ai-adapter.interface';

/**
 * What a test's tool script returns for one request (PLN-261012 SG-33). Mirrors the parts of an
 * `AiCompletionResult` a tool turn has.
 */
export interface StubToolTurn {
  text?: string;
  toolUses?: AiToolUse[];
  stopReason?: AiStopReason;
}

/** Decides the stub's reply to a request that carries tools. Return null to fall back to plain text. */
export type StubToolScript = (req: AiCompletionRequest) => StubToolTurn | null;

/**
 * Deterministic offline adapter so the whole system runs without API keys.
 * It produces grounded-looking answers from the provided context block and
 * honors lightweight JSON-mode prompts used by intent/moderation classifiers.
 */
@Injectable()
export class StubAdapter implements AiAdapter {
  readonly provider = 'stub';

  /**
   * TEST-ONLY scripted tool calling (PLN-261012 SG-33). A plain instance field that nothing in the
   * application sets — not an env var, not a marker in a prompt — so a customer's words can never
   * switch it on. Absent a script the stub cannot call tools: `supportsTools` is false and the
   * gateway refuses to hand it a tools request, which is also what keeps a degraded-engine fallback
   * from ever "inventing" a tool call or a tool result.
   */
  toolScript: StubToolScript | null = null;

  get supportsTools(): boolean {
    return this.toolScript !== null;
  }

  async complete(req: AiCompletionRequest): Promise<AiCompletionResult> {
    // Content of a tool turn is flattened to text; a classic message is returned as it was.
    const lastUser = messageText([...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '');
    const system = req.system ?? '';
    let text: string;

    if (req.tools?.length && this.toolScript) {
      const turn = this.toolScript(req);
      if (turn) {
        const reply = turn.text ?? '';
        const toolUses = turn.toolUses ?? [];
        return {
          text: reply,
          tokensIn: this.estimate(system + lastUser),
          tokensOut: this.estimate(reply + JSON.stringify(toolUses)),
          provider: this.provider,
          model: req.model || 'stub-1',
          ...(toolUses.length ? { toolUses } : {}),
          stopReason: turn.stopReason ?? (toolUses.length ? 'tool_use' : 'end_turn'),
        };
      }
    }

    if (system.includes('JSON_MODE:intent')) {
      text = JSON.stringify(this.classifyIntent(lastUser));
    } else if (system.includes('JSON_MODE:moderation')) {
      text = JSON.stringify({ flagged: false, reason: '' });
    } else {
      text = this.answer(lastUser, system);
    }
    return {
      text,
      tokensIn: this.estimate(system + lastUser),
      tokensOut: this.estimate(text),
      provider: this.provider,
      model: req.model || 'stub-1',
    };
  }

  private answer(question: string, system: string): string {
    const ctxMatch = system.match(/CONTEXT_START([\s\S]*?)CONTEXT_END/);
    const ctx = ctxMatch?.[1]?.trim();
    if (ctx) {
      // Context lines are "- [category] title: snippet" — strip the list marker
      // and internal [category] label so customers never see internal doc structure.
      const firstLine = ctx.split('\n').filter(Boolean)[0] ?? '';
      const fact = firstLine.replace(/^-\s*/, '').replace(/^\[[^\]]*\]\s*/, '');
      return `Here's what I found for you: ${fact} If this doesn't fully answer your question, I'd be happy to connect you with a support agent.`;
    }
    return `Thanks for your question about "${question.slice(0, 80)}". I can help with orders, shipping, returns, and product info. Could you share a bit more, or tap a menu option?`;
  }

  private classifyIntent(text: string): { intent: string; needsOrderData: boolean; confidence: number } {
    const t = text.toLowerCase();
    // General policy / FAQ questions stay in RAG (no auth gate) even if they mention return/refund.
    const policy = /(policy|정책|how (do|long)|faq|warranty|보증)/.test(t);
    const tracking = /(track|where('?s| is)|order status|my order|배송\s*조회|주문\s*조회|delivery status)/.test(t);
    const ownOrderAction =
      /(cancel|refund|취소|환불|반품)/.test(t) && /(my|this|order|#|주문|결제)/.test(t);
    if (!policy && tracking) return { intent: 'order_status', needsOrderData: true, confidence: 0.9 };
    if (!policy && ownOrderAction) return { intent: 'cancel_refund', needsOrderData: true, confidence: 0.85 };
    return { intent: 'product_inquiry', needsOrderData: false, confidence: 0.7 };
  }

  private estimate(s: string): number {
    return Math.ceil(s.length / 4);
  }

  /**
   * Deterministic pseudo-embeddings so the vector pipeline runs without a
   * Voyage key. Token-hash bag-of-words: shared tokens between query and
   * document land in the same buckets, so exact-term overlap still retrieves —
   * NOT semantically meaningful. Dimension matches voyage-4 (1024); vectors
   * are L2-normalized so dot == cosine, like real Voyage output.
   */
  async embed(req: AiEmbeddingRequest): Promise<AiEmbeddingResult> {
    const dim = 1024;
    const vectors = req.texts.map((text) => {
      const v = new Array<number>(dim).fill(0);
      const tokens = text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 1);
      for (const token of tokens) {
        const h = createHash('sha1').update(token).digest();
        v[h.readUInt32BE(0) % dim] += 1;
        v[h.readUInt32BE(4) % dim] += 1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    });
    return {
      vectors,
      tokensIn: req.texts.reduce((s, t) => s + this.estimate(t), 0),
      provider: this.provider,
      model: 'stub-embed-1',
      dimension: dim,
    };
  }
}
