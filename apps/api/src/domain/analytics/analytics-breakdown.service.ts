import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SENDER_TYPE } from '@sharptalk/types';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { Session } from '../session/entity/session.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { User } from '../user/entity/user.entity';
import { AiAgent } from '../ai-engine/entity/ai-agent.entity';
import { AuditLog } from '../audit/entity/audit-log.entity';
import { classifyOutcome } from '../../global/util/resolution.util';

/** Shown for sessions with no agent pinned — the tenant default answered them. */
export const DEFAULT_AGENT_LABEL = 'default';
/** Prefix for an agent that no longer exists; the console translates it. */
export const DELETED_AGENT_LABEL = 'deleted:';

/** One row of the funnel, whatever the axis is (total, agent, page). */
export interface AccessRow {
  key: string;
  /** Agent rows only: null = the tenant default answered. */
  id?: number | null;
  /** Widget loaded — the session row exists because of it. */
  impressions: number;
  /** Panel opened, counted per open. Can exceed `openedSessions`. */
  opens: number;
  /** Sessions that were opened at least once — the honest conversion base. */
  openedSessions: number;
  /** Sessions that produced a conversation. */
  conversations: number;
  /** openedSessions / impressions. */
  openRate: number;
  /** conversations / openedSessions. */
  chatRate: number;
}

export interface AccessDaily {
  day: string;
  impressions: number;
  opens: number;
  openedSessions: number;
  conversations: number;
}

export interface AccessBreakdown {
  totals: AccessRow;
  daily: AccessDaily[];
  byAgent: AccessRow[];
  byPath: AccessRow[];
  /** Paths beyond the top N, folded into one row; null when there are none. */
  otherPaths: (AccessRow & { paths: number }) | null;
  /** Oldest session carrying collected values — "we only know from here". */
  collectingSince: string | null;
}

export interface Window {
  from: Date;
  to: Date;
}

export interface ChannelRow {
  channel: string;
  conversations: number;
  messages: number;
  /** Customer turns only — "inflow", separate from what we sent back. */
  inbound: number;
  /** Mean and median together: one KakaoTalk group room drags the mean into fiction. */
  avgMessages: number;
  medianMessages: number;
  escalated: number;
  escalationRate: number;
}

export interface AgentRow {
  id: number | null;
  name: string;
  conversations: number;
  /** Replies this agent actually sent — an assignment with no answer is not work done. */
  replies: number;
  resolved: number;
  resolutionRate: number;
  csatRated: number;
  csatAvg: number | null;
}

export interface ResolutionBreakdown {
  ended: number;
  resolved: number;
  resolutionRate: number;
  byReason: Array<{ reason: string; resolved: boolean; count: number }>;
}

export interface HourGrid {
  /** IANA zone the grid is drawn in — a peak is meaningless without it. */
  timezone: string;
  /** Whether that zone came from the tenant or is the UTC fallback. */
  timezoneSource: 'tenant' | 'default';
  /** [weekday 0=Sun][hour 0-23] = customer messages. */
  grid: number[][];
  total: number;
}

/**
 * The channel / agent / resolution / hour lenses (AN-260826 P1).
 *
 * Read from `conversations` and `messages` directly rather than from a new
 * daily snapshot: a snapshot is a second copy that can disagree with the first,
 * and it needs a backfill path forever after. The cost is that these views
 * cannot see past the conversation-log retention window, which the screen says
 * out loud rather than pretending otherwise.
 */
/** Pages listed individually; the tail is folded into one "others" row. */
const ACCESS_TOP_PATHS = 20;

export const emptyAccessRow = (key: string): AccessRow => ({
  key,
  impressions: 0,
  opens: 0,
  openedSessions: 0,
  conversations: 0,
  openRate: 0,
  chatRate: 0,
});

/** Fold one session into a row. Impressions count sessions, not opens. */
function addSession(row: AccessRow, opens: number, opened: number, chat: number): void {
  row.impressions += 1;
  row.opens += opens;
  row.openedSessions += opened;
  row.conversations += chat;
}

/** Fold an already-aggregated row into another (the "others" bucket). */
export function mergeRow(into: AccessRow, from: AccessRow): void {
  into.impressions += from.impressions;
  into.opens += from.opens;
  into.openedSessions += from.openedSessions;
  into.conversations += from.conversations;
}

/**
 * Both rates divide by SESSIONS, never by raw opens: one shopper toggling the
 * panel four times is one person who engaged, and `opens` as a denominator
 * prints conversion above 100%.
 */
export function withRates(row: AccessRow): AccessRow {
  row.openRate = row.impressions ? row.openedSessions / row.impressions : 0;
  row.chatRate = row.openedSessions ? row.conversations / row.openedSessions : 0;
  return row;
}

const isoDay = (d: Date): string => new Date(d).toISOString().slice(0, 10);

@Injectable()
export class AnalyticsBreakdownService {
  constructor(
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(AiAgent) private readonly aiAgentRepo: Repository<AiAgent>,
    @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
  ) {}

  /** Conversations in range, sandbox threads excluded (same rule as the dashboard). */
  private scoped(tenantId: number, window: Window) {
    return this.convRepo
      .createQueryBuilder('c')
      .where('c.tenant_id = :tenantId', { tenantId })
      .andWhere('c.created_at >= :from AND c.created_at < :to', window)
      .andWhere(
        "NOT EXISTS (SELECT 1 FROM sessions ps WHERE ps.id = c.session_id AND ps.channel = 'preview')",
      );
  }

  /**
   * The funnel before the conversation: shown → opened → talked (PLN-260920).
   *
   * Every other method here starts from `conversations`, which is why the
   * console could only ever describe traffic that already turned into a chat.
   * This one starts from `sessions` — one row per widget load — so the two
   * numbers that were previously invisible (how often the widget appeared, how
   * often anyone opened it) finally have somewhere to be.
   *
   * Rates use `openedSessions`, never `opens`: a shopper toggling the panel
   * four times is one person who engaged, and dividing by the raw count would
   * print conversion rates above 100%.
   */
  async access(tenantId: number, window: Window): Promise<AccessBreakdown> {
    const sessions = await this.sessionRepo
      .createQueryBuilder('s')
      .select(['s.id', 's.aiAgentId', 's.landingPath', 's.openCount', 's.createdAt'])
      .where('s.tenant_id = :tenantId', { tenantId })
      .andWhere('s.created_at >= :from AND s.created_at < :to', window)
      // Preview sessions are the console's own sandbox, excluded here for the
      // same reason as everywhere else: operators testing the widget would show
      // up as shoppers who never talk.
      .andWhere("(s.channel IS NULL OR s.channel <> 'preview')")
      .getMany();
    if (!sessions.length) {
      return {
        totals: emptyAccessRow('total'),
        daily: [],
        byAgent: [],
        byPath: [],
        otherPaths: null,
        collectingSince: null,
      };
    }

    const ids = sessions.map((s) => Number(s.id));
    const [convRows, aiAgents] = await Promise.all([
      this.convRepo
        .createQueryBuilder('c')
        .select('DISTINCT c.session_id', 'sessionId')
        .where('c.tenant_id = :tenantId', { tenantId })
        .andWhere('c.session_id IN (:...ids)', { ids })
        .getRawMany<{ sessionId: string | number }>(),
      this.aiAgentRepo.find({ where: { tenantId } }),
    ]);
    const chatted = new Set(convRows.map((r) => Number(r.sessionId)));
    const aiName = new Map(aiAgents.map((a) => [Number(a.id), a.name]));
    const nameOf = (id: number | null): string =>
      id == null ? DEFAULT_AGENT_LABEL : (aiName.get(id) ?? `${DELETED_AGENT_LABEL}#${id}`);

    const totals = emptyAccessRow('total');
    const byDay = new Map<string, AccessDaily>();
    const byAgent = new Map<string, AccessRow>();
    const byPath = new Map<string, AccessRow>();
    let since: Date | null = null;

    for (const s of sessions) {
      const opens = Number(s.openCount ?? 0);
      const opened = opens > 0 ? 1 : 0;
      const chat = chatted.has(Number(s.id)) ? 1 : 0;
      const agentId = s.aiAgentId == null ? null : Number(s.aiAgentId);

      addSession(totals, opens, opened, chat);

      const day = isoDay(s.createdAt);
      const d = byDay.get(day) ?? { day, impressions: 0, opens: 0, openedSessions: 0, conversations: 0 };
      d.impressions += 1;
      d.opens += opens;
      d.openedSessions += opened;
      d.conversations += chat;
      byDay.set(day, d);

      const aKey = nameOf(agentId);
      const a = byAgent.get(aKey) ?? { ...emptyAccessRow(aKey), id: agentId };
      addSession(a, opens, opened, chat);
      byAgent.set(aKey, a);

      // A session written before collection started has no path; counting it
      // under "/" would invent traffic for the home page.
      if (s.landingPath) {
        const p = byPath.get(s.landingPath) ?? emptyAccessRow(s.landingPath);
        addSession(p, opens, opened, chat);
        byPath.set(s.landingPath, p);
        if (!since || s.createdAt < since) since = s.createdAt;
      }
    }

    const paths = [...byPath.values()].sort((x, y) => y.impressions - x.impressions);
    const top = paths.slice(0, ACCESS_TOP_PATHS).map(withRates);
    const rest = paths.slice(ACCESS_TOP_PATHS);
    let otherPaths: (AccessRow & { paths: number }) | null = null;
    if (rest.length) {
      const folded = emptyAccessRow('others');
      for (const r of rest) mergeRow(folded, r);
      otherPaths = { ...withRates(folded), paths: rest.length };
    }

    return {
      totals: withRates(totals),
      daily: [...byDay.values()].sort((x, y) => x.day.localeCompare(y.day)),
      byAgent: [...byAgent.values()].map(withRates).sort((x, y) => y.impressions - x.impressions),
      byPath: top,
      otherPaths,
      collectingSince: since ? isoDay(since) : null,
    };
  }

  async channels(tenantId: number, window: Window): Promise<ChannelRow[]> {
    const convs = await this.scoped(tenantId, window)
      .select(['c.id', 'c.channel', 'c.escalated'])
      .getMany();
    if (!convs.length) return [];

    const counts = await this.messageCounts(convs.map((c) => Number(c.id)));
    const byChannel = new Map<string, { convs: Conversation[]; sizes: number[] }>();
    for (const c of convs) {
      const key = c.channel || 'widget';
      const entry = byChannel.get(key) ?? { convs: [], sizes: [] };
      entry.convs.push(c);
      entry.sizes.push(counts.get(Number(c.id))?.total ?? 0);
      byChannel.set(key, entry);
    }

    return [...byChannel.entries()]
      .map(([channel, { convs: list, sizes }]) => {
        const messages = sizes.reduce((a, b) => a + b, 0);
        const inbound = list.reduce(
          (sum, c) => sum + (counts.get(Number(c.id))?.inbound ?? 0),
          0,
        );
        const escalated = list.filter((c) => c.escalated === 1).length;
        return {
          channel,
          conversations: list.length,
          messages,
          inbound,
          avgMessages: list.length ? Math.round((messages / list.length) * 10) / 10 : 0,
          medianMessages: median(sizes),
          escalated,
          escalationRate: list.length ? escalated / list.length : 0,
        };
      })
      .sort((a, b) => b.conversations - a.conversations);
  }

  /**
   * Two tables, not one: an AI agent and a person are not comparable rows.
   * The AI answers every turn it is given; a person is handed the ones it could
   * not, so putting them in one ranking would read as the AI outperforming the
   * team on exactly the conversations the AI failed at.
   */
  async agents(
    tenantId: number,
    window: Window,
  ): Promise<{ ai: AgentRow[]; human: AgentRow[] }> {
    const convs = await this.scoped(tenantId, window)
      // Property paths, not column names: `c.session_id` selects the column but
      // leaves the entity's `sessionId` undefined, and the id then binds as NaN.
      .select(['c.id', 'c.sessionId', 'c.agentId', 'c.status', 'c.csatRating', 'c.endedAt'])
      .getMany();
    if (!convs.length) return { ai: [], human: [] };

    const ids = convs.map((c) => Number(c.id));
    const [sessions, replies, aiReplies, lastSenders, prompted, aiAgents, users] = await Promise.all([
      this.sessionsOf(convs),
      this.agentReplyCounts(ids),
      this.senderCountsByConversation(ids, SENDER_TYPE.AI),
      this.lastNonSystemSenders(ids),
      this.promptedConversationIds(tenantId, ids),
      this.aiAgentRepo.find({ where: { tenantId } }),
      this.userRepo.find({ where: { tenantId } }),
    ]);

    const agentOfSession = new Map(
      sessions.map((s) => [Number(s.id), s.aiAgentId == null ? null : Number(s.aiAgentId)]),
    );
    const defaultAgent = aiAgents.find((a) => a.isDefault === 1) ?? null;
    const aiName = new Map(aiAgents.map((a) => [Number(a.id), a.name]));
    // An agent can be deleted while the sessions it answered remain. Printing
    // the bare id ("#15") reads as a name nobody recognises; saying it is gone
    // is the fact, and the conversations still have to be counted somewhere.
    const nameOf = (id: number | null): string =>
      id == null ? DEFAULT_AGENT_LABEL : (aiName.get(id) ?? `${DELETED_AGENT_LABEL}#${id}`);
    const userName = new Map(users.map((u) => [Number(u.id), u.name ?? u.email ?? `#${u.id}`]));

    const aiBuckets = new Map<number | null, Conversation[]>();
    const humanBuckets = new Map<number, Conversation[]>();
    for (const c of convs) {
      // An unpinned session is answered by the tenant's default agent, so it is
      // counted there — leaving it as "(none)" would hide most tenants' traffic
      // behind a row that names nobody.
      const pinned = agentOfSession.get(Number(c.sessionId)) ?? null;
      const aiId = pinned ?? (defaultAgent ? Number(defaultAgent.id) : null);
      aiBuckets.set(aiId, [...(aiBuckets.get(aiId) ?? []), c]);
      if (c.agentId != null) {
        const hid = Number(c.agentId);
        humanBuckets.set(hid, [...(humanBuckets.get(hid) ?? []), c]);
      }
    }

    const rowFor = (
      id: number | null,
      name: string,
      list: Conversation[],
      replyCount: number,
    ): AgentRow => {
      let resolved = 0;
      let csatRated = 0;
      let csatSum = 0;
      for (const c of list) {
        const outcome = classifyOutcome(
          { status: c.status, csatRating: c.csatRating, endedAt: c.endedAt },
          lastSenders.get(Number(c.id)) ?? null,
          prompted.has(Number(c.id)),
        );
        if (outcome.resolved) resolved += 1;
        if (c.csatRating != null) {
          csatRated += 1;
          csatSum += Number(c.csatRating);
        }
      }
      return {
        id,
        name,
        conversations: list.length,
        replies: replyCount,
        resolved,
        resolutionRate: list.length ? resolved / list.length : 0,
        csatRated,
        // Averaged only over answers actually given; the console shows the count
        // beside it so three ratings cannot masquerade as a score.
        csatAvg: csatRated ? Math.round((csatSum / csatRated) * 100) / 100 : null,
      };
    };

    const ai = [...aiBuckets.entries()]
      .map(([id, list]) =>
        rowFor(
          id,
          nameOf(id),
          list,
          // Answers this agent actually sent. Reporting 0 because the column is
          // hidden would put a wrong number in the API for whoever reads it next.
          list.reduce((sum, c) => sum + (aiReplies.get(Number(c.id)) ?? 0), 0),
        ),
      )
      .sort((a, b) => b.conversations - a.conversations);
    const human = [...humanBuckets.entries()]
      .map(([id, list]) => rowFor(id, userName.get(id) ?? `#${id}`, list, replies.get(id) ?? 0))
      .sort((a, b) => b.conversations - a.conversations);
    return { ai, human };
  }

  async resolution(tenantId: number, window: Window): Promise<ResolutionBreakdown> {
    const convs = await this.scoped(tenantId, window)
      .select(['c.id', 'c.status', 'c.csatRating', 'c.endedAt'])
      .getMany();
    if (!convs.length) return { ended: 0, resolved: 0, resolutionRate: 0, byReason: [] };

    const ids = convs.map((c) => Number(c.id));
    const [lastSenders, prompted] = await Promise.all([
      this.lastNonSystemSenders(ids),
      this.promptedConversationIds(tenantId, ids),
    ]);

    const tally = new Map<string, { resolved: boolean; count: number }>();
    let ended = 0;
    let resolved = 0;
    for (const c of convs) {
      const outcome = classifyOutcome(
        { status: c.status, csatRating: c.csatRating, endedAt: c.endedAt },
        lastSenders.get(Number(c.id)) ?? null,
        prompted.has(Number(c.id)),
      );
      const entry = tally.get(outcome.reason) ?? { resolved: outcome.resolved, count: 0 };
      entry.count += 1;
      tally.set(outcome.reason, entry);
      if (c.status === 'ended') {
        ended += 1;
        if (outcome.resolved) resolved += 1;
      }
    }
    return {
      ended,
      resolved,
      resolutionRate: ended ? resolved / ended : 0,
      byReason: [...tally.entries()]
        .map(([reason, v]) => ({ reason, resolved: v.resolved, count: v.count }))
        .sort((a, b) => b.count - a.count),
    };
  }

  /**
   * When customers write, in the tenant's own clock.
   *
   * Drawn in UTC a Korean shop's 3pm rush appears at 6am, which is not a small
   * error — it is the opposite of the answer the chart is asked for. Nine of
   * eleven tenants have no timezone set, so the fallback is named on the axis
   * rather than guessed from the language.
   */
  async hours(tenantId: number, window: Window): Promise<HourGrid> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    const zone = tenant?.timezone?.trim() || 'UTC';
    const rows = await this.msgRepo
      .createQueryBuilder('m')
      .select('m.created_at', 'createdAt')
      .where('m.tenant_id = :tenantId', { tenantId })
      .andWhere('m.sender_type = :user', { user: SENDER_TYPE.USER })
      .andWhere('m.created_at >= :from AND m.created_at < :to', window)
      // Same sandbox rule as every other count here. Operators test the widget
      // during their own working hours, so preview traffic would pile onto the
      // exact hours the chart is asked about and look like customer demand.
      .andWhere(
        'NOT EXISTS (SELECT 1 FROM conversations pc JOIN sessions ps ON ps.id = pc.session_id ' +
          "WHERE pc.id = m.conversation_id AND ps.channel = 'preview')",
      )
      .getRawMany<{ createdAt: Date | string }>();

    const grid: number[][] = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    let total = 0;
    for (const r of rows) {
      const at = r.createdAt instanceof Date ? r.createdAt : new Date(String(r.createdAt));
      if (Number.isNaN(at.getTime())) continue;
      const { weekday, hour } = inZone(at, zone);
      grid[weekday][hour] += 1;
      total += 1;
    }
    return {
      timezone: zone,
      timezoneSource: tenant?.timezone?.trim() ? 'tenant' : 'default',
      grid,
      total,
    };
  }

  /**
   * The sessions behind these conversations.
   *
   * Ids are filtered to finite numbers before the IN clause: one undefined
   * would bind as NaN, and MySQL reads that as a column name rather than a
   * value — a 500 with a message about an unknown column 'NaN', which says
   * nothing about the conversation that caused it.
   */
  private async sessionsOf(convs: Conversation[]): Promise<Session[]> {
    // `> 0`, not merely finite: `Number(null)` is 0, which is a valid-looking id
    // that belongs to no session and would quietly join every conversation
    // missing one into a single bucket.
    const ids = [...new Set(convs.map((c) => Number(c.sessionId)).filter((id) => id > 0))];
    if (!ids.length) return [];
    return this.sessionRepo
      .createQueryBuilder('s')
      .select(['s.id', 's.aiAgentId'])
      .where('s.id IN (:...ids)', { ids })
      .getMany();
  }

  /** conversation id → total and customer-only message counts. */
  private async messageCounts(
    convIds: number[],
  ): Promise<Map<number, { total: number; inbound: number }>> {
    if (!convIds.length) return new Map();
    const rows = await this.msgRepo
      .createQueryBuilder('m')
      .select('m.conversation_id', 'conversationId')
      .addSelect('COUNT(*)', 'total')
      .addSelect('SUM(m.sender_type = :user)', 'inbound')
      .setParameter('user', SENDER_TYPE.USER)
      .where('m.conversation_id IN (:...ids)', { ids: convIds })
      .groupBy('m.conversation_id')
      .getRawMany<{ conversationId: string; total: string; inbound: string | null }>();
    return new Map(
      rows.map((r) => [
        Number(r.conversationId),
        { total: Number(r.total), inbound: Number(r.inbound ?? 0) },
      ]),
    );
  }

  /** conversation id → messages sent by one kind of sender. */
  private async senderCountsByConversation(
    convIds: number[],
    senderType: string,
  ): Promise<Map<number, number>> {
    if (!convIds.length) return new Map();
    const rows = await this.msgRepo
      .createQueryBuilder('m')
      .select('m.conversation_id', 'conversationId')
      .addSelect('COUNT(*)', 'sent')
      .where('m.conversation_id IN (:...ids)', { ids: convIds })
      .andWhere('m.sender_type = :senderType', { senderType })
      .groupBy('m.conversation_id')
      .getRawMany<{ conversationId: string; sent: string }>();
    return new Map(rows.map((r) => [Number(r.conversationId), Number(r.sent)]));
  }

  /** agent user id → replies sent, across the conversations in range. */
  private async agentReplyCounts(convIds: number[]): Promise<Map<number, number>> {
    if (!convIds.length) return new Map();
    const rows = await this.msgRepo
      .createQueryBuilder('m')
      .select('m.sender_id', 'senderId')
      .addSelect('COUNT(*)', 'sent')
      .where('m.conversation_id IN (:...ids)', { ids: convIds })
      .andWhere('m.sender_type = :agent', { agent: SENDER_TYPE.AGENT })
      .andWhere('m.sender_id IS NOT NULL')
      .groupBy('m.sender_id')
      .getRawMany<{ senderId: string; sent: string }>();
    return new Map(rows.map((r) => [Number(r.senderId), Number(r.sent)]));
  }

  private async lastNonSystemSenders(convIds: number[]): Promise<Map<number, string>> {
    if (!convIds.length) return new Map();
    const rows = await this.msgRepo
      .createQueryBuilder('m')
      .select('m.conversation_id', 'conversationId')
      .addSelect('m.sender_type', 'senderType')
      .where('m.conversation_id IN (:...ids)', { ids: convIds })
      .andWhere('m.sender_type != :system', { system: SENDER_TYPE.SYSTEM })
      .andWhere(
        'm.id = (SELECT MAX(m2.id) FROM messages m2 WHERE m2.conversation_id = m.conversation_id ' +
          'AND m2.sender_type != :system)',
      )
      .getRawMany<{ conversationId: string; senderType: string }>();
    return new Map(rows.map((r) => [Number(r.conversationId), r.senderType]));
  }

  /** `close()` clears idle_prompt_at, so the audit trail is the only record. */
  private async promptedConversationIds(
    tenantId: number,
    convIds: number[],
  ): Promise<Set<number>> {
    if (!convIds.length) return new Set();
    // Bounded by the conversations actually being counted: the audit log is the
    // busiest table here and every prompt this tenant has ever sent would
    // otherwise be read to answer a 30-day question.
    const targets = convIds.map((id) => `conversation:${id}`);
    const rows = await this.auditRepo
      .createQueryBuilder('a')
      .select('a.target', 'target')
      .where('a.action = :action', { action: 'chat.idle_prompted' })
      .andWhere('a.tenant_id = :tenantId', { tenantId })
      .andWhere('a.target IN (:...targets)', { targets })
      .getRawMany<{ target: string | null }>();
    const out = new Set<number>();
    for (const r of rows) {
      const id = Number((r.target ?? '').replace('conversation:', ''));
      if (Number.isFinite(id)) out.add(id);
    }
    return out;
  }
}

/**
 * Middle value — the typical conversation, unmoved by one 900-message group room.
 *
 * Rounded on an even count deliberately: this is presented as "the size of a
 * typical conversation", and half a message is not a thing. The mean beside it
 * carries the decimal.
 */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/**
 * Weekday and hour of an instant in an IANA zone.
 *
 * `Intl` rather than SQL `CONVERT_TZ`: the named-zone tables are loaded on this
 * MySQL but that is a property of one server's setup, not of the schema, and a
 * chart silently returning NULL hours on a database without them is the kind of
 * failure nobody attributes to a missing time zone table.
 */
export function inZone(at: Date, timeZone: string): { weekday: number; hour: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const weekdayName = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const weekday = Math.max(0, days.indexOf(weekdayName));
  return { weekday, hour: hour === 24 ? 0 : hour };
}
