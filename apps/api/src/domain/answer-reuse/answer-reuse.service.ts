import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Like, Repository } from 'typeorm';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { AnswerReuse, REUSE_SOURCE } from './entity/answer-reuse.entity';
import { AiGatewayService } from '../../infrastructure/external/ai/ai-gateway.service';
import { ReuseQdrantService } from '../../infrastructure/external/vector/reuse-qdrant.service';
import { scrubPii } from '../../global/util/pii-scrub.util';
import { KbCategory } from '../knowledge/entity/kb-category.entity';
import { envNumber } from '../../global/util/env-number.util';

/** What the chat pipeline gets on a hit — shaped to slot in for RagAnswer. */
export interface ReuseHit {
  reuseId: number;
  text: string;
  confidence: number;
  citations: unknown[];
}

// Reuse only on a NEAR-duplicate question: a lower bar answers a different
// product/policy question with someone else's answer (REQ Track C 제약).
const THRESHOLD = () => envNumber('ANSWER_REUSE_THRESHOLD', 0.92);
// Near-identical existing entry → don't store a duplicate.
const DEDUPE_THRESHOLD = 0.95;
// AI answers must be confidently grounded before they are worth replaying.
const MIN_AI_CONFIDENCE = () => envNumber('ANSWER_REUSE_MIN_CONFIDENCE', 0.75);
const TTL_DAYS = () => envNumber('ANSWER_REUSE_TTL_DAYS', 30);
const TENANT_CAP = 2000;
// Confidence reported for replays so they never trip the low-confidence
// escalation: agent answers are human-verified; AI answers carry their own.
const AGENT_REPLAY_CONFIDENCE = 0.95;
const MIN_QUESTION_LEN = 5;
const MIN_ANSWER_LEN = 20;

/**
 * Answer reuse (요구 5·6, PLN-260808 Track C): store verified answers keyed by
 * question embedding; answer a near-duplicate question from the store instead
 * of the LLM. Every public method is fail-open — any error means "no reuse" and
 * the normal RAG+LLM path runs. Only PII-scrubbed text is ever stored, and
 * order-context answers are never stored at all (they are personal by nature).
 * The moderation gate (FR-069) stays downstream of every replay.
 */
@Injectable()
export class AnswerReuseService {
  private readonly logger = new Logger(AnswerReuseService.name);

  constructor(
    @InjectRepository(AnswerReuse) private readonly repo: Repository<AnswerReuse>,
    @InjectRepository(KbCategory) private readonly categoryRepo: Repository<KbCategory>,
    private readonly ai: AiGatewayService,
    private readonly vector: ReuseQdrantService,
  ) {}

  /**
   * Does this tenant restrict any category to specific agents?
   *
   * The answer decides what happens to rows written before agents were
   * recorded. Replaying them freely would leak one persona's answers from the
   * day scoping is switched on; refusing them outright would silently disable
   * reuse for every tenant that never scopes anything. Tying it to whether the
   * tenant actually scopes something leaves the second group untouched, and
   * costs the first group replays only until new rows accumulate.
   *
   * Deliberately uncached. A minute of staleness here is a minute of replaying
   * one persona's answers to another after an operator has just said not to,
   * and the query is one indexed read against a table that peaks in the dozens
   * — next to the embedding call this lookup already makes, it is free.
   */
  private async tenantScopesKnowledge(tenantId: number): Promise<boolean> {
    const rows = await this.categoryRepo.find({ where: { tenantId } });
    return rows.some((r) => (r.agentIds ?? []).length > 0);
  }

  private async replayableFor(
    row: AnswerReuse,
    tenantId: number,
    aiAgentId: number | null,
  ): Promise<boolean> {
    const rowAgent = row.aiAgentId != null ? Number(row.aiAgentId) : null;
    if (rowAgent != null) return aiAgentId != null && rowAgent === aiAgentId;
    return !(await this.tenantScopesKnowledge(tenantId));
  }

  private enabled(): boolean {
    return process.env.ANSWER_REUSE_ENABLED !== '0' && this.vector.enabled;
  }

  /** Look up a reusable answer for a (scrubbed) question. Null = run the LLM. */
  async lookup(
    tenantId: number,
    lang: string,
    question: string,
    aiAgentId: number | null = null,
  ): Promise<ReuseHit | null> {
    if (!this.enabled()) return null;
    try {
      const embedded = await this.ai.embed([question], 'query');
      // Stub pseudo-vectors score on a different scale — similarity there is
      // noise, and replaying on noise serves wrong answers. Real engine only.
      if (embedded.provider === 'stub') return null;
      const hits = await this.vector.search(tenantId, lang, embedded.vectors[0], 1);
      const top = hits[0];
      if (!top || top.score < THRESHOLD()) return null;
      const row = await this.repo.findOne({ where: { id: top.id, tenantId } });
      if (!row || row.active !== 1) return null;
      // Per-agent knowledge scope reaches here too (REQ-260826 D4): this lookup
      // runs BEFORE retrieval, so a scope applied only to RAG would be bypassed
      // by every question that had been asked once already.
      if (!(await this.replayableFor(row, tenantId, aiAgentId))) return null;
      // Stale entries retire at read time (knowledge moves on — REQ Track C).
      const ageMs = Date.now() - new Date(row.updatedAt).getTime();
      if (ageMs > TTL_DAYS() * 24 * 60 * 60_000) {
        await this.deactivate(row.id, tenantId).catch(() => undefined);
        return null;
      }
      return {
        reuseId: row.id,
        text: row.answerText,
        confidence:
          row.source === REUSE_SOURCE.AGENT
            ? AGENT_REPLAY_CONFIDENCE
            : row.confidence ?? AGENT_REPLAY_CONFIDENCE,
        citations: row.citations ?? [],
      };
    } catch (e) {
      this.logger.debug(`reuse lookup skipped: ${(e as Error).message}`);
      return null;
    }
  }

  /** A replay was delivered — count it (fire-and-forget from the chat path). */
  async recordHit(reuseId: number): Promise<void> {
    try {
      await this.repo.increment({ id: reuseId }, 'hitCount', 1);
      await this.repo.update({ id: reuseId }, { lastHitAt: new Date() });
    } catch (e) {
      this.logger.debug(`reuse hit count failed: ${(e as Error).message}`);
    }
  }

  /** Deactivate an entry (moderation blocked a replay, TTL expiry, console off). */
  async deactivate(reuseId: number, tenantId: number): Promise<void> {
    await this.repo.update({ id: reuseId, tenantId }, { active: 0 });
    await this.vector.setActive(reuseId, false).catch(() => undefined);
  }

  /**
   * Store a delivered AI answer as a reuse candidate (D-C1: cited + confident
   * only). Fire-and-forget from the chat path — never throws.
   */
  async recordAiAnswer(input: {
    tenantId: number;
    lang: string;
    question: string;
    answerText: string;
    confidence: number;
    citations: unknown[];
    sourceMessageId: number | null;
    needsOrderData: boolean;
    aiAgentId?: number | null;
  }): Promise<void> {
    try {
      if (!this.enabled()) return;
      // Order-grounded answers are personal (their order status/items) — never reusable.
      if (input.needsOrderData) return;
      if (input.confidence < MIN_AI_CONFIDENCE()) return;
      if (!input.citations?.length) return;
      await this.store({
        ...input,
        source: REUSE_SOURCE.AI,
        confidence: input.confidence,
      });
    } catch (e) {
      this.logger.debug(`reuse ai-ingest skipped: ${(e as Error).message}`);
    }
  }

  /**
   * Store an agent's (already moderated) reply paired with the question it
   * answered — human-verified, the highest-trust source (D-C1).
   */
  async recordAgentAnswer(input: {
    tenantId: number;
    lang: string;
    question: string;
    answerText: string;
    sourceMessageId: number | null;
    aiAgentId?: number | null;
  }): Promise<void> {
    try {
      if (!this.enabled()) return;
      await this.store({
        ...input,
        source: REUSE_SOURCE.AGENT,
        confidence: null,
        citations: [],
      });
    } catch (e) {
      this.logger.debug(`reuse agent-ingest skipped: ${(e as Error).message}`);
    }
  }

  /**
   * DSAR erasure hook (privacy): drop reuse entries derived from the erased
   * person's messages — row and vector point both.
   */
  async eraseByMessageIds(tenantId: number, messageIds: number[]): Promise<void> {
    if (!messageIds.length) return;
    const rows = await this.repo.find({
      where: { tenantId, sourceMessageId: In(messageIds) },
      select: ['id'],
    });
    if (!rows.length) return;
    const ids = rows.map((r) => Number(r.id));
    await this.repo.delete({ tenantId, sourceMessageId: In(messageIds) });
    await this.vector.delete(ids).catch(() => undefined);
    this.logger.log(`erased ${ids.length} reuse entr(ies) for tenant=${tenantId} (DSAR)`);
  }

  /* ---------------- console management (PR-C2, D-C3) ---------------- */

  /** Paginated tenant-scoped list for the console; optional text search / active filter. */
  async list(
    tenantId: number,
    page: number,
    size: number,
    q?: string,
    activeOnly?: boolean,
  ): Promise<{ items: AnswerReuse[]; total: number }> {
    const where = {
      tenantId,
      ...(activeOnly ? { active: 1 } : {}),
      ...(q?.trim() ? { questionText: Like(`%${q.trim()}%`) } : {}),
    };
    const [items, total] = await this.repo.findAndCount({
      where,
      order: { hitCount: 'DESC', id: 'DESC' },
      skip: (page - 1) * size,
      take: size,
    });
    return { items, total };
  }

  /** Console edit (D-C3): answer text and/or active toggle. Tenant-scoped. */
  async update(
    tenantId: number,
    id: number,
    patch: { answerText?: string; active?: boolean },
  ): Promise<AnswerReuse> {
    const row = await this.repo.findOne({ where: { id, tenantId } });
    if (!row) {
      this.logger.warn(`reuse update rejected: id=${id} not in tenant=${tenantId}`);
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    if (patch.answerText !== undefined) {
      const text = scrubPii(patch.answerText).text.trim();
      if (text.length < MIN_ANSWER_LEN) {
        throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
      }
      row.answerText = text;
      // An operator-edited answer is human-verified now — treat it as such.
      row.source = REUSE_SOURCE.AGENT;
    }
    if (patch.active !== undefined) {
      row.active = patch.active ? 1 : 0;
      await this.vector.setActive(Number(row.id), patch.active).catch(() => undefined);
    }
    return this.repo.save(row);
  }

  /** Console delete: row + vector point. Tenant-scoped. */
  async remove(tenantId: number, id: number): Promise<void> {
    const row = await this.repo.findOne({ where: { id, tenantId } });
    if (!row) {
      this.logger.warn(`reuse delete rejected: id=${id} not in tenant=${tenantId}`);
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    await this.repo.delete({ id, tenantId });
    await this.vector.delete([Number(id)]).catch(() => undefined);
  }

  /** Bulk off-switch (e.g. after a KB overhaul made stored answers stale). */
  async deactivateAll(tenantId: number): Promise<number> {
    const res = await this.repo.update({ tenantId, active: 1 }, { active: 0 });
    await this.vector.setActiveByTenant(tenantId, false).catch(() => undefined);
    return res.affected ?? 0;
  }

  private async store(input: {
    tenantId: number;
    lang: string;
    question: string;
    answerText: string;
    source: string;
    confidence: number | null;
    citations: unknown[];
    sourceMessageId: number | null;
    aiAgentId?: number | null;
  }): Promise<void> {
    // Both sides stored scrubbed only — the question may arrive scrubbed already
    // (chat egress) but the agent path passes the original; scrub is idempotent.
    const question = scrubPii(input.question).text.trim().slice(0, 500);
    const answer = scrubPii(input.answerText).text.trim();
    if (question.length < MIN_QUESTION_LEN || answer.length < MIN_ANSWER_LEN) return;

    // 'query', not 'document' — this store matches questions against questions,
    // and Voyage returns a different vector per input_type. Embedding one side
    // as a document put the two in different spaces: the same sentence scored
    // 0.61 against itself, so nothing ever cleared THRESHOLD and the store
    // never replayed once (FIX-260813).
    const embedded = await this.ai.embed([question], 'query');
    if (embedded.provider === 'stub') return;
    const vector = embedded.vectors[0];

    // Near-duplicate already stored → keep the original (first answer wins;
    // the console is the editing surface), no second row. Dedupe stays blind to
    // the agent: a second agent asking the same question simply keeps using the
    // LLM rather than getting a row of its own. Costlier, never wrong — the
    // alternative is a near-duplicate row per persona.
    const dupes = await this.vector.search(input.tenantId, input.lang, vector, 1);
    if (dupes[0] && dupes[0].score >= DEDUPE_THRESHOLD) return;

    const count = await this.repo.count({ where: { tenantId: input.tenantId } });
    if (count >= TENANT_CAP) {
      this.logger.warn(`reuse store skipped: tenant ${input.tenantId} at cap ${TENANT_CAP}`);
      return;
    }

    const row = await this.repo.save(
      this.repo.create({
        tenantId: input.tenantId,
        lang: input.lang,
        aiAgentId: input.aiAgentId ?? null,
        questionText: question,
        answerText: answer,
        source: input.source,
        sourceMessageId: input.sourceMessageId,
        confidence: input.confidence,
        citations: input.citations?.length ? input.citations : null,
        active: 1,
      }),
    );
    await this.vector.upsert(Number(row.id), vector, {
      tenant_id: input.tenantId,
      lang: input.lang,
      active: true,
    });
  }

  /**
   * Re-embed every stored question and overwrite its vector.
   *
   * Needed whenever the embedding changes shape — the FIX-260813 input_type
   * correction being the first case: rows written before it still carry
   * 'document' vectors that can never match a 'query' lookup. Also the recovery
   * path if the embedding model is ever swapped.
   *
   * Sequential on purpose: the embedding provider's free tier rate-limits, and
   * a reindex is rare enough that speed does not matter.
   */
  async reindex(tenantId: number): Promise<{ total: number; reindexed: number; failed: number }> {
    const rows = await this.repo.find({ where: { tenantId } });
    let reindexed = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const embedded = await this.ai.embed([row.questionText], 'query');
        if (embedded.provider === 'stub') {
          failed++;
          continue;
        }
        await this.vector.upsert(Number(row.id), embedded.vectors[0], {
          tenant_id: tenantId,
          lang: row.lang,
          active: row.active === 1,
        });
        reindexed++;
      } catch (e) {
        // One bad row must not abandon the rest — report the count instead.
        this.logger.warn(`reuse reindex failed for row ${row.id}: ${(e as Error).message}`);
        failed++;
      }
    }
    this.logger.log(`reuse reindex tenant ${tenantId}: ${reindexed}/${rows.length} ok, ${failed} failed`);
    return { total: rows.length, reindexed, failed };
  }
}
