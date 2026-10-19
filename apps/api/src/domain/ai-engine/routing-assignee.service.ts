import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { resolveAssigneeGroup } from '@sharptalk/types';
import type { AssigneeGroupSelector } from '@sharptalk/types';
import { User } from '../user/entity/user.entity';
import { JobLabel } from '../user/entity/job-label.entity';
import { UserJobLabel } from '../user/entity/user-job-label.entity';

/**
 * Resolves a routing rule's unit/label group to user ids at handoff time
 * (PLN-261019-Routing-Assignee-Groups P1). Reads the tenant's active users
 * once plus their label codes, then applies the shared pure resolver so the
 * console preview and the server agree. Every id is String()-normalised —
 * bigint PKs arrive as strings while link-table columns are numbers.
 */
@Injectable()
export class RoutingAssigneeService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(JobLabel) private readonly labelRepo: Repository<JobLabel>,
    @InjectRepository(UserJobLabel) private readonly userLabelRepo: Repository<UserJobLabel>,
  ) {}

  async resolve(tenantId: number, selector: AssigneeGroupSelector): Promise<number[]> {
    const users = await this.userRepo.find({ where: { tenantId, status: 'active' } });
    if (!users.length) return [];
    const wantsLabels = (selector.labelCodes ?? []).length > 0;
    const codesByUser = wantsLabels ? await this.labelCodes(tenantId, users.map((u) => u.id)) : new Map<string, string[]>();
    const ids = resolveAssigneeGroup(
      users.map((u) => ({ id: u.id, status: u.status, unitId: u.unitId, labelCodes: codesByUser.get(String(u.id)) ?? [] })),
      selector,
    );
    return ids.map(Number).filter((id) => Number.isFinite(id) && id > 0);
  }

  private async labelCodes(tenantId: number, userIds: number[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    const links = await this.userLabelRepo.find({ where: { userId: In(userIds) } });
    if (!links.length) return out;
    const labels = await this.labelRepo.find({ where: { tenantId, id: In([...new Set(links.map((l) => l.jobLabelId))]) } });
    const codeById = new Map(labels.map((l) => [String(l.id), l.code]));
    for (const link of links) {
      const code = codeById.get(String(link.jobLabelId));
      if (!code) continue;
      const key = String(link.userId);
      out.set(key, [...(out.get(key) ?? []), code]);
    }
    return out;
  }
}
