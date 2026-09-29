import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { SENDER_TYPE } from '@sharptalk/types';
import { GAP_SOURCE, GAP_STATUS, KnowledgeGapTask } from './entity/knowledge-gap-task.entity';
import { QuestionStatDaily } from '../analytics/entity/question-stat-daily.entity';
import { Message } from '../chat/entity/message.entity';
import { KnowledgeService } from './knowledge.service';
import { KbDocument } from './entity/kb-document.entity';
import { CreateDocumentRequest } from './dto/request/knowledge.request';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { scrubPii } from '../../global/util/pii-scrub.util';
import { EventBusService, EVENTS } from '../../infrastructure/infrastructure.module';
import { envNumber } from '../../global/util/env-number.util';

const WINDOW_DAYS = 7;
const MIN_ASKED = 3;
const ESCALATION_RATE_MIN = 0.5;
const MIN_NO_SOURCE = 3;
const FIRST_RUN_DELAY_MS = 15 * 60_000;

interface IssueResolvedEvent {
  tenantId?: number;
  issueId?: number;
  issueNo?: number;
  conversationId?: number;
}

/**
 * Knowledge-gap closed loop (PLN-260809-Issue-Workflow-P5, 결정 9): analytics
 * and agent resolutions PROPOSE knowledge; a human accepts (→ the existing KB
 * create+embed pipeline) or dismisses. Nothing is ever auto-applied. Proposals
 * are idempotent on (tenant, source, refKey); dismissed ones stay dismissed.
 */
@Injectable()
export class KnowledgeGapService implements OnModuleInit {
  private readonly logger = new Logger(KnowledgeGapService.name);
  private running = false;

  constructor(
    @InjectRepository(KnowledgeGapTask) private readonly taskRepo: Repository<KnowledgeGapTask>,
    @InjectRepository(QuestionStatDaily) private readonly statRepo: Repository<QuestionStatDaily>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    private readonly knowledgeService: KnowledgeService,
    private readonly audit: AuditService,
    private readonly bus: EventBusService,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe(EVENTS.ISSUE_RESOLVED, async (payload: unknown) => {
      try {
        await this.proposeFromResolution((payload ?? {}) as IssueResolvedEvent);
      } catch (e) {
        this.logger.warn(`gap capture proposal failed: ${(e as Error).message}`);
      }
    });
    const hours = envNumber('KNOWLEDGE_GAP_INTERVAL_HOURS', 24);
    if (!Number.isFinite(hours) || hours <= 0) {
      this.logger.log('knowledge-gap batch disabled (KNOWLEDGE_GAP_INTERVAL_HOURS <= 0)');
      return;
    }
    setTimeout(() => void this.runBatch(), FIRST_RUN_DELAY_MS);
    setInterval(() => void this.runBatch(), hours * 3_600_000);
  }

  /** Batch pass: recent stats → escalation-heavy clusters + no-source intents. */
  async runBatch(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3_600_000)
        .toISOString()
        .slice(0, 10);
      const rows = await this.statRepo.find({ where: { statDate: MoreThan(since) } });

      // Aggregate the window per (tenant, dimension, dimKey).
      const agg = new Map<
        string,
        { tenantId: number; dimension: string; dimKey: string; label: string | null; asked: number; escalated: number; noSource: number }
      >();
      for (const r of rows) {
        const key = `${r.tenantId}|${r.dimension}|${r.dimKey}`;
        const cur =
          agg.get(key) ??
          {
            tenantId: Number(r.tenantId),
            dimension: r.dimension,
            dimKey: r.dimKey,
            label: r.dimLabel,
            asked: 0,
            escalated: 0,
            noSource: 0,
          };
        cur.asked += r.asked;
        cur.escalated += r.escalated;
        cur.noSource += r.noSource;
        if (r.dimLabel) cur.label = r.dimLabel;
        agg.set(key, cur);
      }

      let proposed = 0;
      for (const a of agg.values()) {
        if (a.dimension === 'cluster' && a.asked >= MIN_ASKED && a.escalated / a.asked >= ESCALATION_RATE_MIN) {
          proposed += await this.upsertProposal(a.tenantId, GAP_SOURCE.ESCALATION_CLUSTER, `cluster:${a.dimKey}`, {
            title: (a.label ?? a.dimKey).slice(0, 300),
            detail: null,
            metric: { windowDays: WINDOW_DAYS, asked: a.asked, escalated: a.escalated },
          });
        }
        if (a.dimension === 'intent' && a.noSource >= MIN_NO_SOURCE) {
          proposed += await this.upsertProposal(a.tenantId, GAP_SOURCE.NO_SOURCE, `intent:${a.dimKey}`, {
            title: `intent: ${a.label ?? a.dimKey}`.slice(0, 300),
            detail: null,
            metric: { windowDays: WINDOW_DAYS, asked: a.asked, noSource: a.noSource },
          });
        }
      }
      if (proposed > 0) this.logger.log(`knowledge-gap batch proposed ${proposed} task(s)`);
    } catch (e) {
      this.logger.warn(`knowledge-gap batch failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Agent-tier resolution → capture proposal (question + answer candidate). */
  async proposeFromResolution(event: IssueResolvedEvent): Promise<void> {
    const { tenantId, issueId, conversationId } = event;
    if (!tenantId || !issueId || !conversationId) return;
    const answer = await this.msgRepo.findOne({
      where: { conversationId, senderType: SENDER_TYPE.AGENT },
      order: { id: 'DESC' },
    });
    if (!answer) return;
    const question = await this.msgRepo.findOne({
      where: { conversationId, senderType: SENDER_TYPE.USER },
      order: { id: 'DESC' },
    });
    if (!question) return;
    await this.upsertProposal(tenantId, GAP_SOURCE.AGENT_RESOLUTION, `issue:${issueId}`, {
      title: scrubPii(question.body).text.trim().slice(0, 300),
      detail: answer.body,
      metric: { issueNo: event.issueNo ?? null },
    });
  }

  /* ------------------------------ console API ------------------------------ */

  async list(tenantId: number, status: string): Promise<KnowledgeGapTask[]> {
    return this.taskRepo.find({
      where: { tenantId, status },
      order: { id: 'DESC' },
      take: 50,
    });
  }

  /**
   * Human approval (결정 9): create + embed a KB document through the EXISTING
   * pipeline with the (possibly edited) title/content, then mark accepted.
   */
  async accept(
    tenantId: number,
    actorUserId: number,
    taskId: number,
    edit: { title?: string; content?: string },
  ): Promise<{ task: KnowledgeGapTask; document: KbDocument }> {
    const task = await this.requireProposed(tenantId, taskId);
    const title = (edit.title ?? task.title).trim();
    const content = (edit.content ?? task.detail ?? '').trim();
    if (!title || !content) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    const document = await this.knowledgeService.createDocument(
      tenantId,
      { title, content, category: 'faq', source: 'knowledge_gap' } as CreateDocumentRequest,
      actorUserId,
    );
    task.status = GAP_STATUS.ACCEPTED;
    task.decidedBy = actorUserId;
    task.decidedAt = new Date();
    const saved = await this.taskRepo.save(task);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId: actorUserId,
      action: 'knowledge.gap_accepted',
      target: `task#${task.id} → doc#${document.id}`,
    });
    return { task: saved, document };
  }

  async dismiss(tenantId: number, actorUserId: number, taskId: number): Promise<KnowledgeGapTask> {
    const task = await this.requireProposed(tenantId, taskId);
    task.status = GAP_STATUS.DISMISSED;
    task.decidedBy = actorUserId;
    task.decidedAt = new Date();
    const saved = await this.taskRepo.save(task);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId: actorUserId,
      action: 'knowledge.gap_dismissed',
      target: `task#${task.id}`,
    });
    return saved;
  }

  /* ------------------------------ internals ------------------------------ */

  private async requireProposed(tenantId: number, taskId: number): Promise<KnowledgeGapTask> {
    const task = await this.taskRepo.findOne({ where: { id: taskId, tenantId } });
    if (!task || task.status !== GAP_STATUS.PROPOSED) {
      this.logger.warn(`gap task decision rejected: id=${taskId} tenant=${tenantId}`);
      throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    }
    return task;
  }

  /** Insert-or-refresh a proposal; dismissed/accepted rows are never re-raised. Returns 1 when newly proposed. */
  private async upsertProposal(
    tenantId: number,
    source: string,
    refKey: string,
    input: { title: string; detail: string | null; metric: Record<string, unknown> },
  ): Promise<number> {
    const existing = await this.taskRepo.findOne({ where: { tenantId, source, refKey } });
    if (existing) {
      if (existing.status === GAP_STATUS.PROPOSED) {
        existing.metricJson = input.metric;
        await this.taskRepo.save(existing);
      }
      return 0; // decided rows stay decided (결정 9 — no nagging re-proposals)
    }
    await this.taskRepo.save(
      this.taskRepo.create({
        tenantId,
        source,
        refKey,
        title: input.title,
        detail: input.detail,
        metricJson: input.metric,
        status: GAP_STATUS.PROPOSED,
      }),
    );
    return 1;
  }
}
