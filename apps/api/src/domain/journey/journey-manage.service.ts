import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, Not, Repository } from 'typeorm';
import { JourneyStage } from './entity/journey-stage.entity';
import { Journey } from './entity/journey.entity';
import { JourneyTask, JourneyTaskSource, JOURNEY_TASK_SOURCE } from './entity/journey-task.entity';
import { ChatGroup } from '../agent/entity/chat-group.entity';
import { ChatGroupMember } from '../agent/entity/chat-group-member.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { CjmEvent } from '../cjm/entity/cjm-event.entity';
import { User } from '../user/entity/user.entity';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/**
 * Kotler's 5A — the default columns (PLN-261006 D3). The journey report
 * already narrates in this vocabulary, and unlike the cjm event stages
 * (Browse/Purchase/Delivery…) it does not assume the customer is shopping.
 */
export const DEFAULT_STAGES: Array<{ key: string; label: Record<string, string>; color: string }> = [
  { key: 'aware', label: { EN: 'Aware', KO: '인지', ES: 'Conocer', VI: 'Nhận biết', JA: '認知', ZH: '认知' }, color: '#94A3B8' },
  { key: 'appeal', label: { EN: 'Appeal', KO: '호감', ES: 'Atracción', VI: 'Thu hút', JA: '訴求', ZH: '吸引' }, color: '#60A5FA' },
  { key: 'ask', label: { EN: 'Ask', KO: '문의', ES: 'Preguntar', VI: 'Hỏi', JA: '調査', ZH: '询问' }, color: '#F59E0B' },
  { key: 'act', label: { EN: 'Act', KO: '행동', ES: 'Actuar', VI: 'Hành động', JA: '行動', ZH: '行动' }, color: '#10B981' },
  { key: 'advocate', label: { EN: 'Advocate', KO: '옹호', ES: 'Recomendar', VI: 'Ủng hộ', JA: '推奨', ZH: '拥护' }, color: '#8B5CF6' },
];

const STAGE_KEY = /^[a-z0-9_-]{1,32}$/;
const MAX_STAGES = 12;
const TIMELINE_PAGE = 50;

export interface StageInput {
  key: string;
  label: Record<string, string>;
  color?: string | null;
}

export interface BoardCard {
  groupId: number;
  title: string;
  kind: string;
  stageKey: string | null;
  ownerUserId: number | null;
  ownerName: string | null;
  stageChangedAt: Date | null;
  openTasks: number;
  overdueTasks: number;
  memberCount: number;
  lastMessageAt: Date | null;
}

export interface TimelineItem {
  at: Date;
  kind: 'cjm' | 'conversation_started' | 'conversation_ended' | 'csat';
  /** cjm stage (Awareness…Post) for kind=cjm. */
  stage: string | null;
  /** cjm event type, e.g. product_view — never its payload. */
  eventType: string | null;
  sessionId: number | null;
  conversationId: number | null;
  channel: string | null;
  csat: number | null;
}

/** Today in the server's calendar, as the DATE string `due_at` compares with. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Customer journey management (PLN-261006 P2~P4).
 *
 * A journey hangs off a chat group (D1): a timeline is one person, a project
 * one client company. Operators set its stage, owner and next actions; nothing
 * here is decided by a model. The journey report (PLN-260825) stays the
 * analysis half and is untouched.
 */
@Injectable()
export class JourneyManageService {
  private readonly logger = new Logger(JourneyManageService.name);

  constructor(
    @InjectRepository(JourneyStage) private readonly stageRepo: Repository<JourneyStage>,
    @InjectRepository(Journey) private readonly journeyRepo: Repository<Journey>,
    @InjectRepository(JourneyTask) private readonly taskRepo: Repository<JourneyTask>,
    @InjectRepository(ChatGroup) private readonly groupRepo: Repository<ChatGroup>,
    @InjectRepository(ChatGroupMember) private readonly memberRepo: Repository<ChatGroupMember>,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(CjmEvent) private readonly cjmRepo: Repository<CjmEvent>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly audit: AuditService,
  ) {}

  // ---- stages -------------------------------------------------------------

  /** The tenant's stages, seeding 5A the first time (D3). */
  async stages(tenantId: number): Promise<JourneyStage[]> {
    const rows = await this.stageRepo.find({ where: { tenantId }, order: { sortOrder: 'ASC', id: 'ASC' } });
    if (rows.length) return rows;
    await this.stageRepo.save(
      DEFAULT_STAGES.map((s, i) =>
        this.stageRepo.create({ tenantId, key: s.key, label: s.label, color: s.color, sortOrder: (i + 1) * 10 }),
      ),
    );
    return this.stageRepo.find({ where: { tenantId }, order: { sortOrder: 'ASC', id: 'ASC' } });
  }

  /**
   * Replace the stage list (settings). Order is the array order. A stage a
   * journey still sits in cannot be dropped — the card would vanish from the
   * board with nowhere to show it; move the cards first (E5094).
   */
  async saveStages(tenantId: number, actorId: number, input: StageInput[]): Promise<JourneyStage[]> {
    const keys = input.map((s) => s.key.trim().toLowerCase());
    const labelled = input.every((s) => Object.values(s.label ?? {}).some((v) => v?.trim()));
    if (!input.length || input.length > MAX_STAGES || !labelled || new Set(keys).size !== keys.length || keys.some((k) => !STAGE_KEY.test(k))) {
      this.logger.warn(`journey stages refused: invalid list (tenant ${tenantId})`);
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    const existing = await this.stages(tenantId);
    const dropped = existing.filter((s) => !keys.includes(s.key)).map((s) => s.key);
    if (dropped.length) {
      const inUse = await this.journeyRepo.count({ where: { tenantId, stageKey: In(dropped) } });
      if (inUse > 0) {
        this.logger.warn(`journey stages refused: ${dropped.join(',')} still hold ${inUse} journeys (tenant ${tenantId})`);
        throw new BusinessException(ERROR_CODE.JOURNEY_STAGE_IN_USE, HttpStatus.CONFLICT);
      }
      await this.stageRepo.delete({ tenantId, key: In(dropped) });
    }
    const byKey = new Map(existing.map((s) => [s.key, s]));
    await this.stageRepo.save(
      input.map((s, i) => {
        const key = keys[i];
        const row = byKey.get(key) ?? this.stageRepo.create({ tenantId, key });
        row.label = Object.fromEntries(
          Object.entries(s.label).map(([lang, v]) => [lang.toUpperCase(), (v ?? '').trim().slice(0, 40)]).filter(([, v]) => v),
        );
        row.color = s.color && /^#[0-9a-fA-F]{6}$/.test(s.color) ? s.color : null;
        row.sortOrder = (i + 1) * 10;
        return row;
      }),
    );
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'journey.stages_saved',
      metadata: { keys, dropped },
    });
    return this.stages(tenantId);
  }

  /**
   * Teammates an owner or assignee can be picked from: active users of the
   * tenant, display name only. The users screen is manager+; picking a
   * colleague for a next action is not.
   */
  async people(tenantId: number): Promise<Array<{ id: number; name: string }>> {
    const users = await this.userRepo.find({ where: { tenantId, status: 'active' }, order: { name: 'ASC', id: 'ASC' } });
    return users.map((u) => ({ id: Number(u.id), name: u.name || u.email }));
  }

  // ---- one journey --------------------------------------------------------

  private async ownedGroup(tenantId: number, groupId: number): Promise<ChatGroup> {
    const group = await this.groupRepo.findOne({ where: { id: groupId, tenantId } });
    if (!group) {
      this.logger.warn(`journey refused: group=${groupId} not in tenant ${tenantId}`);
      throw new BusinessException(ERROR_CODE.GROUP_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return group;
  }

  /** A tenant user id, or 404 — an owner from another tenant is never stored. */
  private async requireTenantUser(tenantId: number, userId: number | null): Promise<void> {
    if (userId == null) return;
    const n = await this.userRepo.count({ where: { id: userId, tenantId } });
    if (!n) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
  }

  async card(
    tenantId: number,
    groupId: number,
  ): Promise<{ journey: Journey | null; tasks: JourneyTask[]; names: Map<number, string> }> {
    await this.ownedGroup(tenantId, groupId);
    const journey = await this.journeyRepo.findOne({ where: { tenantId, groupId } });
    const tasks = journey
      ? await this.taskRepo.find({
          where: { tenantId, journeyId: Number(journey.id) },
          // Open first, then by due date; done ones sink.
          order: { doneAt: 'ASC', dueAt: 'ASC', id: 'ASC' },
        })
      : [];
    const ids = [journey?.ownerUserId, ...tasks.map((t) => t.assigneeUserId)].filter((v): v is number => v != null);
    return { journey, tasks, names: await this.userNames(tenantId, ids) };
  }

  private async userNames(tenantId: number, ids: number[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids.map(Number))];
    if (!unique.length) return new Map();
    const users = await this.userRepo.find({ where: { tenantId, id: In(unique) } });
    return new Map(users.map((u) => [Number(u.id), u.name || u.email]));
  }

  private async ensureJourney(tenantId: number, groupId: number, actorId: number): Promise<Journey> {
    await this.ownedGroup(tenantId, groupId);
    const found = await this.journeyRepo.findOne({ where: { tenantId, groupId } });
    if (found) return found;
    return this.journeyRepo.save(
      this.journeyRepo.create({ tenantId, groupId, stageKey: null, ownerUserId: null, stageChangedAt: null, createdBy: actorId }),
    );
  }

  /** Move a journey to a stage; the change is one audit row (from → to). */
  async setStage(tenantId: number, groupId: number, actorId: number, stageKey: string | null): Promise<Journey> {
    if (stageKey != null) {
      const stages = await this.stages(tenantId);
      if (!stages.some((s) => s.key === stageKey)) {
        this.logger.warn(`journey stage refused: ${stageKey} unknown (tenant ${tenantId})`);
        throw new BusinessException(ERROR_CODE.JOURNEY_STAGE_UNKNOWN, HttpStatus.BAD_REQUEST);
      }
    }
    const journey = await this.ensureJourney(tenantId, groupId, actorId);
    if (journey.stageKey === stageKey) return journey;
    const from = journey.stageKey;
    journey.stageKey = stageKey;
    journey.stageChangedAt = new Date();
    const saved = await this.journeyRepo.save(journey);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId,
      action: 'journey.stage_changed',
      target: `group:${groupId}`,
      metadata: { from, to: stageKey },
    });
    return saved;
  }

  async setOwner(tenantId: number, groupId: number, actorId: number, ownerUserId: number | null): Promise<Journey> {
    await this.requireTenantUser(tenantId, ownerUserId);
    const journey = await this.ensureJourney(tenantId, groupId, actorId);
    journey.ownerUserId = ownerUserId;
    return this.journeyRepo.save(journey);
  }

  /** Stage history — the audit rows, newest first. */
  async history(tenantId: number, groupId: number) {
    await this.ownedGroup(tenantId, groupId);
    const { items } = await this.audit.list({
      tenantId,
      action: 'journey.stage_changed',
      target: `group:${groupId}`,
      page: 1,
      size: 50,
    });
    return items;
  }

  // ---- tasks ----------------------------------------------------------------

  async addTask(
    tenantId: number,
    groupId: number,
    actorId: number,
    input: { title: string; dueAt?: string | null; assigneeUserId?: number | null; source?: JourneyTaskSource; reportId?: number | null },
  ): Promise<JourneyTask> {
    const title = input.title.replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!title) throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    await this.requireTenantUser(tenantId, input.assigneeUserId ?? null);
    const journey = await this.ensureJourney(tenantId, groupId, actorId);
    return this.taskRepo.save(
      this.taskRepo.create({
        tenantId,
        journeyId: Number(journey.id),
        title,
        dueAt: input.dueAt || null,
        assigneeUserId: input.assigneeUserId ?? null,
        doneAt: null,
        source: input.source === JOURNEY_TASK_SOURCE.REPORT ? JOURNEY_TASK_SOURCE.REPORT : JOURNEY_TASK_SOURCE.MANUAL,
        reportId: input.source === JOURNEY_TASK_SOURCE.REPORT ? (input.reportId ?? null) : null,
        createdBy: actorId,
      }),
    );
  }

  private async ownedTask(tenantId: number, id: number): Promise<JourneyTask> {
    const task = await this.taskRepo.findOne({ where: { id, tenantId } });
    if (!task) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    return task;
  }

  async updateTask(
    tenantId: number,
    id: number,
    patch: { title?: string; dueAt?: string | null; assigneeUserId?: number | null; done?: boolean },
  ): Promise<JourneyTask> {
    const task = await this.ownedTask(tenantId, id);
    if (patch.title !== undefined) {
      const title = patch.title.replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!title) throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
      task.title = title;
    }
    if (patch.dueAt !== undefined) task.dueAt = patch.dueAt || null;
    if (patch.assigneeUserId !== undefined) {
      await this.requireTenantUser(tenantId, patch.assigneeUserId);
      task.assigneeUserId = patch.assigneeUserId;
    }
    if (patch.done !== undefined) task.doneAt = patch.done ? (task.doneAt ?? new Date()) : null;
    return this.taskRepo.save(task);
  }

  async deleteTask(tenantId: number, id: number): Promise<void> {
    const task = await this.ownedTask(tenantId, id);
    await this.taskRepo.delete({ id: Number(task.id), tenantId });
  }

  // ---- board ----------------------------------------------------------------

  /**
   * Every group of the tenant as a card (P3). Groups without a journey row are
   * cards with no stage — the board's first column — so a new group is never
   * invisible here. One query per table, no per-card loops.
   */
  async board(
    tenantId: number,
    filter: { kind?: string; ownerUserId?: number; overdueOnly?: boolean } = {},
  ): Promise<{ stages: JourneyStage[]; cards: BoardCard[] }> {
    const stages = await this.stages(tenantId);
    const groups = await this.groupRepo.find({
      where: { tenantId, ...(filter.kind ? { kind: filter.kind } : {}) },
      order: { id: 'DESC' },
      take: 500,
    });
    if (!groups.length) return { stages, cards: [] };
    const groupIds = groups.map((g) => Number(g.id));

    const journeys = await this.journeyRepo.find({ where: { tenantId, groupId: In(groupIds) } });
    const journeyByGroup = new Map(journeys.map((j) => [Number(j.groupId), j]));
    const journeyIds = journeys.map((j) => Number(j.id));

    const open = journeyIds.length
      ? await this.taskRepo.find({ where: { tenantId, journeyId: In(journeyIds), doneAt: IsNull() } })
      : [];
    const now = today();
    const openByJourney = new Map<number, { open: number; overdue: number }>();
    for (const t of open) {
      const c = openByJourney.get(Number(t.journeyId)) ?? { open: 0, overdue: 0 };
      c.open += 1;
      if (t.dueAt && t.dueAt < now) c.overdue += 1;
      openByJourney.set(Number(t.journeyId), c);
    }

    const members = await this.memberRepo.find({ where: { tenantId, groupId: In(groupIds) } });
    const memberCount = new Map<number, number>();
    for (const m of members) memberCount.set(Number(m.groupId), (memberCount.get(Number(m.groupId)) ?? 0) + 1);

    const lastRows: Array<{ groupId: string; lastAt: Date | null }> = await this.msgRepo
      .createQueryBuilder('m')
      .innerJoin(Conversation, 'c', 'c.id = m.conversation_id AND c.tenant_id = :tenantId')
      .innerJoin(ChatGroupMember, 'gm', 'gm.session_id = c.session_id AND gm.tenant_id = :tenantId')
      .where('gm.group_id IN (:...groupIds)', { groupIds })
      .setParameter('tenantId', tenantId)
      .select('gm.group_id', 'groupId')
      .addSelect('MAX(m.created_at)', 'lastAt')
      .groupBy('gm.group_id')
      .getRawMany();
    const lastAt = new Map(lastRows.map((r) => [Number(r.groupId), r.lastAt]));

    const names = await this.userNames(
      tenantId,
      journeys.map((j) => j.ownerUserId).filter((v): v is number => v != null),
    );
    const known = new Set(stages.map((s) => s.key));

    let cards: BoardCard[] = groups.map((g) => {
      const j = journeyByGroup.get(Number(g.id));
      const counts = j ? openByJourney.get(Number(j.id)) : undefined;
      return {
        groupId: Number(g.id),
        title: g.title,
        kind: g.kind,
        // A stage since removed would hide the card; show it unstaged instead.
        stageKey: j?.stageKey && known.has(j.stageKey) ? j.stageKey : null,
        ownerUserId: j?.ownerUserId ?? null,
        ownerName: j?.ownerUserId != null ? names.get(Number(j.ownerUserId)) ?? null : null,
        stageChangedAt: j?.stageChangedAt ?? null,
        openTasks: counts?.open ?? 0,
        overdueTasks: counts?.overdue ?? 0,
        memberCount: memberCount.get(Number(g.id)) ?? 0,
        lastMessageAt: lastAt.get(Number(g.id)) ?? null,
      };
    });
    if (filter.ownerUserId != null) cards = cards.filter((c) => c.ownerUserId === Number(filter.ownerUserId));
    if (filter.overdueOnly) cards = cards.filter((c) => c.overdueTasks > 0);
    return { stages, cards };
  }

  // ---- touchpoint timeline ---------------------------------------------------

  /**
   * What happened across the group's sessions, newest first (P4): cjm events
   * (stage + type, never payloads) and each conversation's start, end and
   * rating. `before` pages back by time.
   */
  async timeline(
    tenantId: number,
    groupId: number,
    before?: Date,
  ): Promise<{ items: TimelineItem[]; hasMore: boolean }> {
    await this.ownedGroup(tenantId, groupId);
    const members = await this.memberRepo.find({ where: { tenantId, groupId } });
    const sessionIds = members.map((m) => Number(m.sessionId));
    if (!sessionIds.length) return { items: [], hasMore: false };

    const cutoff = before ?? new Date(Date.now() + 60_000);
    const events = await this.cjmRepo.find({
      where: {
        tenantId,
        sessionId: In(sessionIds),
        createdAt: LessThan(cutoff),
        // Chat messages are already the conversation rows below; one cjm
        // "Inquiry" per message would bury every other touchpoint.
        eventType: Not('chat_message'),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: TIMELINE_PAGE + 1,
    });
    const convs = await this.convRepo.find({ where: { tenantId, sessionId: In(sessionIds) } });

    const items: TimelineItem[] = events.map((e) => ({
      at: e.createdAt,
      kind: 'cjm',
      stage: e.stage,
      eventType: e.eventType,
      sessionId: e.sessionId != null ? Number(e.sessionId) : null,
      conversationId: null,
      channel: null,
      csat: null,
    }));
    for (const c of convs) {
      const base = { stage: null, eventType: null, sessionId: Number(c.sessionId), conversationId: Number(c.id), channel: c.channel || 'widget' };
      if (c.createdAt < cutoff) items.push({ ...base, at: c.createdAt, kind: 'conversation_started', csat: null });
      if (c.endedAt && c.endedAt < cutoff) items.push({ ...base, at: c.endedAt, kind: 'conversation_ended', csat: null });
      if (c.csatRating != null && c.csatRatedAt && c.csatRatedAt < cutoff) {
        items.push({ ...base, at: c.csatRatedAt, kind: 'csat', csat: Number(c.csatRating) });
      }
    }
    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const page = items.slice(0, TIMELINE_PAGE);
    return { items: page, hasMore: items.length > TIMELINE_PAGE };
  }
}
