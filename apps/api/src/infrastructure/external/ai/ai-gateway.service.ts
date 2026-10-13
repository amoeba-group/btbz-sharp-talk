import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AiFunction } from '@sharptalk/types';
import { AiEngine } from '../../../domain/ai-engine/entity/ai-engine.entity';
import { TenantAiSetting } from '../../../domain/ai-engine/entity/tenant-ai-setting.entity';
import { AiUsageService } from '../../../domain/ai-engine/ai-usage.service';
import { decryptSecret } from '../../../global/util/crypto.util';
import {
  AiAdapter,
  AiCompletionResult,
  AiEmbeddingResult,
  AiRequestMessage,
  AiToolDef,
} from './ai-adapter.interface';
import { StubAdapter } from './adapters/stub.adapter';
import { ENGINE_FAILURE, classifyEngineFailure } from './engine-health';
import { AiCreditAlertService } from './ai-credit-alert.service';
import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { OpenAiAdapter } from './adapters/openai.adapter';
import { VoyageAdapter } from './adapters/voyage.adapter';
import {
  BreakerSnapshot,
  CircuitBreaker,
  breakerEnabled,
  breakerOptionsFromEnv,
  isEngineFailure,
} from '../../resilience/circuit-breaker';
import {
  AiTimeoutError,
  failureReason,
  isTransientError,
  retryWithJitter,
} from '../../resilience/resilience';
import { envNumber } from '../../../global/util/env-number.util';
import { m, safeLabel } from '../../observability/app-metrics';

/** What the gateway exposes per breaker — metrics, readiness and the ops watchdog read it. */
export interface GatewayBreakerInfo extends BreakerSnapshot {
  /** Metric/alert grouping: the provider of an LLM engine, or `embedding`. */
  component: string;
  /** Stable key: `engine:<id>` or `embed:voyage`. */
  key: string;
}

export interface GatewayRequest {
  tenantId: number;
  function: AiFunction;
  /** Per-call deadline override in ms (default `AI_REQUEST_TIMEOUT_MS`) — small JSON calls use a short one. */
  timeoutMs?: number;
  /**
   * What is spending, finer than the function (PLN-260824 D2).
   *
   * `summary` alone covers the knowledge-conflict review and the agent
   * briefing, so per-function totals cannot answer which screen costs what.
   * Optional: an unlabelled call is metered under its function name rather
   * than dropped.
   */
  feature?: string;
  system?: string;
  /** Classic string messages, or the block messages of a tool turn (PLN-261012 SG-33). */
  messages: AiRequestMessage[];
  temperature?: number;
  maxTokens?: number;
  /**
   * Tools the model may call (PLN-261012 SG-33). Only an engine that can use tools gets them —
   * anything else is REFUSED (`toolsRefused`), never silently answered without them, and a failing
   * engine is never covered by the stub's text (the result is `degraded`, with no tool calls).
   */
  tools?: AiToolDef[];
}

/** Whether (and why not) the engine behind a (tenant, function) pair can run a tool loop. */
export interface ToolSupport {
  supported: boolean;
  /** `ok`, or why not — a bounded vocabulary for logs and the console. */
  reason: 'ok' | 'no_engine' | 'adapter_unsupported' | 'capability_missing';
  provider: string | null;
  engineId: number | null;
}

/** The capability token an engine row must carry to be handed tools (PLN-261012 SG-33). */
export const ENGINE_CAPABILITY_TOOLS = 'tools';

/** `ai_engines.capabilities` is a comma list; whether it declares `cap`. */
export function engineHasCapability(capabilities: string | null | undefined, cap: string): boolean {
  return (capabilities ?? '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .includes(cap);
}

/** Where a function's engine came from — shown in the console so an unset function is visible. */
export const ROUTING_SOURCE = {
  /** The tenant assigned this engine to this function explicitly. */
  EXPLICIT: 'explicit',
  /** Unset; borrowed from a related function (see FUNCTION_INHERITS). */
  INHERITED: 'inherited',
  TENANT_DEFAULT: 'tenant_default',
  PLATFORM_DEFAULT: 'platform_default',
  NONE: 'none',
} as const;
export type RoutingSource = (typeof ROUTING_SOURCE)[keyof typeof ROUTING_SOURCE];

export interface ResolvedRouting {
  engine: AiEngine | null;
  source: RoutingSource;
  /** The function it was borrowed from, when source is 'inherited'. */
  inheritedFrom?: AiFunction;
}

/**
 * Functions that borrow another function's engine when they have no row of
 * their own, in preference order.
 *
 * Without this, a function added after a tenant was provisioned has no setting,
 * so resolution walks past it to the platform default — which is the stub. A
 * tenant running Anthropic for every customer conversation would silently get
 * canned stub text on the new function and no indication why. Coaching is a
 * conversational function, so the engine already trusted with customer
 * conversations is a far better default than "no engine at all".
 */
const FUNCTION_INHERITS: Partial<Record<AiFunction, AiFunction[]>> = {
  coach: ['rag', 'chat'],
};

/**
 * AI Provider Gateway (FR-070 / FN-053). Resolves the engine for a
 * (tenant, function) pair via tenant_ai_settings → ai_engines, dispatches to the
 * matching provider adapter, and normalizes the result. Degrades to the stub
 * adapter when the resolved provider is unavailable, so flows never hard-fail.
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);
  private readonly adapters: Map<string, AiAdapter>;

  constructor(
    @InjectRepository(AiEngine) private readonly engineRepo: Repository<AiEngine>,
    @InjectRepository(TenantAiSetting) private readonly settingRepo: Repository<TenantAiSetting>,
    stub: StubAdapter,
    anthropic: AnthropicAdapter,
    openai: OpenAiAdapter,
    voyage: VoyageAdapter,
    private readonly usage: AiUsageService,
    // Appended and optional so positional test doubles that predate it stay valid.
    @Optional() private readonly creditAlert?: AiCreditAlertService,
  ) {
    this.adapters = new Map<string, AiAdapter>([
      [stub.provider, stub],
      [anthropic.provider, anthropic],
      [openai.provider, openai],
      [voyage.provider, voyage],
    ]);
  }

  /**
   * The adapter for a provider, or null when nothing can call it.
   *
   * Public so a caller that already knows which engine it means — the tenant
   * engine connection test — can reach the provider without a second registry
   * drifting out of step with this one.
   */
  adapterFor(provider: string): AiAdapter | null {
    return this.adapters.get(provider) ?? null;
  }

  /**
   * Can the engine behind (tenant, function) run a tool loop (PLN-261012 SG-33)? Two things must
   * hold: the provider's adapter implements tool calling, AND the engine row declares the `tools`
   * capability — the column existed but was never enforced; for tools it is, because an
   * OpenAI-compatible custom endpoint may not implement tools at all and only the operator knows.
   * Pure routing + capability reads: no provider call, no breaker state touched.
   */
  async toolSupport(tenantId: number, fn: AiFunction): Promise<ToolSupport> {
    const { engine } = await this.resolveRouting(tenantId, fn);
    const adapter = this.adapters.get(engine?.provider ?? 'stub') ?? this.adapters.get('stub')!;
    return this.toolSupportOf(engine, adapter);
  }

  private toolSupportOf(engine: AiEngine | null, adapter: AiAdapter): ToolSupport {
    const base = { provider: engine?.provider ?? null, engineId: engine ? Number(engine.id) : null };
    if (!engine) return { ...base, supported: false, reason: 'no_engine' };
    if (adapter.supportsTools !== true) return { ...base, supported: false, reason: 'adapter_unsupported' };
    if (!engineHasCapability(engine.capabilities, ENGINE_CAPABILITY_TOOLS)) {
      return { ...base, supported: false, reason: 'capability_missing' };
    }
    return { ...base, supported: true, reason: 'ok' };
  }

  async complete(req: GatewayRequest): Promise<AiCompletionResult> {
    const { engine } = await this.resolveRouting(req.tenantId, req.function);
    const params = (await this.resolveParams(req.tenantId, req.function)) ?? {};
    const adapter = this.adapters.get(engine?.provider ?? 'stub') ?? this.adapters.get('stub')!;

    // A tools request to an engine that cannot use tools is refused outright (SG-33): not sent,
    // not metered, and not answered by the stub. The runner pre-checks `toolSupport`, so this is the
    // backstop for a caller that forgot — or for an engine switched mid-loop.
    if (req.tools?.length) {
      const support = this.toolSupportOf(engine, adapter);
      if (!support.supported) {
        this.logger.warn(`tools request refused: engine ${support.engineId ?? 'none'} (${support.reason})`);
        return {
          text: '',
          tokensIn: 0,
          tokensOut: 0,
          provider: adapter.provider,
          model: engine?.model ?? 'stub-1',
          degraded: true,
          toolsRefused: true,
          stopReason: 'other',
        };
      }
    }

    const apiKey = engine?.apiKeyEncrypted ? this.safeDecrypt(engine.apiKeyEncrypted) : undefined;
    // A breaker guards REAL engines only; the stub cannot fail and has nothing to protect.
    const real = !!engine && adapter.provider !== 'stub';
    const feature = safeLabel(req.feature ?? req.function);
    const breaker = real ? this.breakerFor(`engine:${engine!.id}`, adapter.provider) : null;
    const startedAt = this.hooks.now?.() ?? Date.now();

    // Open breaker (PLN-261012 SG-84): the engine just failed `failureThreshold` times in a row,
    // so spending the full request timeout on it again would only make every customer turn wait
    // for the stub. Same contract as any adapter failure — stub text, `degraded: true` — but
    // without the network call and without rewriting the engine's health row on every turn.
    if (breaker && !breaker.allow()) {
      m.llmCalls.inc({ feature, provider: adapter.provider, status: 'breaker_open' });
      this.logSkipped(`engine:${engine!.id}`, `Engine ${engine!.id} (${adapter.provider}) circuit open — skipping calls, using stub`);
      return this.degradedFallback(req, engine, adapter.provider);
    }

    try {
      const call = () =>
        adapter.complete({
          system: req.system,
          messages: req.messages,
          temperature: req.temperature ?? (params.temperature as number) ?? 0.3,
          maxTokens: req.maxTokens ?? (params.max_tokens as number) ?? 1024,
          model: engine?.model ?? 'stub-1',
          apiKey,
          endpoint: engine?.endpoint ?? undefined,
          timeoutMs: req.timeoutMs,
          ...(req.tools?.length ? { tools: req.tools } : {}),
        });
      // A completion is retried once, and only on what a second try can fix: a dropped
      // connection, a 5xx, a 429. Never on a timeout (that doubles the customer's wait for an
      // engine already too slow) and never on a 4xx.
      const res = real
        ? await retryWithJitter(call, {
            retries: Math.max(0, Math.round(envNumber('AI_MAX_RETRIES', 1))),
            retryOn: isTransientError,
            sleep: this.hooks.sleep,
            random: this.hooks.random,
            onRetry: (err) => {
              m.llmRetries.inc({ provider: adapter.provider });
              this.logger.warn(`Adapter ${adapter.provider} transient failure, retrying: ${(err as Error).message}`);
            },
          })
        : await call();
      breaker?.recordSuccess();
      if (real) {
        m.llmCalls.inc({ feature, provider: adapter.provider, status: 'ok' });
        m.llmDuration.observe({ provider: adapter.provider }, ((this.hooks.now?.() ?? Date.now()) - startedAt) / 1000);
      }
      this.meter(req, engine, res, { stub: adapter.provider === 'stub' });
      if (engine && adapter.provider !== 'stub') this.recordHealth(engine.id, null);
      return res;
    } catch (e) {
      const message = (e as Error).message ?? '';
      this.logger.warn(`Adapter ${adapter.provider} failed, falling back to stub: ${message}`);
      if (breaker) {
        // A request-level rejection (a 400) proves the engine is reachable; only engine-level
        // failures move the breaker.
        if (isEngineFailure(e)) breaker.recordFailure();
        else breaker.recordSuccess();
      }
      if (real) {
        m.llmCalls.inc({
          feature,
          provider: adapter.provider,
          status: e instanceof AiTimeoutError ? 'timeout' : 'error',
        });
        m.llmDuration.observe({ provider: adapter.provider }, ((this.hooks.now?.() ?? Date.now()) - startedAt) / 1000);
      }
      if (engine && adapter.provider !== 'stub') this.recordHealth(engine.id, message);
      return this.degradedFallback(req, engine, adapter.provider);
    }
  }

  /**
   * The stub's answer for a call the real engine could not serve (failed, or skipped by an open
   * breaker). Recorded against the engine that was SUPPOSED to answer, not against the stub that
   * caught it — otherwise a failing engine shows no usage and no failures, and looks simply
   * unused.
   */
  private async degradedFallback(
    req: GatewayRequest,
    engine: AiEngine | null,
    provider: string,
  ): Promise<AiCompletionResult> {
    // Deliberately WITHOUT `tools` (PLN-261012 SG-33): the stub never sees a tool list, so it cannot
    // answer with tool calls — what comes back is canned text marked `degraded`, which a tool loop
    // treats as "abort", never as a model decision. The tool-turn blocks in `messages` are flattened
    // by the stub; nothing in this path produces or executes a tool use.
    const res = await this.adapters.get('stub')!.complete({
      system: req.system,
      messages: req.messages,
      model: 'stub-1',
    });
    this.meter(req, engine, res, { stub: true, failed: true });
    // Marked so nothing customer-facing mistakes the stub's canned text for
    // an answer (PLN-261007 D4) — on 2026-10-06 it reached 39 go2joy
    // conversations 121 times, and the stub's moderation verdict ("not
    // flagged") stood in for the real one.
    return { ...res, degraded: provider !== 'stub' };
  }

  /**
   * Test seam for time, sleeping and jitter (PLN-261012 SG-84). Production leaves it empty, so
   * the real clock, `setTimeout` and `Math.random` apply; specs set it before the first call
   * (breakers read the clock when they are created).
   */
  readonly hooks: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
  } = {};

  private readonly breakers = new Map<string, { breaker: CircuitBreaker; component: string }>();

  /**
   * The breaker for one engine (or `embed:voyage`), created on first use. Null when the operator
   * switched the feature off with `AI_BREAKER_ENABLED=0`.
   */
  private breakerFor(key: string, component: string): CircuitBreaker | null {
    if (!breakerEnabled()) return null;
    let entry = this.breakers.get(key);
    if (!entry) {
      const breaker = new CircuitBreaker({
        ...breakerOptionsFromEnv(),
        now: this.hooks.now,
        onTransition: (from, to) => {
          m.breakerTransitions.inc({ component, to });
          const log = to === 'open' ? this.logger.warn : this.logger.log;
          log.call(this.logger, `Circuit breaker ${key} (${component}): ${from} -> ${to}`);
        },
      });
      entry = { breaker, component };
      this.breakers.set(key, entry);
    }
    return entry.breaker;
  }

  private readonly lastSkipLog = new Map<string, number>();

  /** One line per breaker per 30 s: a skipped call happens on every customer turn while it is open. */
  private logSkipped(key: string, message: string): void {
    const now = this.hooks.now?.() ?? Date.now();
    if (now - (this.lastSkipLog.get(key) ?? 0) < 30_000) return;
    this.lastSkipLog.set(key, now);
    this.logger.warn(message);
  }

  /** Every breaker's current state — read by `/metrics`, readiness and the ops watchdog. */
  breakerSnapshots(): GatewayBreakerInfo[] {
    return [...this.breakers.entries()].map(([key, e]) => ({
      key,
      component: e.component,
      ...e.breaker.snapshot(),
    }));
  }

  /** Successes are written at most this often per engine; failures always. */
  private static readonly HEALTH_OK_THROTTLE_MS = 60_000;
  private readonly lastOkWrite = new Map<number, number>();

  /**
   * Remember what an engine last did (PLN-261007 S3). Not awaited, never
   * throws: this is on the path that answers a customer, and a health column
   * is not worth delaying or breaking that for. `error` null = success.
   */
  recordHealth(engineId: number | string, error: string | null, now = new Date()): void {
    const id = Number(engineId);
    if (!Number.isFinite(id)) return;
    let patch: Partial<AiEngine>;
    if (error === null) {
      const last = this.lastOkWrite.get(id) ?? 0;
      if (now.getTime() - last < AiGatewayService.HEALTH_OK_THROTTLE_MS) return;
      this.lastOkWrite.set(id, now.getTime());
      patch = { lastOkAt: now };
      // First success after a credit alert sends the recovery mail (no-op otherwise).
      void this.creditAlert?.onRecovered(id, now);
    } else {
      // A failure must be visible on the next read, so the throttle is reset:
      // the first success after it is written immediately.
      this.lastOkWrite.delete(id);
      const reason = classifyEngineFailure(error);
      patch = {
        lastErrorAt: now,
        lastErrorReason: reason,
        lastErrorDetail: error.slice(0, 255),
      };
      // Out of credit: mail the operator (PLN-261007-AI-Credit-Alert), at most
      // once per engine per window — the service keeps the count, not us.
      if (reason === ENGINE_FAILURE.CREDIT) void this.creditAlert?.onCredit(id, error, now);
    }
    void this.engineRepo
      .update({ id }, patch)
      .catch((e) => this.logger.warn(`engine health not recorded: ${(e as Error).message}`));
  }

  /**
   * Record one call's usage. Deliberately not awaited.
   *
   * This sits on the path that answers a customer. A slow or throwing meter
   * would delay or break a conversation to protect a statistic, which is the
   * wrong trade — the number is a side effect, not part of the answer.
   */
  private meter(
    req: GatewayRequest,
    engine: AiEngine | null,
    res: AiCompletionResult,
    flags: { stub?: boolean; failed?: boolean },
  ): void {
    void this.usage
      .record({
        tenantId: req.tenantId,
        feature: req.feature ?? req.function,
        aiFunction: req.function,
        engineId: engine ? Number(engine.id) : null,
        provider: engine?.provider ?? res.provider,
        model: engine?.model ?? res.model,
        engineOwner: AiUsageService.ownerOf(engine?.tenantId),
        tokensIn: res.tokensIn ?? 0,
        tokensOut: res.tokensOut ?? 0,
        ...flags,
      })
      .catch((e) => this.logger.warn(`ai usage not recorded: ${(e as Error).message}`));
  }

  /**
   * Embed texts for vector retrieval. Deliberately NOT tenant-routed: all
   * tenants share one Qdrant collection, so every point must come from the
   * same model/vector space. Voyage when VOYAGE_API_KEY is set, else the
   * deterministic stub (keyless dev). Errors degrade to the stub so KB writes
   * never hard-fail on the embedding step.
   */
  async embed(texts: string[], inputType: 'query' | 'document'): Promise<AiEmbeddingResult> {
    const voyage = this.adapters.get('voyage')!;
    const stub = this.adapters.get('stub')!;
    if (process.env.VOYAGE_API_KEY) {
      const breaker = this.breakerFor('embed:voyage', 'embedding');
      const live = inputType === 'query';
      // Only a LIVE query is short-circuited by an open breaker (PLN-261012 SG-84): it is the one
      // that blocks a customer's turn. Document embeddings (KB writes, reindex) keep trying — they
      // are operator-driven and low-rate, and skipping them would write stub vectors into the
      // shared collection for as long as the breaker stays open.
      if (live && breaker && !breaker.allow()) {
        m.embedFailures.inc({ provider: 'voyage', reason: 'breaker_open' });
        this.logSkipped('embed:voyage', 'Voyage embedding circuit open — using the stub embedder for live queries');
      } else {
        try {
          // Embeddings are idempotent, so they get a bounded retry with jitter. A live query
          // retries once on a transient failure only; document batches also retry a timeout.
          const res = await retryWithJitter(() => voyage.embed!({ texts, inputType }), {
            retries: live
              ? Math.max(0, Math.round(envNumber('EMBED_QUERY_RETRIES', 1)))
              : Math.max(0, Math.round(envNumber('EMBED_DOCUMENT_RETRIES', 2))),
            retryOn: live ? isTransientError : (err) => isTransientError(err) || err instanceof AiTimeoutError,
            sleep: this.hooks.sleep,
            random: this.hooks.random,
            onRetry: () => m.llmRetries.inc({ provider: 'voyage' }),
          });
          breaker?.recordSuccess();
          return res;
        } catch (e) {
          if (breaker) {
            if (isEngineFailure(e)) breaker.recordFailure();
            else breaker.recordSuccess();
          }
          m.embedFailures.inc({ provider: 'voyage', reason: failureReason(e) });
          this.logger.warn(`Voyage embed failed, falling back to stub: ${(e as Error).message}`);
        }
      }
    }
    return stub.embed!({ texts, inputType });
  }

  /**
   * Which engine actually backs a (tenant, function) pair, and why.
   *
   * Public because the console needs to show the effective engine for functions
   * the tenant never configured — the fallback used to be invisible, which is
   * how a function could run on the stub while the settings page showed nothing
   * at all for it.
   */
  async resolveRouting(tenantId: number, fn: AiFunction): Promise<ResolvedRouting> {
    const own = await this.enabledEngineFor(tenantId, fn);
    if (own) return { engine: own, source: ROUTING_SOURCE.EXPLICIT };

    for (const donor of FUNCTION_INHERITS[fn] ?? []) {
      const borrowed = await this.enabledEngineFor(tenantId, donor);
      if (borrowed) {
        return { engine: borrowed, source: ROUTING_SOURCE.INHERITED, inheritedFrom: donor };
      }
    }

    const tenantDefault = await this.engineRepo.findOne({
      where: { tenantId, isDefault: 1, status: 'enabled' },
    });
    if (tenantDefault) return { engine: tenantDefault, source: ROUTING_SOURCE.TENANT_DEFAULT };

    // `tenantId: IsNull()` is the difference between a platform default and
    // *somebody's* default. Without it this picks any enabled engine flagged
    // default, including one a tenant created — and a tenant's engine carries
    // a tenant's API key, so another shop's conversation would have been
    // answered on it and billed to them. Nothing had a tenant-owned engine
    // when this was written, which is why it never showed; opening engine
    // registration to tenants is exactly what would have made it real
    // (REQ-260824 D-2).
    const platformDefault = await this.engineRepo.findOne({
      where: { tenantId: IsNull(), isDefault: 1, status: 'enabled' },
    });
    return platformDefault
      ? { engine: platformDefault, source: ROUTING_SOURCE.PLATFORM_DEFAULT }
      : { engine: null, source: ROUTING_SOURCE.NONE };
  }

  /** The enabled engine a function is explicitly assigned, if any. */
  private async enabledEngineFor(tenantId: number, fn: AiFunction): Promise<AiEngine | null> {
    const setting = await this.settingRepo.findOne({ where: { tenantId, func: fn } });
    if (!setting) return null;
    const engine = await this.engineRepo.findOne({ where: { id: setting.engineId } });
    return engine && engine.status === 'enabled' ? engine : null;
  }

  private async resolveParams(tenantId: number, fn: AiFunction): Promise<Record<string, unknown> | null> {
    const setting = await this.settingRepo.findOne({ where: { tenantId, func: fn } });
    return setting?.paramsJson ?? null;
  }

  private safeDecrypt(buf: Buffer): string | undefined {
    try {
      return decryptSecret(buf);
    } catch {
      return undefined;
    }
  }
}
