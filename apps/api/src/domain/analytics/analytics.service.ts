import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CONVERSATION_STATUS, SENDER_TYPE } from '@sharptalk/types';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { Notification } from '../notification/entity/notification.entity';
import { CjmEvent } from '../cjm/entity/cjm-event.entity';
import { OrderCache } from '../order/entity/order-cache.entity';
import { Session } from '../session/entity/session.entity';
import { Customer } from '../customer/entity/customer.entity';
import { User } from '../user/entity/user.entity';
import { QuestionStatDaily, STAT_DIMENSION } from './entity/question-stat-daily.entity';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { maskName } from '../../global/util/pii-display.util';
import { toDateKey } from '../../global/util/date-range.util';
import { classifyOutcome } from '../../global/util/resolution.util';
import { AuditLog } from '../audit/entity/audit-log.entity';

export interface DashboardKpis {
  activeChats: number;
  todayNotifications: number;
  aiResolutionRate: number;
  /** Top question topics from the daily snapshots (was: the last 5 message bodies). */
  popularQuestions: string[];
  /**
   * Conversations currently waiting for an agent. Named `unresolvedTopN` on the
   * wire for backward compatibility; it was never a "top N" of anything.
   */
  unresolvedTopN: number;
  totalConversations: number;
  totalOrders: number;
}

export interface ConversationSearchParams {
  status?: string;
  escalated?: boolean;
  from?: Date;
  to?: Date;
  /** Explicit "show me this agent's conversations" filter (SCR-104 §2). */
  agentId?: number;
  /** Free-text search over message bodies. */
  q?: string;
  /**
   * Admin-preview threads (/ai-setting) are excluded by default — they are
   * sandbox traffic, not customer history, and they would inflate every count
   * on this screen (PLN D8).
   */
  includePreview?: boolean;
  /**
   * Visibility floor from RBAC (PLN D1): when set, only conversations handled
   * by this agent are visible, whatever the other filters say.
   */
  restrictToAgentId?: number;
  page: number;
  size: number;
}

export interface ConversationRow {
  id: number;
  status: string;
  escalated: boolean;
  channel: string;
  customerName: string | null;
  agentId: number | null;
  agentName: string | null;
  messageCount: number;
  startedAt: Date;
  endedAt: Date | null;
}

/** Short cache so a busy console doesn't recompute the KPI set per pageview (PERF-8). */
const DASHBOARD_CACHE_TTL_SEC = 30;

/** Analytics & reporting (FN-038/039). Queries other domains' tables; owns none. */
@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(Notification) private readonly notifRepo: Repository<Notification>,
    @InjectRepository(CjmEvent) private readonly cjmRepo: Repository<CjmEvent>,
    @InjectRepository(OrderCache) private readonly orderRepo: Repository<OrderCache>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(QuestionStatDaily) private readonly statRepo: Repository<QuestionStatDaily>,
    // Repository only — the idle sweeper's prompt is recorded here and nowhere
    // else, and the resolution definition needs it (see resolutionCounts).
    @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
    private readonly redis: RedisService,
  ) {}

  /**
   * Dashboard KPIs (PERF-8). Tenant-scoped (`tenantId` null = system admin,
   * all tenants), counts run in parallel, and the whole payload is cached for
   * 30s — it was previously 7 sequential COUNTs + 50 full message rows,
   * tenant-UNscoped, on every console pageview.
   */
  async dashboard(tenantId: number | null): Promise<DashboardKpis> {
    const cacheKey = `dash:${tenantId ?? 'all'}`;
    if (this.redis.available()) {
      const hit = await this.redis.get(cacheKey);
      if (hit) return JSON.parse(hit) as DashboardKpis;
    }

    const tenantWhere = tenantId != null ? { tenantId } : {};
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const notifQb = this.notifRepo
      .createQueryBuilder('n')
      .where('n.created_at >= :start', { start: startOfToday });
    if (tenantId != null) notifQb.andWhere('n.tenant_id = :tenantId', { tenantId });

    // Popular questions come from the daily snapshots (last 30 days), using the
    // similar-question clusters: their labels are representative questions, so
    // the card reads as questions rather than as classifier labels, and it works
    // on backfilled history too (the intent lens only fills from new traffic
    // onward). This used to be the last 50 message bodies de-duplicated — a
    // recency list labelled as a frequency ranking, and one that put raw
    // customer text straight onto the dashboard.
    const trendStart = new Date(Date.now() - 30 * 86_400_000);
    const popularQb = this.statRepo
      .createQueryBuilder('s')
      .select('s.dim_label', 'label')
      .addSelect('SUM(s.asked)', 'asked')
      .where('s.dimension = :dim', { dim: STAT_DIMENSION.CLUSTER })
      .andWhere('s.dim_label IS NOT NULL')
      .andWhere('s.stat_date >= :from', { from: toDateKey(trendStart) })
      .groupBy('s.dim_label')
      .orderBy('asked', 'DESC')
      .limit(5);
    if (tenantId != null) popularQb.andWhere('s.tenant_id = :tenantId', { tenantId });

    const [
      activeChats,
      todayNotifications,
      resolution,
      popularRows,
      unresolvedTopN,
      totalConversations,
      totalOrders,
    ] = await Promise.all([
      this.realConversations(tenantId)
        .andWhere('c.status IN (:...open)', {
          open: [
            CONVERSATION_STATUS.AI_ACTIVE,
            CONVERSATION_STATUS.AGENT,
            CONVERSATION_STATUS.WAITING,
          ],
        })
        .getCount(),
      notifQb.getCount(),
      this.resolutionCounts(tenantId),
      popularQb.getRawMany<{ label: string | null; asked: string }>(),
      this.realConversations(tenantId)
        .andWhere('c.status = :waiting', { waiting: CONVERSATION_STATUS.WAITING })
        .getCount(),
      this.realConversations(tenantId).getCount(),
      this.orderRepo.count({ where: tenantWhere }),
    ]);

    const popularQuestions = popularRows
      .map((r) => r.label)
      .filter((l): l is string => !!l);

    const kpis: DashboardKpis = {
      activeChats,
      todayNotifications,
      aiResolutionRate:
        resolution.ended > 0 ? Math.round((resolution.resolved / resolution.ended) * 100) : 0,
      popularQuestions,
      unresolvedTopN,
      totalConversations,
      totalOrders,
    };
    await this.redis.set(cacheKey, JSON.stringify(kpis), DASHBOARD_CACHE_TTL_SEC);
    return kpis;
  }

  /**
   * Conversations a tenant actually had — sandbox threads excluded.
   *
   * `/ai-setting` preview threads are operator experiments. Conversation search
   * has always excluded them ("they would inflate every count on this screen");
   * the dashboard, in the same service, counted them. On staging that is 26% of
   * go2joy's conversations, so one card in four was measuring us testing
   * ourselves.
   */
  private realConversations(tenantId: number | null) {
    const qb = this.convRepo.createQueryBuilder('c');
    if (tenantId != null) qb.where('c.tenant_id = :tenantId', { tenantId });
    return qb.andWhere(
      "NOT EXISTS (SELECT 1 FROM sessions ps WHERE ps.id = c.session_id AND ps.channel = 'preview')",
    );
  }

  /**
   * Ended conversations and how many of them were resolved, by the one shared
   * definition (`classifyOutcome`).
   *
   * This used to be "ended and not escalated", which scores a customer who gave
   * up as a success and disagreed with the journey report about the same
   * conversations. Both now answer from `resolution.util`.
   *
   * Two supporting facts are read in bulk rather than per conversation: who
   * spoke last (system notices skipped) and whether the idle sweeper asked
   * "anything else?" — `close()` clears `idle_prompt_at`, so the audit trail is
   * the only place that still knows.
   */
  private async resolutionCounts(
    tenantId: number | null,
  ): Promise<{ ended: number; resolved: number }> {
    const ended = await this.realConversations(tenantId)
      .andWhere('c.status = :ended', { ended: CONVERSATION_STATUS.ENDED })
      .select(['c.id', 'c.status', 'c.csat_rating', 'c.ended_at'])
      .getMany();
    if (!ended.length) return { ended: 0, resolved: 0 };

    const ids = ended.map((c) => Number(c.id));
    const lastSenders = await this.lastNonSystemSenders(ids);
    const prompted = await this.promptedConversationIds(tenantId, ids);

    let resolved = 0;
    for (const conv of ended) {
      const outcome = classifyOutcome(
        { status: conv.status, csatRating: conv.csatRating, endedAt: conv.endedAt },
        lastSenders.get(Number(conv.id)) ?? null,
        prompted.has(Number(conv.id)),
      );
      if (outcome.resolved) resolved += 1;
    }
    return { ended: ended.length, resolved };
  }

  /** conversation id → last sender that was not a system notice. */
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
          "AND m2.sender_type != :system)",
      )
      .getRawMany<{ conversationId: string; senderType: string }>();
    return new Map(rows.map((r) => [Number(r.conversationId), r.senderType]));
  }

  /** Conversations the idle sweeper asked "anything else?" before closing. */
  private async promptedConversationIds(
    tenantId: number | null,
    convIds: number[],
  ): Promise<Set<number>> {
    if (!convIds.length) return new Set();
    const qb = this.auditRepo
      .createQueryBuilder('a')
      .select('a.target', 'target')
      .where('a.action = :action', { action: 'chat.idle_prompted' });
    if (tenantId != null) qb.andWhere('a.tenant_id = :tenantId', { tenantId });
    const rows = await qb.getRawMany<{ target: string | null }>();
    const wanted = new Set(convIds.map(String));
    const out = new Set<number>();
    for (const r of rows) {
      const id = (r.target ?? '').replace('conversation:', '');
      if (wanted.has(id)) out.add(Number(id));
    }
    return out;
  }

  /**
   * The most recent day the snapshot holds, and how far behind yesterday it is.
   *
   * A day with no customer questions writes no rows, so "behind" here means
   * "no data since", not "the job is broken" — the screen says the date and
   * lets the reader judge.
   */
  private async snapshotFreshness(
    tenantId: number | null,
  ): Promise<{ lastAggregated: string | null; staleDays: number }> {
    const qb = this.statRepo.createQueryBuilder('s').select('MAX(s.stat_date)', 'last');
    if (tenantId != null) qb.where('s.tenant_id = :tenantId', { tenantId });
    const row = await qb.getRawOne<{ last: string | Date | null }>();
    if (!row?.last) return { lastAggregated: null, staleDays: 0 };
    const last = row.last instanceof Date ? toDateKey(row.last) : String(row.last).slice(0, 10);
    const yesterday = toDateKey(new Date(Date.now() - 86_400_000));
    const diff = Math.round(
      (Date.parse(`${yesterday}T00:00:00Z`) - Date.parse(`${last}T00:00:00Z`)) / 86_400_000,
    );
    return { lastAggregated: last, staleDays: diff > 0 ? diff : 0 };
  }

  /** Conversation history search — tenant-scoped, message counts batched (PERF-7). */
  async searchConversations(
    tenantId: number | null,
    params: ConversationSearchParams,
  ): Promise<{ items: ConversationRow[]; total: number }> {
    const qb = this.convRepo.createQueryBuilder('c');
    if (tenantId != null) qb.andWhere('c.tenant_id = :tenantId', { tenantId });
    if (params.status) qb.andWhere('c.status = :status', { status: params.status });
    if (params.escalated !== undefined) {
      qb.andWhere('c.escalated = :escalated', { escalated: params.escalated ? 1 : 0 });
    }
    if (params.from) qb.andWhere('c.created_at >= :from', { from: params.from });
    if (params.to) qb.andWhere('c.created_at < :to', { to: params.to });
    if (params.restrictToAgentId != null) {
      qb.andWhere('c.agent_id = :scopeAgent', { scopeAgent: params.restrictToAgentId });
    }
    if (params.agentId != null) qb.andWhere('c.agent_id = :agentId', { agentId: params.agentId });
    if (!params.includePreview) {
      // The preview marker lives on the session, not the conversation:
      // getOrCreateConversation always writes channel='widget'. Filtering on
      // c.channel would let every sandbox thread through.
      qb.andWhere(
        "NOT EXISTS (SELECT 1 FROM sessions ps WHERE ps.id = c.session_id AND ps.channel = 'preview')",
      );
    }
    if (params.q) {
      qb.andWhere('EXISTS (SELECT 1 FROM messages qm WHERE qm.conversation_id = c.id AND qm.body LIKE :q)', {
        q: `%${params.q}%`,
      });
    }
    qb.orderBy('c.id', 'DESC')
      .skip((params.page - 1) * params.size)
      .take(params.size);
    const [conversations, total] = await qb.getManyAndCount();

    const [countByConv, sessionInfo, agentNames] = await Promise.all([
      this.messageCounts(conversations.map((c) => c.id)),
      this.sessionInfo(conversations.map((c) => c.sessionId)),
      this.agentNames(conversations.map((c) => c.agentId)),
    ]);
    const customerNames = await this.customerNames(
      [...sessionInfo.values()].map((s) => s.customerId),
    );

    const items = conversations.map((c) => {
      const s = sessionInfo.get(String(c.sessionId));
      return {
        id: c.id,
        status: c.status,
        escalated: c.escalated === 1,
        channel: s?.channel ?? c.channel,
        customerName: s?.customerId != null ? (customerNames.get(String(s.customerId)) ?? null) : null,
        agentId: c.agentId,
        agentName: c.agentId != null ? (agentNames.get(String(c.agentId)) ?? null) : null,
        messageCount: countByConv.get(String(c.id)) ?? 0,
        startedAt: c.createdAt,
        endedAt: c.endedAt,
      };
    });
    return { items, total };
  }

  /**
   * Full conversation with its message thread (SCR-104 §1). The history screen
   * previously called this route and got a 404 — it never existed, so the
   * detail modal showed metadata only and the transcript was reachable only
   * through the agent console, which lists open threads and therefore cannot
   * reach an ended conversation at all.
   *
   * Returns null when the conversation is outside the caller's tenant or, for a
   * rank-limited agent, outside the conversations they handled.
   */
  async conversationDetail(
    tenantId: number | null,
    id: number,
    restrictToAgentId?: number,
  ): Promise<Record<string, unknown> | null> {
    const where: Record<string, unknown> = { id };
    if (tenantId != null) where.tenantId = tenantId;
    if (restrictToAgentId != null) where.agentId = restrictToAgentId;
    const conv = await this.convRepo.findOne({ where });
    if (!conv) return null;

    const [messages, sessionInfo, agentNames] = await Promise.all([
      this.msgRepo.find({ where: { conversationId: id }, order: { id: 'ASC' } }),
      this.sessionInfo([conv.sessionId]),
      this.agentNames([conv.agentId]),
    ]);
    const session = sessionInfo.get(String(conv.sessionId));
    const customerNames = await this.customerNames([session?.customerId ?? null]);
    // Agent turns carry the sending user id; resolve those too so the thread
    // reads as a conversation between named people, not sender_type labels.
    const senderNames = await this.agentNames(messages.map((m) => m.senderId));

    return {
      id: conv.id,
      status: conv.status,
      escalated: conv.escalated === 1,
      channel: session?.channel ?? conv.channel,
      language: session?.language ?? null,
      customerName:
        session?.customerId != null ? (customerNames.get(String(session.customerId)) ?? null) : null,
      agentId: conv.agentId,
      agentName: conv.agentId != null ? (agentNames.get(String(conv.agentId)) ?? null) : null,
      startedAt: conv.createdAt,
      endedAt: conv.endedAt,
      messages: messages.map((m) => ({
        id: m.id,
        senderType: m.senderType,
        senderId: m.senderId,
        senderName: m.senderId != null ? (senderNames.get(String(m.senderId)) ?? null) : null,
        body: m.body,
        lang: m.lang,
        // The grounding behind each AI turn — which documents it cited and how
        // confident it was. Stored since the RAG work but dropped by every
        // existing read path, so nobody could see why an answer was given.
        trace: this.readableTrace(m.retrievalTrace),
        createdAt: m.createdAt,
      })),
    };
  }

  /**
   * Question statistics for one lens over a date range (PLN S3). Reads only the
   * daily snapshots — never the raw messages — so numbers stay stable after the
   * retention purge removes the conversations behind them.
   */
  async questionStats(
    tenantId: number | null,
    params: { dimension: string; from: Date; to: Date; limit: number },
  ): Promise<{
    top: Array<{
      key: string;
      label: string | null;
      asked: number;
      escalated: number;
      noSource: number;
      escalationRate: number;
      avgConfidence: number | null;
    }>;
    trend: Array<{ date: string; asked: number }>;
    total: number;
    /** Latest day the snapshot job has written, over all dimensions. */
    lastAggregated: string | null;
    /** Whole days between `lastAggregated` and yesterday — 0 when current. */
    staleDays: number;
  }> {
    const base = () => {
      const qb = this.statRepo
        .createQueryBuilder('s')
        .where('s.dimension = :dimension', { dimension: params.dimension })
        .andWhere('s.stat_date >= :from', { from: toDateKey(params.from) })
        .andWhere('s.stat_date <= :to', { to: toDateKey(params.to) });
      if (tenantId != null) qb.andWhere('s.tenant_id = :tenantId', { tenantId });
      return qb;
    };

    const topRows = await base()
      .select('s.dim_key', 'key')
      // MAX, not ANY_VALUE: a label can be edited between days and MAX is
      // deterministic, so the same range always renders the same text.
      .addSelect('MAX(s.dim_label)', 'label')
      .addSelect('SUM(s.asked)', 'asked')
      .addSelect('SUM(s.escalated)', 'escalated')
      .addSelect('SUM(s.no_source)', 'noSource')
      // Confidence is a per-day mean, so weight by that day's volume rather
      // than averaging the averages.
      .addSelect('SUM(s.avg_confidence * s.asked) / NULLIF(SUM(CASE WHEN s.avg_confidence IS NULL THEN 0 ELSE s.asked END), 0)', 'avgConfidence')
      .groupBy('s.dim_key')
      .orderBy('asked', 'DESC')
      .limit(params.limit)
      .getRawMany<{
        key: string;
        label: string | null;
        asked: string;
        escalated: string;
        noSource: string;
        avgConfidence: string | null;
      }>();

    const trendRows = await base()
      .select('s.stat_date', 'date')
      .addSelect('SUM(s.asked)', 'asked')
      .groupBy('s.stat_date')
      .orderBy('s.stat_date', 'ASC')
      .getRawMany<{ date: string | Date; asked: string }>();

    const top = topRows.map((r) => {
      const asked = Number(r.asked);
      const escalated = Number(r.escalated);
      return {
        key: r.key,
        label: r.label,
        asked,
        escalated,
        noSource: Number(r.noSource),
        escalationRate: asked > 0 ? escalated / asked : 0,
        avgConfidence: r.avgConfidence == null ? null : Number(r.avgConfidence),
      };
    });

    // How fresh the numbers are. The job aggregates *yesterday*, so being one
    // day behind today is current, not late. Without this the screen looks
    // identical whether the snapshot ran this morning or a week ago — which is
    // exactly how a stalled job would hide.
    const { lastAggregated, staleDays } = await this.snapshotFreshness(tenantId);

    return {
      top,
      trend: trendRows.map((r) => ({
        date: r.date instanceof Date ? toDateKey(r.date) : String(r.date),
        asked: Number(r.asked),
      })),
      lastAggregated,
      staleDays,
      // Total questions in range for this lens. A question counted under two
      // keywords appears twice here by design — it is the lens total, not a
      // conversation count.
      total: trendRows.reduce((sum, r) => sum + Number(r.asked), 0),
    };
  }

  /** Narrow retrieval_trace to the fields the console renders; ignore malformed rows. */
  private readableTrace(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object') return null;
    const t = raw as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if (Array.isArray(t.citations)) out.citations = t.citations;
    if (typeof t.confidence === 'number') out.confidence = t.confidence;
    if (typeof t.reason === 'string') out.reason = t.reason;
    if (typeof t.scenario === 'string') out.scenario = t.scenario;
    return Object.keys(out).length > 0 ? out : null;
  }

  /** session id → channel/customer/language, in one query. */
  private async sessionInfo(
    ids: number[],
  ): Promise<Map<string, { channel: string | null; customerId: number | null; language: string }>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.sessionRepo.find({
      where: { id: In(unique) },
      select: ['id', 'channel', 'customerId', 'language'],
    });
    return new Map(
      rows.map((r) => [
        String(r.id),
        { channel: r.channel, customerId: r.customerId, language: r.language },
      ]),
    );
  }

  /**
   * Customer id → masked display name. Loaded through the repository so the
   * PII-at-rest transformer decrypts, then masked again for the console.
   *
   * Uses the display mask, not the log mask: history sits next to the live-chat
   * queue and the customers screen, and one name should not wear two different
   * disguises across three screens (PLN-260920).
   */
  private async customerNames(ids: Array<number | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is number => i != null))];
    if (unique.length === 0) return new Map();
    const rows = await this.customerRepo.find({ where: { id: In(unique) }, select: ['id', 'name'] });
    return new Map(
      rows.filter((r) => r.name).map((r) => [String(r.id), maskName(r.name) as string]),
    );
  }

  /** Staff user id → display name (agent column + agent message attribution). */
  private async agentNames(ids: Array<number | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((i): i is number => i != null))];
    if (unique.length === 0) return new Map();
    const rows = await this.userRepo.find({ where: { id: In(unique) }, select: ['id', 'name', 'email'] });
    return new Map(rows.map((r) => [String(r.id), r.name || r.email]));
  }

  /** conversation id → message count in one GROUP BY query (PERF-7). */
  private async messageCounts(ids: number[]): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.msgRepo
      .createQueryBuilder('m')
      .select('m.conversation_id', 'cid')
      .addSelect('COUNT(*)', 'cnt')
      .where('m.conversation_id IN (:...ids)', { ids })
      .groupBy('m.conversation_id')
      .getRawMany<{ cid: string; cnt: string }>();
    return new Map(rows.map((r) => [String(r.cid), Number(r.cnt)]));
  }
}
