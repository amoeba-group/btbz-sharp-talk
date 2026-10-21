import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Not, Repository } from 'typeorm';
import { SENDER_TYPE } from '@sharptalk/types';
import { Conversation } from './entity/conversation.entity';
import { Message } from './entity/message.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { User } from '../user/entity/user.entity';
import { Session } from '../session/entity/session.entity';
import { AiConfigService } from '../ai-engine/ai-config.service';
import { buildHistory } from './conversation-history.util';

/** Whose thread a conversation belongs to: a company (B2B) or a customer. */
export interface ThreadAccount {
  companyId: number | null;
  customerId: number | null;
}

export interface ThreadSettings {
  /** What the widget shows a B2B contact: own conversations ('self') or the company's ('company'). */
  scope: 'self' | 'company';
  /** Prefer the previous conversation's agent within this many hours of its end; 0 = off. */
  stickyHours: number;
}

/** One earlier conversation for the widget, newest message last. */
export interface ThreadPage {
  conversations: Array<{ conversation: Conversation; messages: Message[]; own: boolean }>;
  hasMore: boolean;
  /** Earlier conversations of colleagues at the same company not shown ('self' scope). */
  colleagueCount: number;
}

const DEFAULT_SETTINGS: ThreadSettings = { scope: 'self', stickyHours: 24 };
/** Previous conversation older than this is not offered to the AI. */
const EXCERPT_MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const EXCERPT_MESSAGES = 6;
const EXCERPT_CHARS = 1500;
const WIDGET_MESSAGES_PER_CONVERSATION = 50;

/**
 * Account-level conversation threads (PLN-261022 stage 2).
 *
 * A conversation row still belongs to one session — the console queue, stats
 * and idle sweeps are session-based and stay that way. A THREAD is the account
 * view across sessions: every conversation of the company (B2B contact with a
 * company) or of the customer (anyone else signed in). Nothing here reopens or
 * moves an old row: a returning user gets a new conversation linked to the
 * previous one (`prev_conversation_id`), which is what the sticky agent and the
 * AI excerpt read.
 */
@Injectable()
export class ThreadService {
  private readonly logger = new Logger(ThreadService.name);

  constructor(
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly aiConfig: AiConfigService,
  ) {}

  /** The account a session's conversations belong to; null for a guest. */
  static accountOf(session: Pick<Session, 'customerId' | 'companyId'>): ThreadAccount | null {
    const companyId = session.companyId != null ? Number(session.companyId) : null;
    const customerId = session.customerId != null ? Number(session.customerId) : null;
    if (companyId == null && customerId == null) return null;
    return { companyId, customerId };
  }

  async enabled(tenantId: number | null | undefined): Promise<boolean> {
    if (tenantId == null) return false;
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId }, select: ['id', 'threadContinuity'] });
    return Number(tenant?.threadContinuity ?? 0) === 1;
  }

  async settings(tenantId: number): Promise<ThreadSettings> {
    const thread = (await this.aiConfig.getHandoffConfig(tenantId))?.thread;
    const hours = Number(thread?.stickyHours);
    return {
      scope: thread?.scope === 'company' ? 'company' : DEFAULT_SETTINGS.scope,
      stickyHours: Number.isFinite(hours) && hours >= 0 && hours <= 24 * 30 ? hours : DEFAULT_SETTINGS.stickyHours,
    };
  }

  /** Where clause for "this account's conversations" (company wins when known). */
  private static scopeWhere(tenantId: number, account: ThreadAccount) {
    return account.companyId != null
      ? { tenantId, companyId: account.companyId }
      : { tenantId, customerId: account.customerId! };
  }

  /** The account thread's newest conversation older than `beforeId` (or newest overall). */
  async previousOf(tenantId: number, account: ThreadAccount, beforeId?: number | null): Promise<Conversation | null> {
    return this.convRepo.findOne({
      where: { ...ThreadService.scopeWhere(tenantId, account), ...(beforeId != null ? { id: LessThan(beforeId) } : {}) },
      order: { id: 'DESC' },
    });
  }

  /**
   * The agent to prefer for a new conversation (sticky, D13): the previous
   * conversation's agent when it ended (or was last touched) within the window
   * and that user is still active. Never throws — a failed lookup only means
   * normal routing.
   */
  async stickyAgent(tenantId: number, conversation: Conversation): Promise<number | null> {
    try {
      if (conversation.prevConversationId == null || !(await this.enabled(tenantId))) return null;
      const { stickyHours } = await this.settings(tenantId);
      if (stickyHours <= 0) return null;
      const prev = await this.convRepo.findOne({ where: { id: conversation.prevConversationId, tenantId } });
      if (!prev?.agentId) return null;
      const closedAt = prev.endedAt ?? prev.createdAt;
      if (!closedAt || Date.now() - new Date(closedAt).getTime() > stickyHours * 3600 * 1000) return null;
      const agent = await this.userRepo.findOne({ where: { id: prev.agentId, tenantId }, select: ['id', 'status'] });
      return agent?.status === 'active' ? Number(agent.id) : null;
    } catch (err) {
      this.logger.warn(`sticky agent lookup failed (conversation ${conversation.id}): ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Earlier conversations for the widget, newest first, `limit` at a time,
   * all older than `beforeId`. B2B contacts see their own (scope 'self') or
   * the company's (scope 'company'); colleagues' conversations in 'self' are
   * only counted.
   */
  async listForWidget(session: Session, beforeId: number | null, limit: number): Promise<ThreadPage> {
    const tenantId = Number(session.tenantId);
    const account = ThreadService.accountOf(session);
    if (!account) return { conversations: [], hasMore: false, colleagueCount: 0 };
    const { scope } = await this.settings(tenantId);
    const own = account.customerId;
    const visibleWhere =
      account.companyId != null && scope === 'company'
        ? { tenantId, companyId: account.companyId }
        : account.companyId != null
          ? { tenantId, companyId: account.companyId, customerId: own ?? -1 }
          : { tenantId, customerId: own ?? -1 };
    const before = beforeId != null ? { id: LessThan(beforeId) } : {};
    const rows = await this.convRepo.find({ where: { ...visibleWhere, ...before }, order: { id: 'DESC' }, take: limit + 1 });
    const page = rows.slice(0, limit);
    const colleagueCount =
      account.companyId != null && scope === 'self' && own != null
        ? await this.convRepo.count({ where: { tenantId, companyId: account.companyId, customerId: Not(own), ...before } })
        : 0;
    const messages = page.length
      ? await this.msgRepo.find({ where: { conversationId: In(page.map((c) => Number(c.id))) }, order: { id: 'ASC' } })
      : [];
    const byConv = new Map<string, Message[]>();
    for (const m of messages) {
      const key = String(m.conversationId);
      byConv.set(key, [...(byConv.get(key) ?? []), m]);
    }
    return {
      conversations: page.map((c) => ({
        conversation: c,
        messages: (byConv.get(String(c.id)) ?? []).slice(-WIDGET_MESSAGES_PER_CONVERSATION),
        own: own != null && Number(c.customerId) === own,
      })),
      hasMore: rows.length > limit,
      colleagueCount,
    };
  }

  /**
   * The previous conversation as a short transcript for the AI (D14): its last
   * few turns, customer/agent text PII-scrubbed by the same builder the live
   * history uses. Only for continuity tenants, only within 30 days.
   */
  async previousExcerpt(tenantId: number, conversation: Conversation): Promise<string | undefined> {
    try {
      if (conversation.prevConversationId == null || !(await this.enabled(tenantId))) return undefined;
      const prev = await this.convRepo.findOne({ where: { id: conversation.prevConversationId, tenantId } });
      if (!prev || Date.now() - new Date(prev.createdAt).getTime() > EXCERPT_MAX_AGE_MS) return undefined;
      const rows = await this.msgRepo.find({
        where: { conversationId: prev.id, senderType: In([SENDER_TYPE.USER, SENDER_TYPE.AI, SENDER_TYPE.AGENT]) },
        order: { id: 'DESC' },
        take: EXCERPT_MESSAGES,
      });
      const turns = buildHistory(rows.reverse(), EXCERPT_CHARS);
      if (!turns.length) return undefined;
      const date = new Date(prev.createdAt).toISOString().slice(0, 10);
      return [`(${date})`, ...turns.map((t) => `${t.role === 'user' ? 'Customer' : 'Support'}: ${t.content}`)].join('\n');
    } catch (err) {
      this.logger.warn(`previous conversation excerpt failed (conversation ${conversation.id}): ${(err as Error).message}`);
      return undefined;
    }
  }
}
