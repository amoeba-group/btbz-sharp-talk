import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { SENDER_TYPE } from '@sharptalk/types';
import { Session } from '../session/entity/session.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { Message } from '../chat/entity/message.entity';
import { Assignment } from '../agent/entity/assignment.entity';
import { CjmEvent } from '../cjm/entity/cjm-event.entity';
import { AuditLog } from '../audit/entity/audit-log.entity';
import { ChatGroupMember } from '../agent/entity/chat-group-member.entity';
import {
  RESOLUTION_REASON,
  UNRESOLVED_REASON,
  classifyOutcome,
  lastNonSystemSender,
} from '../../global/util/resolution.util';
import { FiveA, toFiveA } from './journey-stage-map';

// Re-exported so the report's own module and its spec keep one import path.
export { RESOLUTION_REASON, UNRESOLVED_REASON, classifyOutcome };


export interface JourneyMetrics {
  sessionCount: number;
  firstContactAt: string | null;
  channels: Array<{ channel: string; sessions: number }>;
  primaryChannel: string | null;
  conversations: number;
  messages: number;
  customerMessages: number;
  /** AI + human together — kept for past reports and the comparison prompt. */
  agentMessages: number;
  /** Split, because "we answered" means something different from each (REQ-261008 F6). */
  aiMessages: number;
  humanMessages: number;
  /** Speaker changes per conversation, averaged. Where delay shows up. Null with no conversation. */
  avgLoops: number | null;
  handoffs: number;
  resolved: number;
  resolvedBy: Record<string, number>;
  unresolved: number;
  unresolvedBy: Record<string, number>;
  /** Median, not mean: one abandoned thread reopened weeks later drags a mean. */
  medianResolutionMinutes: number | null;
  csatAverage: number | null;
  csatResponses: number;
  stages: Array<{ stage: string; events: number }>;
  latestStage: string | null;
  /** `stages` re-counted on Kotler's 5A through one fixed table. */
  stages5a: Array<{ stage: FiveA; events: number }>;
  languages: Array<{ language: string; sessions: number }>;
}

export interface JourneyWindow {
  from: string | null;
  to: string | null;
}

/**
 * Everything the report counts (PLN-260825 §2).
 *
 * Deliberately free of the model. A language model asked to count produces
 * confident wrong numbers, and a report is the format that makes them look like
 * evidence — so the figures are computed here and the narrative is written
 * *from* them.
 */
@Injectable()
export class JourneyMetricsService {
  constructor(
    @InjectRepository(ChatGroupMember) private readonly memberRepo: Repository<ChatGroupMember>,
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(Assignment) private readonly assignmentRepo: Repository<Assignment>,
    @InjectRepository(CjmEvent) private readonly cjmRepo: Repository<CjmEvent>,
    @InjectRepository(AuditLog) private readonly auditRepo: Repository<AuditLog>,
  ) {}

  /** The sessions a report will read — snapshotted by the caller. */
  async sessionIdsFor(tenantId: number, groupId: number, window: JourneyWindow): Promise<number[]> {
    const members = await this.memberRepo.find({ where: { tenantId, groupId } });
    const ids = members.map((m) => Number(m.sessionId));
    if (!ids.length) return [];
    const sessions = await this.sessionRepo.find({ where: { tenantId, id: In(ids) } });
    return sessions.filter((s) => inWindow(s.createdAt, window)).map((s) => Number(s.id));
  }

  async compute(tenantId: number, sessionIds: number[]): Promise<JourneyMetrics> {
    if (!sessionIds.length) return emptyMetrics();

    const sessions = await this.sessionRepo.find({ where: { tenantId, id: In(sessionIds) } });
    const conversations = await this.convRepo.find({
      where: { tenantId, sessionId: In(sessionIds) },
    });
    const convIds = conversations.map((c) => Number(c.id));
    const messages = convIds.length
      ? await this.msgRepo.find({
          where: { conversationId: In(convIds) },
          order: { id: 'ASC' },
        })
      : [];

    const byConv = new Map<number, Message[]>();
    for (const m of messages) {
      const key = Number(m.conversationId);
      const list = byConv.get(key) ?? [];
      list.push(m);
      byConv.set(key, list);
    }

    // Which conversations were prompted-then-closed. `close()` clears
    // `idle_prompt_at`, so a finished row cannot say whether it was asked —
    // the audit trail is the only place that still knows.
    const prompted = await this.promptedConversationIds(tenantId, convIds);

    const resolvedBy: Record<string, number> = {};
    const unresolvedBy: Record<string, number> = {};
    const durations: number[] = [];

    for (const conv of conversations) {
      const id = Number(conv.id);
      const list = byConv.get(id) ?? [];
      const outcome = classifyOutcome(conv, lastNonSystemSender(list), prompted.has(id));
      if (outcome.resolved) {
        resolvedBy[outcome.reason] = (resolvedBy[outcome.reason] ?? 0) + 1;
        const started = list[0]?.createdAt ?? conv.createdAt;
        // No `ended_at` means the close never wrote one; timing it from the
        // last message would invent a duration, so the conversation counts as
        // resolved but contributes nothing to the median.
        const ended = conv.endedAt;
        if (ended) durations.push((ended.getTime() - started.getTime()) / 60_000);
      } else {
        unresolvedBy[outcome.reason] = (unresolvedBy[outcome.reason] ?? 0) + 1;
      }
    }

    const channels = countBy(sessions, (s) => s.channel ?? 'widget');
    const languages = countBy(sessions, (s) => s.language ?? 'EN');
    const cjm = sessionIds.length
      ? await this.cjmRepo.find({ where: { tenantId, sessionId: In(sessionIds) }, order: { id: 'ASC' } })
      : [];
    const handoffs = convIds.length
      ? await this.assignmentRepo.count({ where: { tenantId, conversationId: In(convIds) } })
      : 0;

    const customerMessages = messages.filter((m) => m.senderType === SENDER_TYPE.USER).length;
    const aiMessages = messages.filter((m) => m.senderType === SENDER_TYPE.AI).length;
    const humanMessages = messages.filter((m) => m.senderType === SENDER_TYPE.AGENT).length;
    const stages = countBy(cjm, (e) => e.stage).map((c) => ({ stage: c.channel, events: c.sessions }));

    const csatRated = conversations.filter((c) => c.csatRating != null);

    return {
      sessionCount: sessions.length,
      firstContactAt: earliest(sessions.map((s) => s.createdAt)),
      channels,
      primaryChannel: channels[0]?.channel ?? null,
      conversations: conversations.length,
      messages: messages.length,
      customerMessages,
      agentMessages: aiMessages + humanMessages,
      aiMessages,
      humanMessages,
      avgLoops: average(conversations.map((c) => loopsIn(byConv.get(Number(c.id)) ?? []))),
      handoffs,
      resolved: sum(Object.values(resolvedBy)),
      resolvedBy,
      unresolved: sum(Object.values(unresolvedBy)),
      unresolvedBy,
      medianResolutionMinutes: median(durations),
      csatAverage: csatRated.length
        ? round(sum(csatRated.map((c) => Number(c.csatRating))) / csatRated.length, 2)
        : null,
      csatResponses: csatRated.length,
      stages,
      latestStage: cjm.length ? cjm[cjm.length - 1].stage : null,
      stages5a: toFiveA(stages),
      languages: languages.map((c) => ({ language: c.channel, sessions: c.sessions })),
    };
  }

  /** Conversations the idle sweeper asked "anything else?" before closing. */
  private async promptedConversationIds(tenantId: number, convIds: number[]): Promise<Set<number>> {
    if (!convIds.length) return new Set();
    const rows = await this.auditRepo.find({
      where: { tenantId, action: 'chat.idle_prompted' },
    });
    const wanted = new Set(convIds.map(String));
    const out = new Set<number>();
    for (const r of rows) {
      const id = (r.target ?? '').replace('conversation:', '');
      if (wanted.has(id)) out.add(Number(id));
    }
    return out;
  }
}


/** Speaker changes: a question answered in one turn loops once. */
export function loopsIn(messages: Array<Pick<Message, 'senderType'>>): number {
  let loops = 0;
  let prev: string | null = null;
  for (const m of messages) {
    if (m.senderType === SENDER_TYPE.SYSTEM) continue;
    if (prev && m.senderType !== prev) loops += 1;
    prev = m.senderType;
  }
  return loops;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return round(value, 1);
}

function inWindow(at: Date, w: JourneyWindow): boolean {
  const day = at.toISOString().slice(0, 10);
  if (w.from && day < w.from) return false;
  if (w.to && day > w.to) return false;
  return true;
}

function countBy<T>(rows: T[], key: (row: T) => string): Array<{ channel: string; sessions: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([channel, sessions]) => ({ channel, sessions }))
    .sort((a, b) => b.sessions - a.sessions);
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);
// Null, not 0, over nothing: zero loops is a fact about conversations, and
// with none there is no fact to state (REQ-261008 F7).
const average = (values: number[]): number | null =>
  values.length ? round(sum(values) / values.length, 1) : null;
const round = (v: number, digits: number): number => Number(v.toFixed(digits));
const earliest = (dates: Date[]): string | null =>
  dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))).toISOString() : null;

function emptyMetrics(): JourneyMetrics {
  return {
    sessionCount: 0,
    firstContactAt: null,
    channels: [],
    primaryChannel: null,
    conversations: 0,
    messages: 0,
    customerMessages: 0,
    agentMessages: 0,
    aiMessages: 0,
    humanMessages: 0,
    avgLoops: null,
    handoffs: 0,
    resolved: 0,
    resolvedBy: {},
    unresolved: 0,
    unresolvedBy: {},
    medianResolutionMinutes: null,
    csatAverage: null,
    csatResponses: 0,
    stages: [],
    latestStage: null,
    stages5a: toFiveA([]),
    languages: [],
  };
}
