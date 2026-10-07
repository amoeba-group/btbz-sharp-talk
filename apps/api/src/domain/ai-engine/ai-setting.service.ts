import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AiFunction } from '@sharptalk/types';
import { AiEngine } from './entity/ai-engine.entity';
import { TenantAiSetting } from './entity/tenant-ai-setting.entity';
import { AI_FUNCTIONS, UpsertAiSettingRequest } from './dto/request/ai-engine.request';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import {
  AiGatewayService,
  ROUTING_SOURCE,
  RoutingSource,
} from '../../infrastructure/external/ai/ai-gateway.service';

/** One row of the console's AI-functions table. */
export interface AiSettingView {
  func: string;
  /** The tenant's explicit choice, or null when it has never set one. */
  setting: TenantAiSetting | null;
  /** What actually runs today, after inheritance and defaults. */
  effectiveEngineId: number | null;
  effectiveEngineName: string | null;
  effectiveProvider: string | null;
  source: RoutingSource;
  inheritedFrom?: string;
}

/**
 * Per-tenant AI function->engine selection (FR-070). Resolves which engine and
 * params back each AI function for a tenant.
 */
@Injectable()
export class AiSettingService {
  constructor(
    @InjectRepository(TenantAiSetting)
    private readonly settingRepo: Repository<TenantAiSetting>,
    @InjectRepository(AiEngine) private readonly engineRepo: Repository<AiEngine>,
    private readonly gateway: AiGatewayService,
  ) {}

  /**
   * Every known AI function, whether or not the tenant has configured it, with
   * the engine that actually serves it today.
   *
   * It used to return only existing rows. A function added after a tenant was
   * provisioned therefore had no row, so it never appeared in the console and
   * could not be assigned an engine — while silently running on whatever the
   * fallback chain landed on (the stub). Listing the full set makes both the
   * gap and its consequence visible.
   */
  async list(tenantId: number): Promise<AiSettingView[]> {
    const rows = await this.settingRepo.find({ where: { tenantId } });
    const byFunc = new Map(rows.map((r) => [r.func, r] as const));

    const engineIds = [...new Set(rows.map((r) => r.engineId))];
    const engines = engineIds.length
      ? await this.engineRepo.find({ where: { id: In(engineIds) } })
      : [];
    const nameById = new Map(engines.map((e) => [e.id, e.name] as const));

    return Promise.all(
      [...AI_FUNCTIONS].map(async (func) => {
        const setting = byFunc.get(func) ?? null;
        const routing = await this.gateway.resolveRouting(tenantId, func as AiFunction);
        return {
          func,
          setting,
          effectiveEngineId: routing.engine?.id ?? null,
          effectiveEngineName:
            routing.engine?.name ?? (setting ? (nameById.get(setting.engineId) ?? null) : null),
          effectiveProvider: routing.engine?.provider ?? null,
          source: setting ? ROUTING_SOURCE.EXPLICIT : routing.source,
          inheritedFrom: routing.inheritedFrom,
        };
      }),
    );
  }

  /**
   * The engine a tenant may point a function at (PLN-261007 D1): its own, or a
   * platform engine the operator opened for selection — never another tenant's,
   * never a disabled one, never the stub (choosing it is switching the AI off).
   * A platform engine bills the operator's key, which is why it is opt-in.
   */
  private async assertSelectable(tenantId: number, engineId: number): Promise<AiEngine> {
    const engine = await this.engineRepo.findOne({ where: { id: engineId } });
    if (!engine || (engine.tenantId != null && Number(engine.tenantId) !== Number(tenantId))) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    const platformClosed = engine.tenantId == null && engine.tenantSelectable !== 1;
    if (engine.provider === 'stub' || engine.status !== 'enabled' || platformClosed) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    return engine;
  }

  /**
   * One engine for every function (PLN-261007 S5) — what an operator means by
   * "use this engine". Per-function choices made earlier are replaced; the
   * console says so before calling.
   */
  async applyToAll(tenantId: number, engineId: number): Promise<TenantAiSetting[]> {
    const engine = await this.assertSelectable(tenantId, engineId);
    const out: TenantAiSetting[] = [];
    await this.settingRepo.manager.transaction(async (m) => {
      const repo = m.getRepository(TenantAiSetting);
      for (const func of AI_FUNCTIONS) {
        const existing = await repo.findOne({ where: { tenantId, func } });
        if (existing) {
          existing.engineId = Number(engine.id);
          out.push(await repo.save(existing));
        } else {
          out.push(
            await repo.save(repo.create({ tenantId, func, engineId: Number(engine.id), paramsJson: null })),
          );
        }
      }
    });
    return out;
  }

  /** Upsert the engine assigned to a tenant's AI function. */
  async upsert(
    tenantId: number,
    func: string,
    body: UpsertAiSettingRequest,
  ): Promise<TenantAiSetting> {
    await this.assertSelectable(tenantId, body.engine_id);

    const existing = await this.settingRepo.findOne({ where: { tenantId, func } });
    if (existing) {
      existing.engineId = body.engine_id;
      existing.paramsJson = body.params ?? null;
      return this.settingRepo.save(existing);
    }
    const setting = this.settingRepo.create({
      tenantId,
      func,
      engineId: body.engine_id,
      paramsJson: body.params ?? null,
    });
    return this.settingRepo.save(setting);
  }
}
