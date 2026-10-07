import { Injectable, Logger } from '@nestjs/common';
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
  AiMessage,
} from './ai-adapter.interface';
import { StubAdapter } from './adapters/stub.adapter';
import { classifyEngineFailure } from './engine-health';
import { AnthropicAdapter } from './adapters/anthropic.adapter';
import { OpenAiAdapter } from './adapters/openai.adapter';
import { VoyageAdapter } from './adapters/voyage.adapter';

export interface GatewayRequest {
  tenantId: number;
  function: AiFunction;
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
  messages: AiMessage[];
  temperature?: number;
  maxTokens?: number;
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

  async complete(req: GatewayRequest): Promise<AiCompletionResult> {
    const { engine } = await this.resolveRouting(req.tenantId, req.function);
    const params = (await this.resolveParams(req.tenantId, req.function)) ?? {};
    const adapter = this.adapters.get(engine?.provider ?? 'stub') ?? this.adapters.get('stub')!;

    const apiKey = engine?.apiKeyEncrypted ? this.safeDecrypt(engine.apiKeyEncrypted) : undefined;
    try {
      const res = await adapter.complete({
        system: req.system,
        messages: req.messages,
        temperature: req.temperature ?? (params.temperature as number) ?? 0.3,
        maxTokens: req.maxTokens ?? (params.max_tokens as number) ?? 1024,
        model: engine?.model ?? 'stub-1',
        apiKey,
        endpoint: engine?.endpoint ?? undefined,
      });
      this.meter(req, engine, res, { stub: adapter.provider === 'stub' });
      if (engine && adapter.provider !== 'stub') this.recordHealth(engine.id, null);
      return res;
    } catch (e) {
      const message = (e as Error).message ?? '';
      this.logger.warn(`Adapter ${adapter.provider} failed, falling back to stub: ${message}`);
      if (engine && adapter.provider !== 'stub') this.recordHealth(engine.id, message);
      const res = await this.adapters.get('stub')!.complete({
        system: req.system,
        messages: req.messages,
        model: 'stub-1',
      });
      // Recorded against the engine that was SUPPOSED to answer, not against
      // the stub that caught it — otherwise a failing engine shows no usage and
      // no failures, and looks simply unused.
      this.meter(req, engine, res, { stub: true, failed: true });
      // Marked so nothing customer-facing mistakes the stub's canned text for
      // an answer (PLN-261007 D4) — on 2026-10-06 it reached 39 go2joy
      // conversations 121 times, and the stub's moderation verdict ("not
      // flagged") stood in for the real one.
      return { ...res, degraded: adapter.provider !== 'stub' };
    }
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
    } else {
      // A failure must be visible on the next read, so the throttle is reset:
      // the first success after it is written immediately.
      this.lastOkWrite.delete(id);
      patch = {
        lastErrorAt: now,
        lastErrorReason: classifyEngineFailure(error),
        lastErrorDetail: error.slice(0, 255),
      };
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
      try {
        return await voyage.embed!({ texts, inputType });
      } catch (e) {
        this.logger.warn(`Voyage embed failed, falling back to stub: ${(e as Error).message}`);
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
