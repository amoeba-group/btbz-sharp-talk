import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { resolveRegionAssignees, resolveAssigneeGroup } from '@sharptalk/types';
import type { AssigneeCandidate, AssigneeGroupSelector, RegionMatch, RegionTarget } from '@sharptalk/types';
import { User } from '../user/entity/user.entity';
import { JobLabel } from '../user/entity/job-label.entity';
import { UserJobLabel } from '../user/entity/user-job-label.entity';
import { Unit } from '../user/entity/unit.entity';

/** A resolved group plus, for a region selector, which scope level matched. */
export interface ResolvedAssignees {
  ids: number[];
  match?: RegionMatch;
}

/**
 * Resolves a routing rule's unit/label group to user ids at handoff time
 * (PLN-261019-Routing-Assignee-Groups P1). Reads the tenant's active users
 * once plus their label codes, then applies the shared pure resolver so the
 * console preview and the server agree. Every id is String()-normalised —
 * bigint PKs arrive as strings while link-table columns are numbers.
 *
 * Region selectors (PLN-261022 stage 1) additionally need each user's covered
 * places: their unit's regions/provinces ∪ every held label's.
 */
@Injectable()
export class RoutingAssigneeService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(JobLabel) private readonly labelRepo: Repository<JobLabel>,
    @InjectRepository(UserJobLabel) private readonly userLabelRepo: Repository<UserJobLabel>,
    // Last + optional: specs build the service positionally with three repos.
    @InjectRepository(Unit) private readonly unitRepo?: Repository<Unit>,
  ) {}

  async resolve(tenantId: number, selector: AssigneeGroupSelector, target?: RegionTarget | null): Promise<number[]> {
    return (await this.resolveDetailed(tenantId, selector, target)).ids;
  }

  async resolveDetailed(
    tenantId: number,
    selector: AssigneeGroupSelector,
    target?: RegionTarget | null,
  ): Promise<ResolvedAssignees> {
    const users = await this.userRepo.find({ where: { tenantId, status: 'active' } });
    if (!users.length) return { ids: [], match: selector.byRegion ? 'none' : undefined };
    const byRegion = selector.byRegion === true;
    const wantsLabels = byRegion || (selector.labelCodes ?? []).length > 0;
    const labelsByUser = wantsLabels ? await this.labelsByUser(tenantId, users.map((u) => u.id)) : new Map<string, JobLabel[]>();
    const unitsById = byRegion ? await this.unitsById(tenantId, users.map((u) => u.unitId)) : new Map<string, Unit>();
    const candidates: AssigneeCandidate[] = users.map((u) => {
      const labels = labelsByUser.get(String(u.id)) ?? [];
      const candidate: AssigneeCandidate = { id: u.id, status: u.status, unitId: u.unitId, labelCodes: labels.map((l) => l.code) };
      if (byRegion) {
        const unit = u.unitId != null ? unitsById.get(String(u.unitId)) : undefined;
        candidate.regions = [...(unit?.regions ?? []), ...labels.flatMap((l) => l.regions ?? [])];
        candidate.provinces = [...(unit?.provinces ?? []), ...labels.flatMap((l) => l.provinces ?? [])];
      }
      return candidate;
    });
    const toNumbers = (ids: string[]) => ids.map(Number).filter((id) => Number.isFinite(id) && id > 0);
    if (byRegion) {
      const hit = resolveRegionAssignees(candidates, selector, target);
      return { ids: toNumbers(hit.ids), match: hit.match };
    }
    return { ids: toNumbers(resolveAssigneeGroup(candidates, selector)) };
  }

  private async labelsByUser(tenantId: number, userIds: number[]): Promise<Map<string, JobLabel[]>> {
    const out = new Map<string, JobLabel[]>();
    const links = await this.userLabelRepo.find({ where: { userId: In(userIds) } });
    if (!links.length) return out;
    const labels = await this.labelRepo.find({ where: { tenantId, id: In([...new Set(links.map((l) => l.jobLabelId))]) } });
    const byId = new Map(labels.map((l) => [String(l.id), l]));
    for (const link of links) {
      const label = byId.get(String(link.jobLabelId));
      if (!label) continue;
      const key = String(link.userId);
      out.set(key, [...(out.get(key) ?? []), label]);
    }
    return out;
  }

  private async unitsById(tenantId: number, unitIds: Array<number | null>): Promise<Map<string, Unit>> {
    const ids = [...new Set(unitIds.filter((id): id is number => id != null))];
    if (!ids.length || !this.unitRepo) return new Map();
    const units = await this.unitRepo.find({ where: { tenantId, id: In(ids) } });
    return new Map(units.map((u) => [String(u.id), u]));
  }
}
