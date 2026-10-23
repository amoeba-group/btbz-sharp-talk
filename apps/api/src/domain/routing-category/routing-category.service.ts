import { HttpStatus, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { canonicalRegion } from '@sharptalk/types';
import { RoutingCategory } from './entity/routing-category.entity';
import { TenantAiConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { Unit } from '../user/entity/unit.entity';
import { JobLabel } from '../user/entity/job-label.entity';
import { Company } from '../company/entity/company.entity';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/** Stored code shape after `canonicalRegion` folding. */
const CODE_PATTERN = /^[a-z0-9_]{1,64}$/;

/** Where a category code is referenced — names for the console, a count for companies. */
export interface RoutingCategoryUsage {
  rules: string[];
  units: string[];
  labels: string[];
  companies: number;
}

export interface RoutingCategoryResponse {
  id: string;
  code: string;
  name: string | null;
  sortOrder: number;
  usage: RoutingCategoryUsage;
}

/**
 * Tenant routing categories (PLN-261024-Settings-Handoff-Tab-Routing-Categories).
 *
 * Only the list lives here. Matching is unchanged: the handoff router still
 * compares a rule's stored codes with the session's signed `region`, both
 * folded by `canonicalRegion` — so creating, renaming or reordering never
 * changes who is paged, and a delete is refused while anything uses the code.
 */
@Injectable()
export class RoutingCategoryService {
  private readonly logger = new Logger(RoutingCategoryService.name);

  constructor(
    @InjectRepository(RoutingCategory) private readonly repo: Repository<RoutingCategory>,
    @InjectRepository(TenantAiConfig) private readonly aiConfigRepo: Repository<TenantAiConfig>,
    @InjectRepository(Unit) private readonly unitRepo: Repository<Unit>,
    @InjectRepository(JobLabel) private readonly labelRepo: Repository<JobLabel>,
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async list(tenantId: number): Promise<RoutingCategoryResponse[]> {
    const rows = await this.repo.find({ where: { tenantId }, order: { sortOrder: 'ASC', id: 'ASC' } });
    const usage = await this.usage(tenantId, rows.map((r) => r.code));
    return rows.map((r) => this.toResponse(r, usage.get(r.code)));
  }

  /** The tenant's codes — what a unit/label scope or a company filter may name. */
  async codes(tenantId: number): Promise<Set<string>> {
    const rows = await this.repo.find({ where: { tenantId }, select: { code: true } });
    return new Set(rows.map((r) => r.code));
  }

  /**
   * 400 E5109 unless every code is one of the tenant's categories; returns them
   * folded and de-duplicated. A typo would otherwise make a team silently
   * unreachable — the reason the old fixed catalogue was enforced in the DTO.
   */
  async assertCodes(tenantId: number, codes: string[]): Promise<string[]> {
    const folded = [...new Set(codes.map(canonicalRegion).filter(Boolean))];
    if (!folded.length) return folded;
    const known = await this.codes(tenantId);
    const unknown = folded.filter((c) => !known.has(c));
    if (unknown.length) {
      this.logger.warn(`unknown routing category tenant=${tenantId}: [${unknown.join(',')}]`);
      throw new BusinessException(ERROR_CODE.ROUTING_CATEGORY_NOT_FOUND, HttpStatus.BAD_REQUEST, { codes: unknown });
    }
    return folded;
  }

  async create(tenantId: number, actorId: number, rawCode: string, rawName?: string): Promise<RoutingCategoryResponse> {
    const code = canonicalRegion(rawCode);
    if (!CODE_PATTERN.test(code)) {
      this.logger.warn(`create routing category tenant=${tenantId}: bad code '${rawCode}'`);
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, { code: [rawCode] });
    }
    if (await this.repo.findOne({ where: { tenantId, code } })) {
      this.logger.warn(`create routing category tenant=${tenantId}: '${code}' exists`);
      throw new BusinessException(ERROR_CODE.ROUTING_CATEGORY_DUPLICATE, HttpStatus.CONFLICT, { code: [code] });
    }
    // Appended after the current last row so the list order is creation order.
    const last = await this.repo.findOne({ where: { tenantId }, order: { sortOrder: 'DESC' } });
    const name = rawName?.trim() || null;
    const row = await this.repo.save(this.repo.create({ tenantId, code, name, sortOrder: (last?.sortOrder ?? 0) + 10 }));
    await this.audit?.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'routing_category.created',
      target: `routing_category:${row.id} ${code}`,
      metadata: { name },
    });
    const usage = await this.usage(tenantId, [code]);
    return this.toResponse(row, usage.get(code));
  }

  /** Rename and reorder in one save; ids outside the tenant are E5109 (never touched). */
  async update(
    tenantId: number,
    actorId: number,
    items: Array<{ id: string; name?: string; sortOrder?: number }>,
  ): Promise<RoutingCategoryResponse[]> {
    const ids = [...new Set(items.map((i) => String(i.id)))];
    const rows = ids.length ? await this.repo.find({ where: { tenantId, id: In(ids) } }) : [];
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length) {
      this.logger.warn(`update routing categories tenant=${tenantId}: not found [${missing.join(',')}]`);
      throw new BusinessException(ERROR_CODE.ROUTING_CATEGORY_NOT_FOUND, HttpStatus.NOT_FOUND, { ids: missing });
    }
    const changes: Array<{ code: string; name?: [string | null, string | null]; sortOrder?: [number, number] }> = [];
    const dirty: RoutingCategory[] = [];
    for (const item of items) {
      const row = byId.get(String(item.id))!;
      const change: (typeof changes)[number] = { code: row.code };
      if (item.name !== undefined) {
        const name = item.name.trim() || null;
        if (name !== row.name) {
          change.name = [row.name, name];
          row.name = name;
        }
      }
      if (item.sortOrder !== undefined && item.sortOrder !== row.sortOrder) {
        change.sortOrder = [row.sortOrder, item.sortOrder];
        row.sortOrder = item.sortOrder;
      }
      if (change.name || change.sortOrder) {
        changes.push(change);
        dirty.push(row);
      }
    }
    if (dirty.length) {
      await this.repo.save(dirty);
      await this.audit?.write({
        tenantId,
        actorType: 'user',
        actorId,
        action: 'routing_category.updated',
        target: `routing_category:${dirty.map((r) => r.code).join(',')}`,
        metadata: { changes },
      });
    }
    return this.list(tenantId);
  }

  /** Delete one; 409 E5107 with where it is used while anything references the code (D6). */
  async remove(tenantId: number, actorId: number, id: string): Promise<{ deleted: true }> {
    const row = await this.repo.findOne({ where: { tenantId, id: id as unknown as number } });
    if (!row) {
      this.logger.warn(`routing category ${id} not found in tenant ${tenantId}`);
      throw new BusinessException(ERROR_CODE.ROUTING_CATEGORY_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    const used = (await this.usage(tenantId, [row.code])).get(row.code)!;
    if (used.rules.length || used.units.length || used.labels.length || used.companies) {
      this.logger.warn(
        `delete refused tenant=${tenantId} routing_category:${row.code}: rules=${used.rules.length} units=${used.units.length} labels=${used.labels.length} companies=${used.companies}`,
      );
      throw new BusinessException(ERROR_CODE.ROUTING_CATEGORY_IN_USE, HttpStatus.CONFLICT, {
        rules: used.rules,
        units: used.units,
        labels: used.labels,
        companies: used.companies ? [String(used.companies)] : [],
      });
    }
    await this.repo.delete({ id: row.id, tenantId });
    await this.audit?.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'routing_category.deleted',
      target: `routing_category:${row.id} ${row.code}`,
      metadata: { name: row.name },
    });
    return { deleted: true };
  }

  /** Per code: the routing rules, units and labels naming it, and how many companies sit in it. */
  async usage(tenantId: number, codes: string[]): Promise<Map<string, RoutingCategoryUsage>> {
    const result = new Map<string, RoutingCategoryUsage>(
      codes.map((c) => [c, { rules: [], units: [], labels: [], companies: 0 }]),
    );
    if (!codes.length) return result;
    const has = (list: string[] | null | undefined, code: string) =>
      (list ?? []).some((v) => canonicalRegion(v) === code);

    const [config, units, labels, companies] = await Promise.all([
      this.aiConfigRepo.findOne({ where: { tenantId } }),
      this.unitRepo.find({ where: { tenantId } }),
      this.labelRepo.find({ where: { tenantId } }),
      this.companyRepo
        .createQueryBuilder('c')
        .select('c.region', 'region')
        .addSelect('COUNT(*)', 'n')
        .where('c.tenant_id = :tenantId', { tenantId })
        .andWhere('c.region IS NOT NULL')
        .groupBy('c.region')
        .getRawMany<{ region: string; n: string }>(),
    ]);
    for (const [code, u] of result) {
      (config?.handoffConfig?.routingRules ?? []).forEach((r, i) => {
        if (has(r.regions, code)) u.rules.push(r.name?.trim() || `Routing rule ${i + 1}`);
      });
      u.units = units.filter((x) => has(x.regions, code)).map((x) => x.name);
      u.labels = labels.filter((x) => has(x.regions, code)).map((x) => x.name);
      u.companies = companies
        .filter((c) => canonicalRegion(c.region) === code)
        .reduce((sum, c) => sum + Number(c.n), 0);
    }
    return result;
  }

  private toResponse(r: RoutingCategory, usage?: RoutingCategoryUsage): RoutingCategoryResponse {
    return {
      id: String(r.id),
      code: r.code,
      name: r.name,
      sortOrder: r.sortOrder,
      usage: usage ?? { rules: [], units: [], labels: [], companies: 0 },
    };
  }
}
