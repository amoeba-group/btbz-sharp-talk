import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Repository } from 'typeorm';
import { SENDER_TYPE } from '@sharptalk/types';
import { Message } from '../chat/entity/message.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { KbDocument } from '../knowledge/entity/kb-document.entity';
import { QuestionStatDaily, STAT_DIMENSION } from './entity/question-stat-daily.entity';
import { QuestionCluster } from './entity/question-cluster.entity';
import { AiGatewayService } from '../../infrastructure/external/ai/ai-gateway.service';
import { scrubPii } from '../../global/util/pii-scrub.util';
import { extractKeywords } from './keyword.util';
import { toDateKey, utcDayBounds } from '../../global/util/date-range.util';
import { isCliContext } from '../../global/util/cli-context.util';

/** First run fires shortly after boot so restarts can't starve the snapshot. */
const INITIAL_DELAY_MS = 10 * 60_000;
/** Cosine similarity at or above which a question joins an existing cluster. */
const CLUSTER_THRESHOLD = 0.8;
/** Cap on new clusters per run — a burst of one-off questions must not explode the table. */
const MAX_NEW_CLUSTERS_PER_RUN = 50;
/** Embedding batch size, matching the KB reindex batching that fixed Voyage 429s. */
const EMBED_BATCH = 64;
/** Labels are aggregate descriptions, never a place to accumulate customer text. */
const LABEL_MAX = 200;

interface QuestionRow {
  id: number;
  tenantId: number;
  body: string;
  lang: string | null;
  intent: string | null;
  conversationId: number;
}

/** Per-dimension accumulator: counts plus a running confidence mean. */
interface Bucket {
  label: string | null;
  asked: number;
  escalated: number;
  noSource: number;
  confidenceSum: number;
  confidenceCount: number;
}

export interface AggregateResult {
  statDate: string;
  questions: number;
  rows: number;
  clustersCreated: number;
}

/**
 * Daily question statistics (PLN S3). Aggregates the previous day's customer
 * questions along four lenses — intent, cited document/category, keyword and
 * similar-question cluster — into question_stats_daily.
 *
 * Snapshots rather than live aggregation because the retention purge
 * hard-deletes conversations at 365 days: statistics computed from raw messages
 * would lose their own history the moment the purge ran.
 */
@Injectable()
export class QuestionStatsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QuestionStatsService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private initialTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(KbDocument) private readonly kbRepo: Repository<KbDocument>,
    @InjectRepository(QuestionStatDaily) private readonly statRepo: Repository<QuestionStatDaily>,
    @InjectRepository(QuestionCluster) private readonly clusterRepo: Repository<QuestionCluster>,
    private readonly ai: AiGatewayService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    // A one-off CLI must not run a second copy of this scheduler (PLN-261008 D2).
    if (isCliContext()) return;
    const hours = Number(this.config.get<string | number>('QUESTION_STATS_INTERVAL_HOURS', 24));
    if (!Number.isFinite(hours) || hours <= 0) {
      this.logger.log('Question stats scheduler disabled (QUESTION_STATS_INTERVAL_HOURS <= 0)');
      return;
    }
    this.initialTimer = setTimeout(() => void this.runScheduled(), INITIAL_DELAY_MS);
    this.timer = setInterval(() => void this.runScheduled(), hours * 3_600_000);
    this.logger.log(`Question stats scheduled every ${hours}h (first run in 10 min)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
  }

  private async runScheduled(): Promise<void> {
    try {
      for (const date of await this.daysToAggregate()) {
        const r = await this.aggregateDay(date);
        this.logger.log(
          `Question stats ${r.statDate}: questions=${r.questions} rows=${r.rows} newClusters=${r.clustersCreated}`,
        );
      }
    } catch (err) {
      this.logger.error(`Question stats run failed: ${String(err)}`);
    }
  }

  /**
   * Yesterday, plus any recent day this run can see is missing.
   *
   * The interval is anchored to boot, so a restart shifts its phase and a
   * container that is down when its turn comes leaves that day empty for good —
   * the run only ever asked for yesterday and never looked back. Days with no
   * questions legitimately have no rows, so "missing" is decided by whether the
   * messages exist, not by whether the snapshot does.
   */
  private async daysToAggregate(): Promise<string[]> {
    const lookback = Math.max(
      1,
      Number(this.config.get<string | number>('QUESTION_STATS_BACKFILL_DAYS', 7)) || 7,
    );
    const candidates: string[] = [];
    for (let back = lookback; back >= 1; back--) {
      candidates.push(toDateKey(new Date(Date.now() - back * 86_400_000)));
    }

    const covered = new Set(
      (
        await this.statRepo
          .createQueryBuilder('s')
          .select('DISTINCT s.stat_date', 'statDate')
          .where('s.stat_date IN (:...dates)', { dates: candidates })
          .getRawMany<{ statDate: string | Date }>()
      ).map((r) => (r.statDate instanceof Date ? toDateKey(r.statDate) : String(r.statDate).slice(0, 10))),
    );

    const asked = new Set(
      (
        await this.msgRepo
          .createQueryBuilder('m')
          .select('DATE(m.created_at)', 'day')
          .where('m.sender_type = :user', { user: SENDER_TYPE.USER })
          .andWhere('m.created_at >= :from', {
            from: new Date(Date.now() - (lookback + 1) * 86_400_000),
          })
          .groupBy('DATE(m.created_at)')
          .getRawMany<{ day: string | Date }>()
      ).map((r) => (r.day instanceof Date ? toDateKey(r.day) : String(r.day).slice(0, 10))),
    );

    // Yesterday always runs: it is the normal job, and re-running is an upsert.
    const yesterday = candidates[candidates.length - 1];
    const due = candidates.filter((d) => d === yesterday || (!covered.has(d) && asked.has(d)));
    if (due.length > 1) {
      this.logger.warn(
        `Question stats filling ${due.length - 1} missed day(s): ${due.filter((d) => d !== yesterday).join(', ')}`,
      );
    }
    return due;
  }

  /**
   * Aggregate one day across every tenant. Safe to re-run: rows are upserted on
   * (tenant, date, dimension, key), so a retry or a manual backfill overwrites
   * rather than double-counting.
   */
  async aggregateDay(statDate: string): Promise<AggregateResult> {
    // UTC day boundaries: the stat key must mean the same window wherever the
    // process runs, and the connection binds dates as UTC.
    const { start: dayStart, end: dayEnd } = utcDayBounds(statDate);

    const questions = await this.loadQuestions(dayStart, dayEnd);
    if (questions.length === 0) {
      return { statDate, questions: 0, rows: 0, clustersCreated: 0 };
    }

    // Escalation and citations are properties of the conversation and the AI
    // reply, not of the question itself, so both are resolved once up front.
    const escalatedConvs = await this.escalatedConversations(questions.map((q) => q.conversationId));
    const answers = await this.answerTraces(questions.map((q) => q.conversationId));

    const byTenant = new Map<number, QuestionRow[]>();
    for (const q of questions) {
      const list = byTenant.get(q.tenantId) ?? [];
      list.push(q);
      byTenant.set(q.tenantId, list);
    }

    let rows = 0;
    let clustersCreated = 0;
    for (const [tenantId, tenantQuestions] of byTenant) {
      const buckets = new Map<string, Bucket>();
      const add = (
        dimension: string,
        key: string,
        label: string | null,
        q: QuestionRow,
      ): void => {
        const mapKey = `${dimension} ${key}`;
        const b = buckets.get(mapKey) ?? {
          label,
          asked: 0,
          escalated: 0,
          noSource: 0,
          confidenceSum: 0,
          confidenceCount: 0,
        };
        b.asked += 1;
        if (escalatedConvs.has(q.conversationId)) b.escalated += 1;
        const answer = answers.get(q.conversationId);
        if (answer) {
          if (answer.citations.length === 0) b.noSource += 1;
          if (answer.confidence != null) {
            b.confidenceSum += answer.confidence;
            b.confidenceCount += 1;
          }
        }
        buckets.set(mapKey, b);
      };

      const docTitles = await this.documentTitles(
        tenantQuestions.flatMap((q) => answers.get(q.conversationId)?.citations ?? []),
      );

      for (const q of tenantQuestions) {
        // A1 — intent label, persisted by the chat turn that classified it.
        if (q.intent) add(STAT_DIMENSION.INTENT, q.intent, q.intent, q);

        // A2 — the knowledge that actually answered it. Needs no new
        // collection: retrieval_trace has carried citations since the RAG work.
        const trace = answers.get(q.conversationId);
        for (const docId of new Set(trace?.citations ?? [])) {
          const meta = docTitles.get(docId);
          add(STAT_DIMENSION.DOCUMENT, String(docId), meta?.title ?? `#${docId}`, q);
          if (meta?.category) add(STAT_DIMENSION.CATEGORY, meta.category, meta.category, q);
        }

        // A3 — keywords.
        for (const kw of extractKeywords(q.body, q.lang)) {
          add(STAT_DIMENSION.KEYWORD, kw, kw, q);
        }
      }

      // A4 — similar-question clusters (embeddings, so it runs per tenant).
      const clustered = await this.assignClusters(tenantId, tenantQuestions);
      clustersCreated += clustered.created;
      for (const [questionId, cluster] of clustered.assignments) {
        const q = tenantQuestions.find((t) => t.id === questionId);
        if (q) add(STAT_DIMENSION.CLUSTER, String(cluster.id), cluster.label, q);
      }

      rows += await this.upsert(tenantId, statDate, buckets);
    }

    return { statDate, questions: questions.length, rows, clustersCreated };
  }

  /** Backfill a closed date range, oldest first. Used once after deploy. */
  async backfill(from: string, to: string): Promise<AggregateResult[]> {
    const results: AggregateResult[] = [];
    for (let d = utcDayBounds(from).start; toDateKey(d) <= to; d.setUTCDate(d.getUTCDate() + 1)) {
      results.push(await this.aggregateDay(toDateKey(d)));
    }
    return results;
  }

  private async loadQuestions(dayStart: Date, dayEnd: Date): Promise<QuestionRow[]> {
    const rows = await this.msgRepo.find({
      where: { senderType: SENDER_TYPE.USER, createdAt: Between(dayStart, dayEnd) },
      order: { id: 'ASC' },
    });
    // A null tenant_id cannot be attributed to anyone, so it is skipped rather
    // than silently folded into another tenant's numbers.
    return rows
      .filter((m) => m.tenantId != null)
      .map((m) => ({
        id: m.id,
        tenantId: m.tenantId as number,
        body: m.body,
        lang: m.lang,
        intent: m.intent,
        conversationId: m.conversationId,
      }));
  }

  private async escalatedConversations(ids: number[]): Promise<Set<number>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Set();
    const rows = await this.convRepo.find({
      where: { id: In(unique), escalated: 1 },
      select: ['id'],
    });
    return new Set(rows.map((r) => Number(r.id)));
  }

  /** conversation id → the cited document ids and confidence of its AI replies. */
  private async answerTraces(
    ids: number[],
  ): Promise<Map<number, { citations: number[]; confidence: number | null }>> {
    const unique = [...new Set(ids)];
    const out = new Map<number, { citations: number[]; confidence: number | null }>();
    if (unique.length === 0) return out;

    const rows = await this.msgRepo.find({
      where: { conversationId: In(unique), senderType: SENDER_TYPE.AI },
      order: { id: 'ASC' },
    });
    for (const m of rows) {
      const trace = m.retrievalTrace as
        | { citations?: Array<{ id?: unknown }>; confidence?: unknown }
        | null;
      if (!trace || typeof trace !== 'object') continue;
      const citations = Array.isArray(trace.citations)
        ? trace.citations.map((c) => Number(c?.id)).filter((n) => Number.isFinite(n))
        : [];
      const confidence = typeof trace.confidence === 'number' ? trace.confidence : null;
      out.set(Number(m.conversationId), { citations, confidence });
    }
    return out;
  }

  private async documentTitles(
    ids: number[],
  ): Promise<Map<number, { title: string; category: string | null }>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const docs = await this.kbRepo.find({
      where: { id: In(unique) },
      select: ['id', 'title', 'category'],
    });
    return new Map(docs.map((d) => [Number(d.id), { title: d.title, category: d.category }]));
  }

  /**
   * Assign each question to a similar-question cluster, creating one when
   * nothing is close enough. Centroids persist, so a day's work is a nearest-
   * neighbour pass rather than a re-clustering of the whole history.
   *
   * Embedding failures degrade to "no cluster lens for this run" — the other
   * three lenses must still produce a snapshot.
   */
  private async assignClusters(
    tenantId: number,
    questions: QuestionRow[],
  ): Promise<{ assignments: Map<number, QuestionCluster>; created: number }> {
    const assignments = new Map<number, QuestionCluster>();
    let created = 0;
    let vectors: number[][];
    try {
      vectors = await this.embedAll(questions.map((q) => q.body));
    } catch (err) {
      this.logger.warn(`cluster embedding failed for tenant ${tenantId}: ${String(err)}`);
      return { assignments, created };
    }

    const clusters = await this.clusterRepo.find({ where: { tenantId } });
    for (let i = 0; i < questions.length; i++) {
      const vector = vectors[i];
      if (!vector) continue;

      let best: QuestionCluster | null = null;
      let bestScore = 0;
      for (const c of clusters) {
        if (!c.centroid) continue;
        const score = cosine(vector, c.centroid);
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }

      if (best && bestScore >= CLUSTER_THRESHOLD) {
        best.centroid = mergeCentroid(best.centroid!, vector, best.size);
        best.size += 1;
        await this.clusterRepo.save(best);
        assignments.set(questions[i].id, best);
      } else if (created < MAX_NEW_CLUSTERS_PER_RUN) {
        const fresh = await this.clusterRepo.save(
          this.clusterRepo.create({
            tenantId,
            label: this.safeLabel(questions[i].body),
            centroid: vector,
            size: 1,
          }),
        );
        clusters.push(fresh);
        assignments.set(questions[i].id, fresh);
        created += 1;
      }
    }
    return { assignments, created };
  }

  /**
   * Embed the day's questions in batches.
   *
   * When a real key is configured, a stub-provider result is treated as a
   * FAILURE rather than accepted: the gateway degrades to the deterministic
   * stub on any provider error (a 429 is enough), and stub vectors share no
   * space with real ones. Accepting them would seed permanent centroids that
   * nothing ever matches — the same way a stub fallback once corrupted the
   * knowledge index (see KnowledgeService.embedOnce). Skipping the cluster lens
   * for one run is recoverable; a polluted cluster table is not.
   */
  private async embedAll(texts: string[]): Promise<number[][]> {
    const realKeySet = !!process.env.VOYAGE_API_KEY;
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH) {
      const batch = texts.slice(i, i + EMBED_BATCH).map((t) => scrubPii(t).text);
      const res = await this.ai.embed(batch, 'query');
      if (realKeySet && res.provider === 'stub') {
        throw new Error('embedder degraded to stub while VOYAGE_API_KEY is set');
      }
      out.push(...res.vectors);
    }
    return out;
  }

  /**
   * A cluster label is a real customer sentence, so it is scrubbed and clipped
   * before it goes anywhere near a table that outlives the retention purge.
   */
  private safeLabel(text: string): string {
    return scrubPii(text).text.replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
  }

  /** Upsert the day's buckets; re-running a date overwrites rather than doubles. */
  private async upsert(
    tenantId: number,
    statDate: string,
    buckets: Map<string, Bucket>,
  ): Promise<number> {
    const rows = [...buckets.entries()].map(([mapKey, b]) => {
      const [dimension, dimKey] = mapKey.split(' ');
      return {
        tenantId,
        statDate,
        dimension,
        dimKey: dimKey.slice(0, 128),
        dimLabel: b.label ? this.safeLabel(b.label).slice(0, 255) : null,
        asked: b.asked,
        escalated: b.escalated,
        noSource: b.noSource,
        avgConfidence: b.confidenceCount > 0 ? b.confidenceSum / b.confidenceCount : null,
      };
    });
    if (rows.length === 0) return 0;

    await this.statRepo.upsert(rows, {
      conflictPaths: ['tenantId', 'statDate', 'dimension', 'dimKey'],
      skipUpdateIfNoValuesChanged: false,
    });
    return rows.length;
  }
}

/** Cosine similarity. Voyage vectors are normalized, but clusters may hold merged means. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Running mean: centroid moves by 1/(n+1) toward the new member. */
export function mergeCentroid(centroid: number[], vector: number[], size: number): number[] {
  const n = Math.max(size, 1);
  return centroid.map((v, i) => (v * n + (vector[i] ?? 0)) / (n + 1));
}
