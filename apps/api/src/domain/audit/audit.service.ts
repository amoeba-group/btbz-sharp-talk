import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { AuditLog } from './entity/audit-log.entity';
import { User } from '../user/entity/user.entity';
import { AdminUser } from '../auth/entity/admin-user.entity';
import { Session } from '../session/entity/session.entity';
import { Customer } from '../customer/entity/customer.entity';
import { getRequestContext } from '../../global/middleware/request-context.middleware';
import { maskName } from '../../global/util/pii-display.util';

export type AuditResult = 'success' | 'denied' | 'error';

export interface WriteAuditParams {
  tenantId?: number | null;
  /**
   * 'system' = machine writer (webhook/scheduler/event consumer) — never a fake admin/user.
   * 'host' = a host app's signed-in user (Go2Joy HA, PLN-261022 P6); actorId is the widget
   * SESSION id, and the name is resolved from that session at read time — never stored.
   */
  actorType: 'admin' | 'user' | 'system' | 'host';
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
  /** Action-prefix filter, e.g. 'agent.' for the agent work log; comma-separated = any of them. */
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
    // Last + optional: specs build the service positionally. Names 'host' actors
    // from the session they signed in on (PLN-261022 P6).
    @Optional() @InjectRepository(Session) private readonly sessionRepo?: Repository<Session>,
    @Optional() @InjectRepository(Customer) private readonly customerRepo?: Repository<Customer>,
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
    const prefixes = (params.actionPrefix ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (prefixes.length === 1) {
      qb.andWhere('a.action LIKE :prefix', { prefix: `${prefixes[0]}%` });
    } else if (prefixes.length > 1) {
      // The work log reads console agents and host sign-ins together (PLN-261022 P6).
      const clauses = prefixes.map((_, i) => `a.action LIKE :prefix${i}`);
      const values = Object.fromEntries(prefixes.map((p, i) => [`prefix${i}`, `${p}%`]));
      qb.andWhere(`(${clauses.join(' OR ')})`, values);
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
    const sessionIds = [...new Set(items.filter((i) => i.actorType === 'host').map((i) => i.actorId))];
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
    if (sessionIds.length > 0) await this.hostNames(sessionIds, names);

    return items.map((i) => ({
      ...i,
      // 'system' actors are machine writers (schedulers, event consumers) and
      // have no row to join to — label them rather than showing a bare id.
      actorName: i.actorType === 'system' ? 'system' : (names.get(`${i.actorType}:${i.actorId}`) ?? null),
    })) as AuditLogWithActor[];
  }

  /**
   * A host user's display name, from the session it signed in on: the host's
   * claimed name, or the verified customer's name — masked (pii-display), as
   * customer names are everywhere on the console. Kept out of the audit row
   * itself (no PII in audit data).
   */
  private async hostNames(sessionIds: number[], names: Map<string, string>): Promise<void> {
    if (!this.sessionRepo) return;
    const sessions = await this.sessionRepo.find({
      where: { id: In(sessionIds) },
      select: ['id', 'customerId', 'identityLevel', 'identityAttributes'],
    });
    const customerIds = sessions.filter((s) => s.customerId != null).map((s) => Number(s.customerId));
    const customers =
      customerIds.length && this.customerRepo
        ? await this.customerRepo.find({ where: { id: In(customerIds) }, select: ['id', 'name'] })
        : [];
    const customerName = new Map(customers.map((c) => [Number(c.id), c.name?.trim() || null]));
    for (const s of sessions) {
      const name =
        (s.customerId != null ? customerName.get(Number(s.customerId)) : null) ||
        (s.identityLevel === 'claimed' ? s.identityAttributes?.name?.trim() : null);
      // A host user is a customer, not staff: masked like customer names on the console.
      const masked = maskName(name);
      if (masked) names.set(`host:${s.id}`, masked);
    }
  }
}
