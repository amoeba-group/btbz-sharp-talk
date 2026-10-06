import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditLog } from './entity/audit-log.entity';
import { User } from '../user/entity/user.entity';
import { AdminUser } from '../auth/entity/admin-user.entity';
import { getRequestContext } from '../../global/middleware/request-context.middleware';

export type AuditResult = 'success' | 'denied' | 'error';

export interface WriteAuditParams {
  tenantId?: number | null;
  /** 'system' = machine writer (webhook/scheduler/event consumer) — never a fake admin/user. */
  actorType: 'admin' | 'user' | 'system';
  actorId: number;
  action: string;
  target?: string;
  /** Overrides the request-context IP (rarely needed). */
  ip?: string | null;
  /** Overrides the request-context correlation id (rarely needed). */
  requestId?: string | null;
  /** Defaults to 'success'. */
  result?: AuditResult;
  /** Small structured context — NEVER raw PII (mask via pii.util first). */
  metadata?: Record<string, unknown> | null;
}

export interface ListAuditParams {
  tenantId: number | null; // null => all tenants (system admin)
  action?: string;
  actorType?: string;
  actorId?: number;
  /** Action-prefix filter, e.g. 'agent.' for the agent work log. */
  actionPrefix?: string;
  /** Exact target, e.g. 'group:12' — one object's history (PLN-261006). */
  target?: string;
  from?: Date;
  to?: Date;
  page: number;
  size: number;
}

/** An audit row with its actor resolved to a display name. */
export type AuditLogWithActor = AuditLog & { actorName: string | null };

/** Privileged action audit trail (FR-061). */
@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog) private readonly logRepo: Repository<AuditLog>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(AdminUser) private readonly adminRepo: Repository<AdminUser>,
  ) {}

  /**
   * Insert an audit_logs row. IP + request id auto-fill from the per-request
   * AsyncLocalStorage context when not passed explicitly; both stay null for
   * writes outside an HTTP request (schedulers, event consumers).
   */
  async write(params: WriteAuditParams): Promise<AuditLog> {
    const ctx = getRequestContext();
    return this.logRepo.save(
      this.logRepo.create({
        tenantId: params.tenantId ?? null,
        actorType: params.actorType,
        actorId: params.actorId,
        action: params.action,
        target: params.target ?? null,
        ip: params.ip !== undefined ? params.ip : (ctx?.ip ?? null),
        requestId: params.requestId !== undefined ? params.requestId : (ctx?.requestId ?? null),
        result: params.result ?? 'success',
        metadata: params.metadata ?? null,
      }),
    );
  }

  async list(params: ListAuditParams): Promise<{ items: AuditLogWithActor[]; total: number }> {
    const qb = this.logRepo.createQueryBuilder('a');
    if (params.tenantId != null) qb.andWhere('a.tenant_id = :tenantId', { tenantId: params.tenantId });
    if (params.action) qb.andWhere('a.action = :action', { action: params.action });
    if (params.actionPrefix) {
      qb.andWhere('a.action LIKE :prefix', { prefix: `${params.actionPrefix}%` });
    }
    if (params.target) qb.andWhere('a.target = :target', { target: params.target });
    if (params.actorType) qb.andWhere('a.actor_type = :actorType', { actorType: params.actorType });
    if (params.actorId != null) qb.andWhere('a.actor_id = :actorId', { actorId: params.actorId });
    if (params.from) qb.andWhere('a.created_at >= :from', { from: params.from });
    if (params.to) qb.andWhere('a.created_at < :to', { to: params.to });
    qb.orderBy('a.id', 'DESC')
      .skip((params.page - 1) * params.size)
      .take(params.size);
    const [items, total] = await qb.getManyAndCount();
    return { items: await this.withActorNames(items), total };
  }

  /**
   * Resolve actor_type/actor_id to a display name in two batched queries. The
   * list previously returned the raw id only, so the console's "actor" column
   * rendered a dash on every row — the one thing an audit log has to answer.
   */
  private async withActorNames(items: AuditLog[]): Promise<AuditLogWithActor[]> {
    const userIds = [...new Set(items.filter((i) => i.actorType === 'user').map((i) => i.actorId))];
    const adminIds = [...new Set(items.filter((i) => i.actorType === 'admin').map((i) => i.actorId))];
    const names = new Map<string, string>();

    if (userIds.length > 0) {
      const users = await this.userRepo.find({ where: { id: In(userIds) }, select: ['id', 'name', 'email'] });
      for (const u of users) names.set(`user:${u.id}`, u.name || u.email);
    }
    if (adminIds.length > 0) {
      // admin_users has no display name — the address is the only identifier.
      const admins = await this.adminRepo.find({ where: { id: In(adminIds) }, select: ['id', 'email'] });
      for (const a of admins) names.set(`admin:${a.id}`, a.email);
    }

    return items.map((i) => ({
      ...i,
      // 'system' actors are machine writers (schedulers, event consumers) and
      // have no row to join to — label them rather than showing a bare id.
      actorName: i.actorType === 'system' ? 'system' : (names.get(`${i.actorType}:${i.actorId}`) ?? null),
    })) as AuditLogWithActor[];
  }
}
