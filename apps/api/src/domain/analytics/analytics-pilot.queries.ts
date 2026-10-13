import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from '../chat/entity/conversation.entity';
import {
  emptyMessageStats,
  emptyModeration,
  emptyPartner,
  normalizeStoredReason,
  parseLatencySample,
  toDate,
  toNumber,
} from './analytics-pilot.util';
import type {
  ConversationRow,
  LatencySample,
  MessageStats,
  ModerationStat,
  PartnerStat,
  ReasonStat,
} from './analytics-pilot.util';
import type { TranscriptMessage } from './analytics-pilot-csv.util';

/** `[from, to)` plus the optional stamp filters of a pilot request. */
export interface PilotQueryScope {
  from: Date;
  to: Date;
  hotelSn?: string;
  role?: string;
}

/** Messages longer than this are cut IN SQL — a pasted document must not travel to Node to be cut there. */
const TRANSCRIPT_BODY_FETCH_CHARS = 1_500;

/**
 * The SQL behind the pilot analytics (PLN-261012 SG-52), kept in one place and kept RAW on purpose:
 * the facts live in JSON traces (`retrieval_trace.confidence | citations | reason | latencyMs.*`) and
 * in MySQL's JSON functions, which the query builder cannot express. Raw SQL here is parameterised
 * only — every value (tenant, window, ids, filters) is a bound `?`; nothing is concatenated.
 *
 * Shape of the work, and why it is cheap:
 *  - ONE tenant-scoped, window-bounded read of `conversations` (+ its session); that bounds every
 *    other query, because they are all `conversation_id IN (<that page of ids>)` against indexed
 *    columns (`idx_msg_conv`, `idx_modlog_conv`, `idx_pll_conversation`, `idx_alert_conv`).
 *  - the per-message JSON work is done by MySQL as GROUP BY aggregates (one row per conversation),
 *    not by dragging every message into Node — except the AI turns' latency, where a percentile
 *    needs the individual values (one row per AI answer, five small numbers).
 *  - JSON is read defensively: `JSON_EXTRACT(NULL, …)` is NULL, `JSON_TYPE` guards every cast, so a
 *    legacy row with a NULL or oddly-shaped trace contributes nothing instead of failing the query.
 *
 * Tenant isolation: the conversation read filters `tenant_id`; the id lists everything else uses come
 * only from it, and the tables that carry `tenant_id` also filter on it (belt and braces).
 */
@Injectable()
export class AnalyticsPilotQueries {
  constructor(@InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>) {}

  /** `protected` so the SQL spec can record the statements it EXPLAINs (analytics-pilot.queries.sql.spec.ts). */
  protected run<T = Record<string, unknown>>(sql: string, params: unknown[]): Promise<T[]> {
    return this.convRepo.query(sql, params) as Promise<T[]>;
  }

  /**
   * Conversations created in the window, sandbox (admin preview) threads excluded, oldest first,
   * at most `limit`. A session that no longer exists still counts (LEFT JOIN): its conversation
   * happened.
   */
  async conversations(tenantId: number, scope: PilotQueryScope, limit: number): Promise<ConversationRow[]> {
    const where: string[] = [
      'c.tenant_id = ?',
      'c.created_at >= ?',
      'c.created_at < ?',
      "(s.channel IS NULL OR s.channel <> 'preview')",
    ];
    const params: unknown[] = [tenantId, scope.from, scope.to];
    if (scope.hotelSn) {
      where.push('c.hotel_sn = ?');
      params.push(scope.hotelSn);
    }
    if (scope.role) {
      where.push('c.actor_role = ?');
      params.push(scope.role);
    }
    params.push(limit);
    const rows = await this.run(
      `SELECT c.id AS id, c.created_at AS createdAt, c.hotel_sn AS hotelSn, c.actor_role AS actorRole,
              COALESCE(c.ai_agent_id, s.ai_agent_id) AS aiAgentId, c.escalated AS escalated,
              c.agent_id AS agentId, c.status AS status, c.csat_rating AS csatRating,
              c.session_id AS sessionId, s.customer_id AS customerId, s.language AS language
         FROM conversations c
         LEFT JOIN sessions s ON s.id = c.session_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.created_at ASC, c.id ASC
        LIMIT ?`,
      params,
    );
    const out: ConversationRow[] = [];
    for (const r of rows) {
      const id = toNumber(r.id);
      const createdAt = toDate(r.createdAt);
      if (id == null || !createdAt) continue; // not a conversation we can place in time
      out.push({
        id,
        createdAt,
        hotelSn: typeof r.hotelSn === 'string' && r.hotelSn ? r.hotelSn : null,
        actorRole: typeof r.actorRole === 'string' && r.actorRole ? r.actorRole : null,
        aiAgentId: toNumber(r.aiAgentId),
        escalated: toNumber(r.escalated) === 1,
        agentAssigned: toNumber(r.agentId) != null,
        status: typeof r.status === 'string' ? r.status : '',
        csatRating: toNumber(r.csatRating),
        sessionId: toNumber(r.sessionId),
        customerId: toNumber(r.customerId),
        language: typeof r.language === 'string' && r.language ? r.language : null,
      });
    }
    return out;
  }

  /**
   * Per-conversation message counts and answer grounding, aggregated by MySQL. An "answer" is an AI
   * turn whose trace has a NUMERIC `confidence`; `noSource` is an answer that cited nothing.
   */
  async messageStats(ids: number[]): Promise<Map<number, MessageStats>> {
    const out = new Map<number, MessageStats>();
    if (!ids.length) return out;
    const answer =
      "m.sender_type = 'ai' AND JSON_TYPE(JSON_EXTRACT(m.retrieval_trace, '$.confidence')) IN ('DOUBLE', 'INTEGER', 'DECIMAL')";
    const rows = await this.run(
      `SELECT m.conversation_id AS cid, COUNT(*) AS total,
              SUM(m.sender_type = 'user') AS users,
              SUM(m.sender_type = 'ai') AS ai,
              SUM(m.sender_type = 'agent') AS agents,
              SUM(CASE WHEN ${answer} THEN 1 ELSE 0 END) AS answers,
              SUM(CASE WHEN ${answer} THEN CAST(JSON_EXTRACT(m.retrieval_trace, '$.confidence') AS DECIMAL(10, 6)) ELSE 0 END) AS confidenceSum,
              SUM(CASE WHEN ${answer} AND COALESCE(JSON_LENGTH(JSON_EXTRACT(m.retrieval_trace, '$.citations')), 0) = 0 THEN 1 ELSE 0 END) AS noSource
         FROM messages m
        WHERE m.conversation_id IN (?)
        GROUP BY m.conversation_id`,
      [ids],
    );
    for (const r of rows) {
      const cid = toNumber(r.cid);
      if (cid == null) continue;
      out.set(cid, {
        total: toNumber(r.total) ?? 0,
        users: toNumber(r.users) ?? 0,
        ai: toNumber(r.ai) ?? 0,
        agents: toNumber(r.agents) ?? 0,
        answers: toNumber(r.answers) ?? 0,
        confidenceSum: toNumber(r.confidenceSum) ?? 0,
        noSource: toNumber(r.noSource) ?? 0,
      });
    }
    return out;
  }

  /** The closed-vocabulary reasons on system turns: one row per (conversation, reason). */
  async reasons(ids: number[]): Promise<Map<number, ReasonStat[]>> {
    const out = new Map<number, ReasonStat[]>();
    if (!ids.length) return out;
    const rows = await this.run(
      `SELECT m.conversation_id AS cid,
              JSON_UNQUOTE(JSON_EXTRACT(m.retrieval_trace, '$.reason')) AS reason,
              COUNT(*) AS turns, MIN(m.id) AS firstId
         FROM messages m
        WHERE m.conversation_id IN (?) AND m.sender_type = 'system'
          AND JSON_TYPE(JSON_EXTRACT(m.retrieval_trace, '$.reason')) = 'STRING'
        GROUP BY m.conversation_id, reason`,
      [ids],
    );
    for (const r of rows) {
      const cid = toNumber(r.cid);
      const reason = normalizeStoredReason(r.reason);
      if (cid == null || !reason) continue;
      const list = out.get(cid) ?? [];
      // Two spellings of one reason (a legacy word and its closed-vocabulary form) collapse here.
      const existing = list.find((x) => x.reason === reason);
      const turns = toNumber(r.turns) ?? 0;
      const firstId = toNumber(r.firstId) ?? Number.MAX_SAFE_INTEGER;
      if (existing) {
        existing.turns += turns;
        existing.firstId = Math.min(existing.firstId, firstId);
      } else {
        list.push({ reason, turns, firstId });
      }
      out.set(cid, list);
    }
    return out;
  }

  /** Persisted per-turn latency of AI answers (`retrieval_trace.latencyMs`), one sample per turn. */
  async latencies(ids: number[]): Promise<Map<number, LatencySample[]>> {
    const out = new Map<number, LatencySample[]>();
    if (!ids.length) return out;
    const rows = await this.run(
      `SELECT m.conversation_id AS cid,
              JSON_EXTRACT(m.retrieval_trace, '$.latencyMs.total') AS total,
              JSON_EXTRACT(m.retrieval_trace, '$.latencyMs.classify') AS classify,
              JSON_EXTRACT(m.retrieval_trace, '$.latencyMs.retrieve') AS retrieve,
              JSON_EXTRACT(m.retrieval_trace, '$.latencyMs.generate') AS generate,
              JSON_EXTRACT(m.retrieval_trace, '$.latencyMs.moderate') AS moderate
         FROM messages m
        WHERE m.conversation_id IN (?) AND m.sender_type = 'ai'
          AND JSON_TYPE(JSON_EXTRACT(m.retrieval_trace, '$.latencyMs')) = 'OBJECT'`,
      [ids],
    );
    for (const r of rows) {
      const cid = toNumber(r.cid);
      const sample = parseLatencySample(r);
      if (cid == null || !sample) continue;
      const list = out.get(cid) ?? [];
      list.push(sample);
      out.set(cid, list);
    }
    return out;
  }

  /**
   * Moderation decisions that changed or stopped an answer. `moderation_logs` has no read API, so
   * this is the only reader; `delivered` rows (one per AI message) are filtered out in SQL.
   */
  async moderation(tenantId: number, ids: number[]): Promise<Map<number, ModerationStat>> {
    const out = new Map<number, ModerationStat>();
    if (!ids.length) return out;
    const rows = await this.run(
      `SELECT ml.conversation_id AS cid, ml.decision AS decision, COUNT(*) AS n
         FROM moderation_logs ml
        WHERE ml.tenant_id = ? AND ml.conversation_id IN (?) AND ml.decision IN ('blocked', 'edited')
        GROUP BY ml.conversation_id, ml.decision`,
      [tenantId, ids],
    );
    for (const r of rows) {
      const cid = toNumber(r.cid);
      if (cid == null) continue;
      const stat = out.get(cid) ?? emptyModeration();
      const n = toNumber(r.n) ?? 0;
      if (r.decision === 'blocked') stat.blocked += n;
      else if (r.decision === 'edited') stat.edited += n;
      out.set(cid, stat);
    }
    return out;
  }

  /** Partner-data lookups by topic and outcome (`partner_lookup_logs.status`). */
  async partner(tenantId: number, ids: number[]): Promise<Map<number, PartnerStat>> {
    const out = new Map<number, PartnerStat>();
    if (!ids.length) return out;
    const rows = await this.run(
      `SELECT p.conversation_id AS cid, p.topic AS topic, p.status AS status, COUNT(*) AS n
         FROM partner_lookup_logs p
        WHERE p.tenant_id = ? AND p.conversation_id IN (?)
        GROUP BY p.conversation_id, p.topic, p.status`,
      [tenantId, ids],
    );
    for (const r of rows) {
      const cid = toNumber(r.cid);
      if (cid == null) continue;
      const stat = out.get(cid) ?? emptyPartner();
      const n = toNumber(r.n) ?? 0;
      stat.lookups += n;
      switch (r.status) {
        case 'ok': stat.ok += n; break;
        case 'denied': stat.denied += n; break;
        case 'rejected': stat.rejected += n; break;
        case 'error': stat.unavailable += n; break;
        case 'unverified': stat.unverified += n; break;
        default: break;
      }
      // An unverified answer logs the topics it combined ("rates,bookings"): each one is a lookup.
      for (const topic of String(r.topic ?? '').split(',')) {
        const t = topic.trim().slice(0, 24);
        if (t) stat.topics[t] = (stat.topics[t] ?? 0) + n;
      }
      out.set(cid, stat);
    }
    return out;
  }

  /** First escalation alert's reason per conversation — the fallback when no notice stored one. */
  async alertReasons(tenantId: number, ids: number[]): Promise<Map<number, string>> {
    const out = new Map<number, string>();
    if (!ids.length) return out;
    const rows = await this.run(
      `SELECT a.conversation_id AS cid, a.reason AS reason
         FROM agent_alerts a
        WHERE a.tenant_id = ? AND a.conversation_id IN (?)
        ORDER BY a.id ASC`,
      [tenantId, ids],
    );
    for (const r of rows) {
      const cid = toNumber(r.cid);
      if (cid != null && typeof r.reason === 'string' && !out.has(cid)) out.set(cid, r.reason);
    }
    return out;
  }

  /** Every message of the given conversations, oldest first, bodies cut in SQL. For the CSV only. */
  async transcripts(ids: number[]): Promise<Map<number, TranscriptMessage[]>> {
    const out = new Map<number, TranscriptMessage[]>();
    if (!ids.length) return out;
    const rows = await this.run(
      `SELECT m.id AS id, m.conversation_id AS cid, m.sender_type AS senderType,
              LEFT(m.body, ?) AS body,
              CASE WHEN JSON_TYPE(JSON_EXTRACT(m.retrieval_trace, '$.reason')) = 'STRING'
                   THEN JSON_UNQUOTE(JSON_EXTRACT(m.retrieval_trace, '$.reason')) END AS reason,
              CASE WHEN JSON_TYPE(JSON_EXTRACT(m.retrieval_trace, '$.confidence')) IN ('DOUBLE', 'INTEGER', 'DECIMAL')
                   THEN CAST(JSON_EXTRACT(m.retrieval_trace, '$.confidence') AS DECIMAL(10, 6)) END AS confidence
         FROM messages m
        WHERE m.conversation_id IN (?)
        ORDER BY m.conversation_id ASC, m.id ASC`,
      [TRANSCRIPT_BODY_FETCH_CHARS, ids],
    );
    for (const r of rows) {
      const cid = toNumber(r.cid);
      const id = toNumber(r.id);
      if (cid == null || id == null) continue;
      const list = out.get(cid) ?? [];
      list.push({
        id,
        senderType: String(r.senderType ?? ''),
        body: typeof r.body === 'string' ? r.body : '',
        reason: typeof r.reason === 'string' ? r.reason : null,
        confidence: toNumber(r.confidence),
      });
      out.set(cid, list);
    }
    return out;
  }

  /**
   * Hotels that had a conversation in the window — an exact, UNCAPPED distinct list, so adoption stays
   * correct even when the main read hit its row cap.
   */
  async activeHotels(tenantId: number, from: Date, to: Date): Promise<string[]> {
    const rows = await this.run(
      `SELECT c.hotel_sn AS hotelSn
         FROM conversations c
        WHERE c.tenant_id = ? AND c.created_at >= ? AND c.created_at < ? AND c.hotel_sn IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM sessions ps WHERE ps.id = c.session_id AND ps.channel = 'preview')
        GROUP BY c.hotel_sn`,
      [tenantId, from, to],
    );
    return rows.map((r) => r.hotelSn).filter((h): h is string => typeof h === 'string' && h.length > 0);
  }
}
