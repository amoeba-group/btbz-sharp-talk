import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { AgentAlert } from './entity/agent-alert.entity';
import { AgentAlertRead } from './entity/agent-alert-read.entity';
import { ALERT_POPUP, AlertPopup, UserAlertSettings } from './entity/user-alert-settings.entity';
import { User } from '../user/entity/user.entity';
import { Session } from '../session/entity/session.entity';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { canAckAlarm } from './agent-alert.service';

/** One alarm as the console shows it: the per-agent rows of one escalation, folded. */
export interface AlarmView {
  /** The first row's id — what read/ack calls carry. */
  id: string;
  conversationId: string;
  reason: string;
  preview: string | null;
  status: 'new' | 'acked';
  createdAt: Date;
  ruleName: string | null;
  consultCategory: string | null;
  /** Agents it was addressed to; empty with `broadcast` = everyone. */
  assignees: Array<{ id: string; name: string }>;
  broadcast: boolean;
  assignedToMe: boolean;
  /** Whether this user may stop the page (assignee, or anyone for a broadcast). */
  canAck: boolean;
  readByMe: boolean;
  ackedBy: { id: string; name: string } | null;
  ackedAt: Date | null;
  hotel: string | null;
  region: string | null;
}

export interface AlarmCenterFilter {
  scope?: 'all' | 'mine' | 'broadcast';
  status?: 'new' | 'acked' | 'all';
  days?: number;
  category?: string;
}

export interface AlertSettingsView {
  popup: AlertPopup;
  sound: boolean;
  desktop: boolean;
  email: boolean;
}

const DEFAULT_SETTINGS: AlertSettingsView = { popup: ALERT_POPUP.ALL, sound: true, desktop: false, email: true };
/** Rows read per request — alarms are dozens a day, so a window this size is plenty and bounded. */
const ROW_CAP = 3000;

/**
 * Alarm center (PLN-261024-Alarm-Center-Assignee-Region-Routing).
 *
 * Every agent of the tenant sees every alarm (D1) with who it was addressed
 * to; closing one marks it read for that agent only (D2), and the page stops
 * (ack) only through its assignee — AgentAlertService.ack. Rows are folded per
 * escalation (`event_key`) in code: the volume is small, so one code path
 * serves the popup feed, the drawer and the paged history.
 */
@Injectable()
export class AlertCenterService {
  private readonly logger = new Logger(AlertCenterService.name);

  constructor(
    @InjectRepository(AgentAlert) private readonly alertRepo: Repository<AgentAlert>,
    @InjectRepository(AgentAlertRead) private readonly readRepo: Repository<AgentAlertRead>,
    @InjectRepository(UserAlertSettings) private readonly settingsRepo: Repository<UserAlertSettings>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
  ) {}

  /** Unacked alarms of the tenant, newest first (popup + bell feed). */
  async feed(tenantId: number, userId: number): Promise<AlarmView[]> {
    if (!tenantId) return [];
    const rows = await this.alertRepo.find({ where: { tenantId, status: 'new' }, order: { id: 'DESC' }, take: 500 });
    return (await this.views(tenantId, userId, rows)).slice(0, 50);
  }

  /** History with filters, paged in code over the folded alarms. */
  async center(
    tenantId: number,
    userId: number,
    filter: AlarmCenterFilter,
    page: number,
    size: number,
  ): Promise<{ items: AlarmView[]; total: number }> {
    if (!tenantId) return { items: [], total: 0 };
    const days = Math.min(Math.max(Number(filter.days) || 7, 1), 90);
    const from = new Date(Date.now() - days * 86_400_000);
    const rows = await this.alertRepo.find({
      where: { tenantId, createdAt: MoreThanOrEqual(from), ...(filter.category ? { consultCategory: filter.category } : {}) },
      order: { id: 'DESC' },
      take: ROW_CAP,
    });
    if (rows.length === ROW_CAP) this.logger.warn(`alarm center tenant=${tenantId}: ${ROW_CAP}-row window reached (${days}d)`);
    let views = await this.views(tenantId, userId, rows);
    if (filter.scope === 'mine') views = views.filter((v) => v.assignedToMe);
    else if (filter.scope === 'broadcast') views = views.filter((v) => v.broadcast);
    if (filter.status === 'new' || filter.status === 'acked') views = views.filter((v) => v.status === filter.status);
    const start = (page - 1) * size;
    return { items: views.slice(start, start + size), total: views.length };
  }

  /** "Seen" for this user only (D2). 404 for another tenant's alarm. */
  async markRead(tenantId: number, userId: number, alertId: number): Promise<void> {
    const alert = tenantId ? await this.alertRepo.findOne({ where: { id: alertId, tenantId }, select: { id: true } }) : null;
    if (!alert) {
      this.logger.warn(`alarm read refused: id=${alertId} tenant=${tenantId} user=${userId}`);
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    await this.readRepo
      .createQueryBuilder()
      .insert()
      .into(AgentAlertRead)
      .values({ tenantId, alertId, userId })
      .orIgnore()
      .execute();
  }

  async settings(tenantId: number, userId: number): Promise<AlertSettingsView> {
    const row = await this.settingsRepo.findOne({ where: { userId, tenantId } });
    return row ? this.toSettings(row) : { ...DEFAULT_SETTINGS };
  }

  async saveSettings(tenantId: number, userId: number, input: Partial<AlertSettingsView>): Promise<AlertSettingsView> {
    const current = await this.settings(tenantId, userId);
    const next: AlertSettingsView = {
      popup: (Object.values(ALERT_POPUP) as string[]).includes(String(input.popup)) ? (input.popup as AlertPopup) : current.popup,
      sound: input.sound ?? current.sound,
      desktop: input.desktop ?? current.desktop,
      email: input.email ?? current.email,
    };
    // upsert, not save: save() looks the row up through the bigint transformer
    // and misses an existing one, then INSERTs a duplicate primary key — so
    // every save after the first failed with a 500 (found in the local run).
    await this.settingsRepo.upsert(
      {
        userId,
        tenantId,
        popup: next.popup,
        sound: next.sound ? 1 : 0,
        desktop: next.desktop ? 1 : 0,
        email: next.email ? 1 : 0,
      },
      ['userId'],
    );
    return next;
  }

  // ---- folding ----

  /** Fold rows per escalation and decorate for this user. Rows come newest first. */
  async views(tenantId: number, userId: number, rows: AgentAlert[]): Promise<AlarmView[]> {
    const groups = new Map<string, AgentAlert[]>();
    for (const r of rows) {
      const key = r.eventKey ?? `id:${r.id}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const folded = [...groups.values()].map((g) => g.sort((a, b) => Number(a.id) - Number(b.id)));
    const firstIds = folded.map((g) => g[0].id);
    const userIds = new Set<string>();
    const sessionIds = new Set<string>();
    for (const g of folded) {
      for (const r of g) {
        if (r.targetUserId != null) userIds.add(String(r.targetUserId));
        if (r.ackedBy != null) userIds.add(String(r.ackedBy));
      }
      if (g[0].sessionId != null) sessionIds.add(String(g[0].sessionId));
    }
    const [users, sessions, reads] = await Promise.all([
      userIds.size
        ? this.userRepo.find({ where: { id: In([...userIds]), tenantId }, select: { id: true, name: true, email: true } })
        : Promise.resolve([] as User[]),
      sessionIds.size
        ? this.sessionRepo.find({ where: { id: In([...sessionIds]) }, select: { id: true, identityAttributes: true } })
        : Promise.resolve([] as Session[]),
      firstIds.length
        ? this.readRepo.find({ where: { userId, alertId: In(firstIds) }, select: { alertId: true } })
        : Promise.resolve([] as AgentAlertRead[]),
    ]);
    const nameOf = new Map(users.map((u) => [String(u.id), u.name?.trim() || u.email]));
    const attrsOf = new Map(sessions.map((s) => [String(s.id), s.identityAttributes ?? null]));
    const readSet = new Set(reads.map((r) => String(r.alertId)));
    const person = (id: number | string) => ({ id: String(id), name: nameOf.get(String(id)) ?? `#${id}` });

    return folded
      .map((g): AlarmView => {
        const first = g[0];
        const targets = [...new Set(g.map((r) => r.targetUserId).filter((v): v is number => v != null).map(String))];
        const acked = g.find((r) => r.status !== 'new' && r.ackedBy != null) ?? g.find((r) => r.status !== 'new');
        const attrs = first.sessionId != null ? attrsOf.get(String(first.sessionId)) : null;
        const assignedToMe = targets.includes(String(userId));
        return {
          id: String(first.id),
          conversationId: String(first.conversationId),
          reason: first.reason,
          preview: first.preview,
          status: g.some((r) => r.status === 'new') ? 'new' : 'acked',
          createdAt: first.createdAt,
          ruleName: first.ruleName ?? null,
          consultCategory: first.consultCategory ?? null,
          assignees: targets.map(person),
          broadcast: g.some((r) => r.targetUserId == null),
          assignedToMe,
          canAck: canAckAlarm(g, userId),
          readByMe: readSet.has(String(first.id)) || (acked?.ackedBy != null && String(acked.ackedBy) === String(userId)),
          ackedBy: acked?.ackedBy != null ? person(acked.ackedBy) : null,
          ackedAt: acked?.ackedAt ?? null,
          hotel: attrs?.hotel_name || attrs?.hotel_id || null,
          region: attrs?.region || null,
        };
      })
      .sort((a, b) => Number(b.id) - Number(a.id));
  }

  private toSettings(row: UserAlertSettings): AlertSettingsView {
    return {
      popup: (Object.values(ALERT_POPUP) as string[]).includes(row.popup) ? (row.popup as AlertPopup) : ALERT_POPUP.ALL,
      sound: Number(row.sound) === 1,
      desktop: Number(row.desktop) === 1,
      email: Number(row.email) === 1,
    };
  }
}
