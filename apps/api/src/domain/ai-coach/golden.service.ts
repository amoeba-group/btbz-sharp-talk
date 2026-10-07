import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { AiConfigService } from '../ai-engine/ai-config.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { GoldenQuestion } from './entity/golden-question.entity';
import { GOLDEN_RUN_KIND, GoldenRun, GoldenRunItem, GoldenRunKind } from './entity/golden-run.entity';
import { gradeAnswer, parseBulkLines, sanitizeChecks } from './golden-grade.util';

/**
 * Per-run cap. Every question costs a retrieval (embedding) plus a completion,
 * and the embedding provider's free tier has already been rate-limited in
 * production use — so the set is bounded and run sequentially.
 */
/**
 * Per-run cap. Raised 20 → 60 for graded FAQ sets (PLN-261007 R7: go2joy's
 * partner FAQ is 44 questions); runs stay sequential.
 */
export const GOLDEN_MAX_QUESTIONS = 60;

export interface CompareItem {
  question: string;
  base: { answer: string; confidence: number | null; citations: string[]; blocked: boolean } | null;
  target: { answer: string; confidence: number | null; citations: string[]; blocked: boolean } | null;
  confidenceDelta: number | null;
  lengthDelta: number | null;
  citationsChanged: boolean;
  textChanged: boolean;
  /** Verdicts on each side (null = not graded) and whether it regressed (pass → fail). */
  baseVerdict: string | null;
  targetVerdict: string | null;
  regressed: boolean;
  improved: boolean;
  targetFailedChecks: string[];
}

/**
 * Golden-question regression (FR-073).
 *
 * Deliberately reports facts and renders no verdict. The model rewords the same
 * answer on every call, so "the text changed" is not evidence that a config
 * change worked — calling a diff a regression without knowing the natural
 * variance would just manufacture false alarms (TCR-260813 §3 O-1). The `noise`
 * run kind exists so a human can measure that variance when they need to.
 */
@Injectable()
export class GoldenService {
  private readonly logger = new Logger(GoldenService.name);

  constructor(
    @InjectRepository(GoldenQuestion) private readonly questionRepo: Repository<GoldenQuestion>,
    @InjectRepository(GoldenRun) private readonly runRepo: Repository<GoldenRun>,
    @InjectRepository(GoldenRunItem) private readonly itemRepo: Repository<GoldenRunItem>,
    private readonly aiConfig: AiConfigService,
    private readonly knowledge: KnowledgeService,
  ) {}

  // ---- question set ----

  async listQuestions(tenantId: number): Promise<GoldenQuestion[]> {
    return this.questionRepo.find({ where: { tenantId }, order: { id: 'ASC' } });
  }

  async addQuestion(
    tenantId: number,
    userId: number,
    input: { question: string; language?: string; note?: string; expected?: unknown; forbidden?: unknown },
  ): Promise<GoldenQuestion> {
    return this.questionRepo.save(
      this.questionRepo.create({
        tenantId,
        question: input.question.trim(),
        language: (input.language ?? 'KO').toUpperCase(),
        note: input.note?.trim() || null,
        expected: sanitizeChecks(input.expected),
        forbidden: sanitizeChecks(input.forbidden),
        active: 1,
        createdBy: userId,
      }),
    );
  }

  /**
   * Paste many questions at once (PLN-261007 R7 S4):
   * `question<TAB>fact1|fact2<TAB>forbidden…` per line. A question whose text
   * already exists only gets its facts updated — re-pasting the set after
   * editing the facts must not double it.
   */
  async bulkImport(
    tenantId: number,
    userId: number,
    input: { text: string; language?: string },
  ): Promise<{ created: number; updated: number; skipped: number }> {
    const rows = parseBulkLines(input.text);
    const existing = await this.questionRepo.find({ where: { tenantId } });
    const byText = new Map(existing.map((q) => [q.question.trim(), q] as const));
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let total = existing.length;
    const language = (input.language ?? 'KO').toUpperCase();
    for (const r of rows) {
      const hit = byText.get(r.question);
      if (hit) {
        hit.expected = r.expected;
        hit.forbidden = r.forbidden;
        hit.language = language;
        await this.questionRepo.save(hit);
        updated++;
        continue;
      }
      if (total >= GOLDEN_MAX_QUESTIONS) {
        skipped++;
        continue;
      }
      const saved = await this.addQuestion(tenantId, userId, {
        question: r.question,
        language,
        expected: r.expected,
        forbidden: r.forbidden,
      });
      byText.set(saved.question.trim(), saved);
      created++;
      total++;
    }
    return { created, updated, skipped };
  }

  async updateQuestion(
    tenantId: number,
    id: number,
    input: {
      question?: string;
      language?: string;
      note?: string | null;
      active?: number;
      expected?: unknown;
      forbidden?: unknown;
    },
  ): Promise<GoldenQuestion> {
    const row = await this.questionRepo.findOne({ where: { id, tenantId } });
    if (!row) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    if (input.question !== undefined) row.question = input.question.trim();
    if (input.language !== undefined) row.language = input.language.toUpperCase();
    if (input.note !== undefined) row.note = input.note?.trim() || null;
    if (input.active !== undefined) row.active = input.active ? 1 : 0;
    if (input.expected !== undefined) row.expected = sanitizeChecks(input.expected);
    if (input.forbidden !== undefined) row.forbidden = sanitizeChecks(input.forbidden);
    return this.questionRepo.save(row);
  }

  async removeQuestion(tenantId: number, id: number): Promise<void> {
    const row = await this.questionRepo.findOne({ where: { id, tenantId } });
    if (!row) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    await this.questionRepo.delete({ id, tenantId });
  }

  // ---- runs ----

  /**
   * Fingerprint of everything that shapes an answer's wording. Two runs sharing
   * it are measuring variance; two runs differing are measuring a change.
   */
  async configHash(tenantId: number): Promise<string> {
    const cfg = await this.aiConfig.getConfig(tenantId);
    const material = JSON.stringify({
      persona: cfg.persona,
      rules: cfg.rules,
      scenarioOverrides: cfg.scenarioOverrides ?? {},
    });
    return createHash('sha256').update(material).digest('hex').slice(0, 32);
  }

  /**
   * Ask every active question on the current config and record the answers.
   * Runs sequentially: the point is a faithful reading, and hammering the
   * embedding provider in parallel is how the free tier starts returning 429s.
   */
  async run(
    tenantId: number,
    userId: number,
    kind: GoldenRunKind,
    opts: { label?: string; proposalId?: number; aiAgentId?: number | null; background?: boolean } = {},
  ): Promise<GoldenRun> {
    const all = await this.questionRepo.find({
      where: { tenantId, active: 1 },
      order: { id: 'ASC' },
    });
    if (!all.length) {
      throw new BusinessException(ERROR_CODE.GOLDEN_SET_EMPTY, HttpStatus.BAD_REQUEST);
    }
    const questions = all.slice(0, GOLDEN_MAX_QUESTIONS);
    const truncated = all.length > questions.length;
    if (truncated) {
      // Silent truncation would read as "we checked everything" when we did not.
      this.logger.warn(
        `golden run: tenant ${tenantId} has ${all.length} active questions; running the first ${GOLDEN_MAX_QUESTIONS}`,
      );
    }

    const run = await this.runRepo.save(
      this.runRepo.create({
        tenantId,
        kind,
        label: opts.label?.slice(0, 120) ?? null,
        proposalId: opts.proposalId ?? null,
        configHash: await this.configHash(tenantId),
        questionCount: questions.length,
        truncated: truncated ? 1 : 0,
        status: 'running',
        createdBy: userId,
        aiAgentId: opts.aiAgentId ?? null,
      }),
    );

    // A console run of up to 60 questions takes minutes — longer than the
    // proxy keeps a request open. It returns the 'running' row at once and the
    // screen polls (PLN-261007 R7). The coaching flow still awaits its runs.
    if (opts.background) {
      void this.execute(tenantId, run, questions).catch((e) =>
        this.logger.warn(`golden run ${run.id} aborted: ${(e as Error).message}`),
      );
      return run;
    }
    return this.execute(tenantId, run, questions);
  }

  /** Ask, grade and record every question of a run, then close it. */
  private async execute(tenantId: number, run: GoldenRun, questions: GoldenQuestion[]): Promise<GoldenRun> {
    let pass = 0;
    let fail = 0;
    for (const q of questions) {
      try {
        const res = await this.knowledge.ask(tenantId, q.question, q.language, undefined, run.aiAgentId ?? null);
        const grade = res.blocked
          ? { verdict: q.expected?.length ? ('fail' as const) : null, failedChecks: q.expected?.length ? ['blocked'] : [] }
          : gradeAnswer(res.answer, q.expected, q.forbidden);
        if (grade.verdict === 'pass') pass++;
        if (grade.verdict === 'fail') fail++;
        await this.itemRepo.save(
          this.itemRepo.create({
            tenantId,
            runId: Number(run.id),
            questionId: Number(q.id),
            question: q.question,
            answer: res.answer,
            confidence: res.confidence ?? null,
            blocked: res.blocked ? 1 : 0,
            citations: res.sources.map((s) => ({
              id: s.id,
              title: s.title,
              similarity: s.similarity,
            })),
            verdict: grade.verdict,
            failedChecks: grade.failedChecks.length ? grade.failedChecks : null,
          }),
        );
      } catch (e) {
        if (q.expected?.length) fail++;
        // One bad question must not cost the whole run — record and continue.
        this.logger.warn(`golden run ${run.id}: question ${q.id} failed: ${(e as Error).message}`);
        await this.itemRepo.save(
          this.itemRepo.create({
            tenantId,
            runId: Number(run.id),
            questionId: Number(q.id),
            question: q.question,
            answer: '',
            confidence: null,
            blocked: 0,
            citations: null,
            error: (e as Error).message.slice(0, 300),
            verdict: q.expected?.length ? 'fail' : null,
            failedChecks: q.expected?.length ? ['error'] : null,
          }),
        );
      }
    }

    run.passCount = pass;
    run.failCount = fail;
    run.status = 'done';
    run.completedAt = new Date();
    return this.runRepo.save(run);
  }

  async listRuns(tenantId: number, limit = 10): Promise<GoldenRun[]> {
    return this.runRepo.find({ where: { tenantId }, order: { id: 'DESC' }, take: limit });
  }

  async getRun(tenantId: number, id: number): Promise<{ run: GoldenRun; items: GoldenRunItem[] }> {
    const run = await this.runRepo.findOne({ where: { id, tenantId } });
    if (!run) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    const items = await this.itemRepo.find({ where: { tenantId, runId: id }, order: { id: 'ASC' } });
    return { run, items };
  }

  /**
   * Line up two runs question by question. Questions are matched on their text,
   * not their id, so a run still compares against one taken before the question
   * was edited or removed.
   */
  async compare(
    tenantId: number,
    baseId: number,
    targetId: number,
  ): Promise<{
    base: GoldenRun;
    target: GoldenRun;
    sameConfig: boolean;
    items: CompareItem[];
  }> {
    const [base, target] = await Promise.all([
      this.getRun(tenantId, baseId),
      this.getRun(tenantId, targetId),
    ]);

    const key = (q: string) => q.trim();
    const baseByQ = new Map(base.items.map((i) => [key(i.question), i]));
    const targetByQ = new Map(target.items.map((i) => [key(i.question), i]));
    const questions = [...new Set([...baseByQ.keys(), ...targetByQ.keys()])];

    const shape = (i: GoldenRunItem | undefined) =>
      i
        ? {
            answer: i.answer,
            confidence: i.confidence,
            citations: (i.citations ?? []).map((c) => c.title),
            blocked: !!i.blocked,
          }
        : null;

    const items: CompareItem[] = questions.map((q) => {
      const b = baseByQ.get(q);
      const t = targetByQ.get(q);
      const bs = shape(b);
      const ts = shape(t);
      return {
        question: b?.question ?? t?.question ?? q,
        base: bs,
        target: ts,
        confidenceDelta:
          bs?.confidence != null && ts?.confidence != null
            ? Number((ts.confidence - bs.confidence).toFixed(3))
            : null,
        lengthDelta: bs && ts ? ts.answer.length - bs.answer.length : null,
        citationsChanged: !!bs && !!ts && JSON.stringify(bs.citations) !== JSON.stringify(ts.citations),
        textChanged: !!bs && !!ts && bs.answer.trim() !== ts.answer.trim(),
        baseVerdict: b?.verdict ?? null,
        targetVerdict: t?.verdict ?? null,
        regressed: b?.verdict === 'pass' && t?.verdict === 'fail',
        improved: b?.verdict === 'fail' && t?.verdict === 'pass',
        targetFailedChecks: t?.failedChecks ?? [],
      };
    });
    // Regressions first — the line a reviewer must not miss (PLN-261007 R7).
    items.sort((x, y) => Number(y.regressed) - Number(x.regressed));

    return {
      base: base.run,
      target: target.run,
      // Equal hashes mean nothing about the config changed between the runs, so
      // any difference below is the model's own variance — not an effect.
      sameConfig: base.run.configHash === target.run.configHash,
      items,
    };
  }
}
