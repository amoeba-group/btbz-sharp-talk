import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { AiEngine } from './entity/ai-engine.entity';
import { CreateEngineRequest, UpdateEngineRequest } from './dto/request/ai-engine.request';
import { encryptSecret } from '../../global/util/crypto.util';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { AiGatewayService } from '../../infrastructure/external/ai/ai-gateway.service';
import { Tenant } from '../tenant/entity/tenant.entity';
import { AiUsageService } from './ai-usage.service';
import { AiEngineMapper } from './ai-engine.mapper';
import { EngineTestResult, runEngineTest } from './tenant-ai-engine.service';

/**
 * Platform AI engine catalog management (FR-070). Admin-managed; engines may be
 * platform-wide (tenant_id null) or tenant-specific. API keys are encrypted at
 * rest (encryptSecret) and never returned in responses.
 */
@Injectable()
export class AiEngineService {
  constructor(
    @InjectRepository(AiEngine) private readonly engineRepo: Repository<AiEngine>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    private readonly gateway: AiGatewayService,
    private readonly usage: AiUsageService,
  ) {}

  /**
   * The admin catalog with each engine's owner, health and today's traffic
   * (PLN-261007 S4). Tenant engines are included on purpose: the go2joy credit
   * outage was a tenant engine, and the operator had no screen that showed it.
   */
  async listForAdmin() {
    const engines = await this.list();
    const tenantIds = [...new Set(engines.map((e) => e.tenantId).filter((v): v is number => v != null))];
    const tenants = tenantIds.length
      ? await this.tenantRepo.find({ where: { id: In(tenantIds) }, select: { id: true, slug: true } })
      : [];
    const slugById = new Map(tenants.map((t) => [Number(t.id), t.slug] as const));
    const today = await this.usage.todayByEngine();
    return engines.map((e) =>
      AiEngineMapper.toAdminEngine(
        e,
        e.tenantId != null ? (slugById.get(Number(e.tenantId)) ?? null) : null,
        today.get(Number(e.id)),
      ),
    );
  }

  /** Connection test from the admin console — platform and tenant engines alike. */
  async test(id: number): Promise<{ engine: AiEngine; result: EngineTestResult }> {
    const engine = await this.findEngine(id);
    return { engine, result: await runEngineTest(this.gateway, engine) };
  }

  async list(): Promise<AiEngine[]> {
    return this.engineRepo.find({ order: { id: 'DESC' } });
  }

  /**
   * Enabled engines one tenant may assign a function to: its own, plus the
   * platform ones.
   *
   * This used to return every enabled engine in the installation. With only
   * platform engines that was the same list; the moment tenants can register
   * their own it stops being — one shop's picker would show another shop's
   * engine names and models. Assignment was already refused
   * (`AiSettingService.upsert`), so the leak was the listing itself, plus a
   * choice that could only end in a 400 (REQ-260824 D-1).
   */
  async listEnabledFor(tenantId: number): Promise<AiEngine[]> {
    return this.engineRepo.find({
      where: [
        { status: 'enabled', tenantId: IsNull() },
        { status: 'enabled', tenantId },
      ],
      order: { id: 'DESC' },
    });
  }

  /** Every enabled engine, for the admin catalog. Not for tenant-facing lists. */
  async listEnabled(): Promise<AiEngine[]> {
    return this.engineRepo.find({ where: { status: 'enabled' }, order: { id: 'DESC' } });
  }

  async create(body: CreateEngineRequest): Promise<AiEngine> {
    const engine = this.engineRepo.create({
      tenantId: body.tenant_id ?? null,
      provider: body.provider,
      name: body.name,
      model: body.model,
      endpoint: body.endpoint ?? null,
      apiKeyEncrypted: body.api_key ? encryptSecret(body.api_key) : null,
      capabilities: body.capabilities ?? 'chat,rag,summary,assist,moderation',
      status: 'enabled',
      isDefault: body.is_default ?? 0,
    });
    return this.engineRepo.save(engine);
  }

  async update(id: number, body: UpdateEngineRequest): Promise<AiEngine> {
    const engine = await this.findEngine(id);
    if (body.provider !== undefined) engine.provider = body.provider;
    if (body.name !== undefined) engine.name = body.name;
    if (body.model !== undefined) engine.model = body.model;
    if (body.endpoint !== undefined) engine.endpoint = body.endpoint;
    if (body.capabilities !== undefined) engine.capabilities = body.capabilities;
    if (body.status !== undefined) engine.status = body.status;
    if (body.is_default !== undefined) engine.isDefault = body.is_default;
    if (body.tenant_selectable !== undefined) engine.tenantSelectable = body.tenant_selectable ? 1 : 0;
    // An empty box means "keep the stored key" — the form never shows it.
    if (body.api_key) engine.apiKeyEncrypted = encryptSecret(body.api_key);
    return this.engineRepo.save(engine);
  }

  async remove(id: number): Promise<void> {
    await this.findEngine(id);
    await this.engineRepo.delete({ id });
  }

  async findEngine(id: number): Promise<AiEngine> {
    const engine = await this.engineRepo.findOne({ where: { id } });
    if (!engine) {
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return engine;
  }
}
