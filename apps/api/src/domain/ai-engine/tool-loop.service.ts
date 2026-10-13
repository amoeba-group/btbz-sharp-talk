import { Injectable, Logger } from '@nestjs/common';
import type { AiFunction } from '@sharptalk/types';
import type {
  AiContentBlock,
  AiRequestMessage,
  AiToolDef,
  AiToolUse,
} from '../../infrastructure/external/ai/ai-adapter.interface';
import { AiGatewayService } from '../../infrastructure/external/ai/ai-gateway.service';
import type { ToolSupport } from '../../infrastructure/external/ai/ai-gateway.service';
import { aiRequestTimeoutMs } from '../../infrastructure/resilience/resilience';
import { envNumber } from '../../global/util/env-number.util';

/**
 * A bounded model <-> tools loop (PLN-261012 SG-33). Generic on purpose: it knows nothing about
 * hotels or partner data. It owns the MECHANICS — iterate, execute what the model asked for, feed the
 * results back, stop — and every limit that makes that safe to run on a customer's turn. What a tool
 * IS, who may call it and what it returns belong to the caller's `execute`.
 *
 * Properties the loop guarantees, whatever the model does or the provider returns:
 *  - it never starts without proof the engine can use tools (`gateway.toolSupport`), and a tools
 *    request that reaches an engine that cannot is refused by the gateway too;
 *  - a degraded call (the gateway answered with the stub's text because the engine failed) ABORTS the
 *    loop: nothing the stub says is read as a tool call, a result or an answer;
 *  - at most `maxIterations` model calls, at most `maxToolCalls` tool executions per turn, all within
 *    `budgetMs` of wall-clock — each model call's own deadline is capped by what is left;
 *  - the model's tool calls are only executed when it stopped BECAUSE it asked for tools
 *    (`stop_reason: tool_use`): a response cut off by `max_tokens` can carry half-written arguments;
 *  - tool calls run one after another, in the order the model wrote them, and the first one that
 *    aborts cancels the rest — a turn is never half-executed behind the caller's back;
 *  - token usage is summed across iterations. Each gateway call is metered individually by the
 *    gateway under `feature` (keep it within the 32-character label limit).
 */

export const TOOL_LOOP_DEFAULT_MAX_ITERATIONS = 3;
export const TOOL_LOOP_DEFAULT_MAX_TOOL_CALLS = 4;
export const TOOL_LOOP_DEFAULT_BUDGET_MS = 20_000;

/** One tool call the model made, with arguments exactly as it wrote them (untrusted). */
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** What executing one call came to. `execute` never throws for an expected failure. */
export type ToolExecution =
  /** Success: `content` is shown to the model as the tool's result. */
  | { kind: 'ok'; content: string }
  /** A failure the MODEL can correct (bad arguments): `content` goes back marked as an error. */
  | { kind: 'retry'; content: string }
  /** A failure the loop must not continue past: stop now and hand `detail` back to the caller. */
  | { kind: 'abort'; detail?: unknown };

export interface ToolExecutionInfo {
  /** 1-based model iteration the call belongs to. */
  iteration: number;
  /** Wall-clock budget left for this call, ms. */
  remainingMs: number;
}

export interface ToolLoopRequest {
  tenantId: number;
  /** Selects the engine (its routing row); the loop uses the one that answers customers. */
  function: AiFunction;
  /** Usage label, <= 32 chars (the usage table's limit). */
  feature: string;
  system: string;
  /** The conversation to start from — a user turn last. */
  messages: AiRequestMessage[];
  tools: AiToolDef[];
  execute: (call: ToolCall, info: ToolExecutionInfo) => Promise<ToolExecution>;
  maxIterations?: number;
  maxToolCalls?: number;
  /** Whole-turn wall-clock budget, ms. */
  budgetMs?: number;
  /** Output cap of each model call. */
  maxTokens?: number;
}

export type ToolLoopAbortReason =
  /** The engine cannot use tools (adapter or capability) — nothing was sent. */
  | 'tools_unsupported'
  /** The engine failed; the gateway returned the stub's text. */
  | 'engine_degraded'
  | 'engine_error'
  /** The model still wanted tools at its last allowed iteration. */
  | 'iteration_limit'
  /** The model asked for more calls than the per-turn cap. */
  | 'tool_call_limit'
  | 'time_budget'
  /** `execute` returned `abort`. */
  | 'tool_aborted'
  /** Tool calls without `stop_reason: tool_use`, a nameless/duplicate id, … */
  | 'malformed_response'
  /** The response was cut off (`max_tokens`/refusal): nothing in it is trusted. */
  | 'truncated_response';

export interface ToolCallRecord {
  name: string;
  iteration: number;
  outcome: 'ok' | 'retry' | 'abort' | 'skipped';
}

export interface ToolLoopResult {
  /** `completed` = the model ended its turn without asking for more tools. */
  status: 'completed' | 'aborted';
  reason?: ToolLoopAbortReason;
  /** What `execute` returned with `abort`, or the gateway's `ToolSupport` for `tools_unsupported`. */
  detail?: unknown;
  /** Model calls made. */
  iterations: number;
  /** Tool calls the model made (executed, or answered as an error). */
  toolCalls: number;
  calls: ToolCallRecord[];
  usage: { tokensIn: number; tokensOut: number };
  elapsedMs: number;
  /** The last model turn's text (only meaningful when `completed`). */
  finalText: string;
}

/** Defaults come from the environment so an operator can tighten them without a deploy. */
export function toolLoopLimitsFromEnv(): { maxIterations: number; maxToolCalls: number; budgetMs: number } {
  return {
    maxIterations: Math.max(1, Math.round(envNumber('PARTNER_TOOLS_MAX_ITERATIONS', TOOL_LOOP_DEFAULT_MAX_ITERATIONS))),
    maxToolCalls: Math.max(1, Math.round(envNumber('PARTNER_TOOLS_MAX_CALLS', TOOL_LOOP_DEFAULT_MAX_TOOL_CALLS))),
    budgetMs: Math.max(500, envNumber('PARTNER_TOOLS_BUDGET_MS', TOOL_LOOP_DEFAULT_BUDGET_MS)),
  };
}

/** Outcome of racing a promise against a deadline. */
type Raced<T> = { timedOut: false; value: T } | { timedOut: true };

async function withDeadline<T>(work: Promise<T>, ms: number): Promise<Raced<T>> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<{ timedOut: true }>((resolve) => {
    timer = setTimeout(() => resolve({ timedOut: true }), Math.max(0, ms));
  });
  try {
    return await Promise.race([work.then((value) => ({ timedOut: false as const, value })), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

@Injectable()
export class ToolLoopService {
  private readonly logger = new Logger(ToolLoopService.name);

  constructor(private readonly gateway: AiGatewayService) {}

  /** Whether the engine behind `function` can run a loop at all — a cheap pre-check, no provider call. */
  support(tenantId: number, fn: AiFunction): Promise<ToolSupport> {
    return this.gateway.toolSupport(tenantId, fn);
  }

  async run(req: ToolLoopRequest, now: () => number = Date.now): Promise<ToolLoopResult> {
    const startedAt = now();
    const limits = toolLoopLimitsFromEnv();
    const maxIterations = Math.max(1, req.maxIterations ?? limits.maxIterations);
    const maxToolCalls = Math.max(1, req.maxToolCalls ?? limits.maxToolCalls);
    const budgetMs = Math.max(1, req.budgetMs ?? limits.budgetMs);

    const result: ToolLoopResult = {
      status: 'aborted',
      iterations: 0,
      toolCalls: 0,
      calls: [],
      usage: { tokensIn: 0, tokensOut: 0 },
      elapsedMs: 0,
      finalText: '',
    };
    const done = (patch: Partial<ToolLoopResult>): ToolLoopResult => {
      Object.assign(result, patch, { elapsedMs: now() - startedAt });
      return result;
    };
    const remaining = (): number => budgetMs - (now() - startedAt);

    const support = await this.gateway.toolSupport(req.tenantId, req.function);
    if (!support.supported) return done({ reason: 'tools_unsupported', detail: support });

    const messages: AiRequestMessage[] = [...req.messages];

    for (let iteration = 1; iteration <= maxIterations; iteration++) {
      if (remaining() <= 0) return done({ reason: 'time_budget' });

      let res;
      try {
        res = await this.gateway.complete({
          tenantId: req.tenantId,
          function: req.function,
          feature: req.feature,
          system: req.system,
          // A snapshot: the transcript keeps growing after this call returns.
          messages: [...messages],
          tools: req.tools,
          maxTokens: req.maxTokens,
          // A model call may not outlive what is left of the turn.
          timeoutMs: Math.max(1, Math.min(aiRequestTimeoutMs(), remaining())),
        });
      } catch (e) {
        // `complete` degrades instead of throwing; this is a bug or a test double.
        this.logger.warn(`tool loop: gateway call threw: ${(e as Error).message}`);
        return done({ reason: 'engine_error', iterations: iteration });
      }
      result.iterations = iteration;

      // The engine failed and the gateway answered with the stub, or refused a tools request. The text
      // is canned, the tokens are an estimate, and there are no tool calls to trust: stop.
      if (res.degraded) {
        return done({ reason: res.toolsRefused ? 'tools_unsupported' : 'engine_degraded' });
      }
      result.usage.tokensIn += res.tokensIn ?? 0;
      result.usage.tokensOut += res.tokensOut ?? 0;

      const uses: AiToolUse[] = res.toolUses ?? [];
      if (!uses.length) {
        // Cut off or refused: the text is not a finished thought, and nothing was asked for.
        if (res.stopReason === 'max_tokens' || res.stopReason === 'refusal') {
          return done({ reason: 'truncated_response' });
        }
        return done({ status: 'completed', finalText: res.text ?? '' });
      }

      // Tool calls are only honoured on a response that stopped because of them.
      if (res.stopReason !== 'tool_use') return done({ reason: res.stopReason === 'max_tokens' ? 'truncated_response' : 'malformed_response' });
      const ids = new Set(uses.map((u) => u.id));
      if (uses.some((u) => !u.id || !u.name) || ids.size !== uses.length) return done({ reason: 'malformed_response' });

      // Still asking for tools on the last iteration: the loop would need one more model call to
      // use the results, which it is not allowed to make. The turn is not completed.
      if (iteration === maxIterations) return done({ reason: 'iteration_limit' });
      if (result.toolCalls + uses.length > maxToolCalls) return done({ reason: 'tool_call_limit' });

      const outcomes: AiContentBlock[] = [];
      for (const [i, use] of uses.entries()) {
        if (remaining() <= 0) return done({ reason: 'time_budget' });
        result.toolCalls += 1;

        if (use.inputError) {
          // The provider could not hand us the arguments as an object: never executed, answered as an error.
          result.calls.push({ name: use.name, iteration, outcome: 'retry' });
          outcomes.push({ type: 'tool_result', toolUseId: use.id, content: `invalid arguments: ${use.inputError}`, isError: true });
          continue;
        }

        let raced: Raced<ToolExecution>;
        try {
          raced = await withDeadline(
            req.execute({ id: use.id, name: use.name, input: use.input }, { iteration, remainingMs: remaining() }),
            remaining(),
          );
        } catch (e) {
          this.logger.warn(`tool loop: tool "${use.name}" threw: ${(e as Error).message}`);
          result.calls.push({ name: use.name, iteration, outcome: 'abort' });
          return done({ reason: 'tool_aborted', detail: e });
        }
        if (raced.timedOut) {
          result.calls.push({ name: use.name, iteration, outcome: 'abort' });
          return done({ reason: 'time_budget' });
        }
        const exec = raced.value;
        if (exec.kind === 'abort') {
          // The first failure cancels the rest of the turn's calls.
          result.calls.push({ name: use.name, iteration, outcome: 'abort' });
          for (const later of uses.slice(i + 1)) {
            result.calls.push({ name: later.name, iteration, outcome: 'skipped' });
          }
          return done({ reason: 'tool_aborted', detail: exec.detail });
        }
        result.calls.push({ name: use.name, iteration, outcome: exec.kind });
        outcomes.push({
          type: 'tool_result',
          toolUseId: use.id,
          content: exec.content,
          ...(exec.kind === 'retry' ? { isError: true } : {}),
        });
      }

      // The assistant turn exactly as the model wrote it (text first, then its tool uses), answered by
      // one user turn that carries every result — the shape both providers require.
      const assistant: AiContentBlock[] = [
        ...(res.text ? [{ type: 'text' as const, text: res.text }] : []),
        ...uses.map((u) => ({ type: 'tool_use' as const, id: u.id, name: u.name, input: u.input })),
      ];
      messages.push({ role: 'assistant', content: assistant }, { role: 'user', content: outcomes });
    }

    // Unreachable: the last iteration returns above. Kept so the type checker and a future edit agree.
    return done({ reason: 'iteration_limit' });
  }
}
