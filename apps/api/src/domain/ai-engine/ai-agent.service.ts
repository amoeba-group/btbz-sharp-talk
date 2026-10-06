import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AI_AGENT_CODE_PATTERN, AiAgent } from './entity/ai-agent.entity';
import { TenantAiConfig } from './entity/tenant-ai-config.entity';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { AuditService } from '../audit/audit.service';
import { GUEST_POLICY, type GuestPolicy } from '@sharptalk/types';

/** Shared with the coach limits: a persona longer than this stops fitting the prompt budget. */
const PERSONA_MAX_CHARS = 4000;

export interface AiAgentInput {
  name?: string;
  /** Shopper-facing name; blank clears (falls back to the tenant name). */
  displayName?: string | null;
  persona?: string | null;
  rules?: string[] | null;
  /** Per-agent first message, lang→text; empty map clears (tenant fallback). */
  greeting?: Record<string, string> | null;
  active?: boolean;
  /** `open` | `login_guidance` (PLN-261001 v1.1). */
  guestPolicy?: GuestPolicy;
}

/** Widget-copy language keys — mirrors tenants.widget_copy (uppercase codes). */
const GREETING_LANGS = new Set(['EN', 'ES', 'KO', 'VI', 'JA', 'ZH']);
const GREETING_MAX_CHARS = 500;

/** Keep only known languages with non-blank text; nothing left → NULL. */
function sanitizeGreeting(input: Record<string, string> | null | undefined): Record<string, string> | null {
  if (!input) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    const lang = key.toUpperCase();
    if (!GREETING_LANGS.has(lang) || typeof value !== 'string') continue;
    const text = value.trim().slice(0, GREETING_MAX_CHARS);
    if (text) out[lang] = text;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * CRUD for a tenant's AI agents (PLN-260820). Runtime persona resolution stays
 * in AiConfigService (it owns the cache); this service owns the list the
 * console edits and the invariants: exactly one default per tenant, the default
 * can never be deleted or deactivated (it is the routing fallback — losing it
 * would leave unpinned sessions with nothing to answer as).
 */
@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);

  constructor(
    @InjectRepository(AiAgent) private readonly agentRepo: Repository<AiAgent>,
    @InjectRepository(TenantAiConfig) private readonly configRepo: Repository<TenantAiConfig>,
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    // Optional so existing specs that build the service with four arguments
    // keep working; the module always provides it.
    private readonly audit?: AuditService,
  ) {}

  /**
   * Drop the cached persona for this agent AND the default slot. The 60s TTL
   * would eventually converge, but an operator who just saved a persona and
   * asks the preview panel expects the new voice immediately.
   */
  private async invalidatePersonaCache(tenantId: number, agentId?: number | null): Promise<void> {
    // Key scheme shared with AiConfigService.personaCacheKey — inlined here to
    // keep the import graph one-way (config service → agent service).
    if (agentId != null) await this.redis.del(`aicfg:persona:${tenantId}:${agentId}`);
    await this.redis.del(`aicfg:persona:${tenantId}:default`);
  }

  /** Console list — the default agent always exists (created lazily from the legacy config). */
  async list(tenantId: number): Promise<AiAgent[]> {
    await this.ensureDefault(tenantId);
    return this.agentRepo.find({
      where: { tenantId },
      order: { isDefault: 'DESC', id: 'ASC' },
    });
  }

  async require(tenantId: number, id: number): Promise<AiAgent> {
    const row = await this.agentRepo.findOne({ where: { id, tenantId } });
    if (!row) {
      this.logger.warn(`ai agent not found: tenant=${tenantId} id=${id}`);
      throw new BusinessException(ERROR_CODE.AI_AGENT_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return row;
  }

  async create(
    tenantId: number,
    input: {
      code: string;
      name: string;
      persona?: string | null;
      rules?: string[] | null;
      guestPolicy?: GuestPolicy;
    },
  ): Promise<AiAgent> {
    const code = input.code?.trim().toLowerCase();
    if (!code || !AI_AGENT_CODE_PATTERN.test(code)) {
      this.logger.warn(`ai agent code rejected: tenant=${tenantId} code=${input.code}`);
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    const dup = await this.agentRepo.findOne({ where: { tenantId, code } });
    if (dup) {
      this.logger.warn(`ai agent code taken: tenant=${tenantId} code=${code}`);
      throw new BusinessException(ERROR_CODE.AI_AGENT_CODE_TAKEN, HttpStatus.CONFLICT);
    }
    // First agent ever (legacy tenant that never opened the list) — make sure
    // the default exists first so the new agent doesn't become the only row.
    await this.ensureDefault(tenantId);
    return this.agentRepo.save(
      this.agentRepo.create({
        tenantId,
        code,
        name: input.name.trim().slice(0, 100),
        persona: this.clampPersona(input.persona),
        rules: input.rules ?? null,
        guestPolicy: input.guestPolicy ?? GUEST_POLICY.OPEN,
        active: 1,
        isDefault: 0,
      }),
    );
  }

  /** PATCH semantics: only fields the caller sent move — neighbours stay put. */
  async update(
    tenantId: number,
    id: number,
    input: AiAgentInput,
    actorUserId?: number | null,
  ): Promise<AiAgent> {
    const row = await this.require(tenantId, id);
    const policyBefore = row.guestPolicy || GUEST_POLICY.OPEN;
    if (input.name !== undefined) row.name = input.name.trim().slice(0, 100);
    if (input.displayName !== undefined) {
      const trimmed = (input.displayName ?? '').trim().slice(0, 100);
      row.displayName = trimmed || null;
    }
    if (input.persona !== undefined) row.persona = this.clampPersona(input.persona);
    if (input.rules !== undefined) row.rules = input.rules;
    if (input.greeting !== undefined) row.greeting = sanitizeGreeting(input.greeting);
    if (input.guestPolicy !== undefined && input.guestPolicy !== row.guestPolicy) {
      // The switch that can lock every unidentified visitor out of an agent is
      // worth a log line of its own, on top of the audit row the controller writes.
      this.logger.log(
        `ai agent guest policy: tenant=${tenantId} id=${id} ${row.guestPolicy || GUEST_POLICY.OPEN} → ${input.guestPolicy}`,
      );
      row.guestPolicy = input.guestPolicy;
    }
    if (input.active !== undefined) {
      if (!input.active && row.isDefault === 1) {
        this.logger.warn(`refused to deactivate default ai agent: tenant=${tenantId} id=${id}`);
        throw new BusinessException(ERROR_CODE.AI_AGENT_DEFAULT_LOCKED, HttpStatus.CONFLICT);
      }
      row.active = input.active ? 1 : 0;
    }
    const saved = await this.agentRepo.save(row);
    await this.invalidatePersonaCache(tenantId, Number(saved.id));
    const policyAfter = saved.guestPolicy || GUEST_POLICY.OPEN;
    if (policyAfter !== policyBefore) {
      // Privileged: flipping to login_guidance can lock every unidentified
      // visitor out of this agent (CLAUDE.md §2 — audit privileged actions).
      await this.audit?.write({
        tenantId,
        actorType: 'user',
        actorId: actorUserId ?? 0,
        action: 'ai_agent.guest_policy',
        target: `agent:${Number(saved.id)}`,
        metadata: { from: policyBefore, to: policyAfter },
      });
    }
    return saved;
  }

  async remove(tenantId: number, id: number): Promise<void> {
    const row = await this.require(tenantId, id);
    if (row.isDefault === 1) {
      this.logger.warn(`refused to delete default ai agent: tenant=${tenantId} id=${id}`);
      throw new BusinessException(ERROR_CODE.AI_AGENT_DEFAULT_LOCKED, HttpStatus.CONFLICT);
    }
    await this.agentRepo.delete({ id: row.id, tenantId });
    await this.invalidatePersonaCache(tenantId, Number(row.id));
    // Sessions pinned to the deleted agent are left as-is on purpose: persona
    // resolution treats a missing row as "use the default", so they degrade
    // gracefully instead of needing a mass update here.
  }

  /**
   * Make this agent the tenant's default. Transactional: clearing the old flag
   * and setting the new one must never be observable half-done, or persona
   * resolution would find zero (or two) defaults.
   */
  async setDefault(tenantId: number, id: number): Promise<AiAgent> {
    const row = await this.require(tenantId, id);
    await this.dataSource.transaction(async (em) => {
      await em.update(AiAgent, { tenantId }, { isDefault: 0 });
      // The fallback must always be able to answer.
      await em.update(AiAgent, { id: row.id, tenantId }, { isDefault: 1, active: 1 });
    });
    await this.invalidatePersonaCache(tenantId, Number(row.id));
    return this.require(tenantId, id);
  }

  // Code → id resolution lives in SessionService.resolveAiAgentId (the session
  // is what gets pinned, and the messenger ingest shares it) — not here.

  /**
   * The default agent row, created on first need. Seeds/migration backfill
   * cover existing tenants; this covers tenants created after the migration ran
   * (and dev databases that never ran it). Persona is inherited from the legacy
   * tenant_ai_config row so the switch is invisible to shoppers.
   */
  async ensureDefault(tenantId: number): Promise<AiAgent> {
    const existing = await this.agentRepo.findOne({ where: { tenantId, isDefault: 1 } });
    if (existing) return existing;
    const legacy = await this.configRepo.findOne({ where: { tenantId } });
    try {
      return await this.agentRepo.save(
        this.agentRepo.create({
          tenantId,
          code: 'default',
          name: 'Default',
          persona: legacy?.persona ?? null,
          rules: legacy?.rules ?? null,
          active: 1,
          isDefault: 1,
        }),
      );
    } catch {
      // Concurrent ensure lost the (tenant_id, code) race — the winner's row is
      // the default we wanted; a 'default'-coded row without the flag gets it back.
      const row = await this.agentRepo.findOne({ where: { tenantId, code: 'default' } });
      if (row && row.isDefault !== 1) {
        await this.agentRepo.update({ id: row.id }, { isDefault: 1, active: 1 });
        row.isDefault = 1;
      }
      if (row) return row;
      throw new BusinessException(ERROR_CODE.INTERNAL_ERROR, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  private clampPersona(persona: string | null | undefined): string | null {
    if (persona == null) return null;
    const trimmed = persona.trim();
    return trimmed ? trimmed.slice(0, PERSONA_MAX_CHARS) : null;
  }
}
