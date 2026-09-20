import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { MODERATION_DECISION, SENDER_TYPE } from '@sharptalk/types';
import { JourneyReport, REPORT_KIND, REPORT_STATUS } from './entity/journey-report.entity';
import { JourneyMetricsService, JourneyWindow } from './journey-metrics.service';
import { JourneyCriteriaService } from './journey-criteria.service';
import { buildComparisonPrompt, buildJourneyPrompt, SampleUtterance } from './journey-prompt';
import { Message } from '../chat/entity/message.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { Tenant } from '../tenant/entity/tenant.entity';
import { AiGatewayService } from '../../infrastructure/external/ai/ai-gateway.service';
import { ModerationService } from '../moderation/moderation.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { scrubPii } from '../../global/util/pii-scrub.util';

/**
 * A run older than this was almost certainly cut off by a restart.
 *
 * The row is the job, so nothing else notices it stopped — a `pending` report
 * would otherwise sit in the list forever looking like it is still thinking.
 */
const STALE_PENDING_MIN = 30;

@Injectable()
export class JourneyReportService implements OnModuleInit {
  private readonly logger = new Logger(JourneyReportService.name);

  constructor(
    @InjectRepository(JourneyReport) private readonly repo: Repository<JourneyReport>,
    @InjectRepository(Message) private readonly msgRepo: Repository<Message>,
    @InjectRepository(Conversation) private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    private readonly metrics: JourneyMetricsService,
    private readonly criteria: JourneyCriteriaService,
    private readonly ai: AiGatewayService,
    private readonly moderation: ModerationService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.sweepStalePending().catch((e) =>
      this.logger.warn(`stale pending sweep failed: ${(e as Error).message}`),
    );
  }

  /**
   * Reports left mid-flight by a restart are closed out, not left pending.
   *
   * "Still generating" and "died an hour ago" look identical from the list, and
   * the operator's next move differs completely.
   */
  async sweepStalePending(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_PENDING_MIN * 60_000);
    const res = await this.repo.update(
      { status: REPORT_STATUS.PENDING, createdAt: LessThan(cutoff) },
      {
        status: REPORT_STATUS.FAILED,
        error: 'generation was interrupted before it finished',
        finishedAt: new Date(),
      },
    );
    if (res.affected) this.logger.log(`marked ${res.affected} interrupted report(s) failed`);
    return res.affected ?? 0;
  }

  async list(tenantId: number, groupId: number): Promise<JourneyReport[]> {
    return this.repo.find({
      where: { tenantId, groupId, hidden: 0 },
      order: { createdAt: 'DESC' },
    });
  }

  async get(tenantId: number, id: number): Promise<JourneyReport> {
    const row = await this.repo.findOne({ where: { tenantId, id } });
    if (!row) throw new BusinessException(ERROR_CODE.RESOURCE_NOT_FOUND, HttpStatus.NOT_FOUND);
    return row;
  }

  /** Hidden, never deleted: a comparison names its two inputs. */
  async hide(tenantId: number, id: number): Promise<void> {
    const row = await this.get(tenantId, id);
    row.hidden = 1;
    await this.repo.save(row);
  }

  /**
   * Accept the request and answer immediately; the writing happens after.
   *
   * A large group takes tens of seconds. Holding the response means nginx cuts
   * it at sixty and the operator sees a failure for work that succeeded — the
   * same trap the catalogue conversion hit.
   */
  async request(
    tenantId: number,
    groupId: number,
    window: JourneyWindow,
    actorUserId: number,
  ): Promise<JourneyReport> {
    const criteria = await this.criteria.current(tenantId, actorUserId);
    const sessionIds = await this.metrics.sessionIdsFor(tenantId, groupId, window);
    if (!sessionIds.length) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }

    const report = await this.repo.save(
      this.repo.create({
        tenantId,
        groupId,
        kind: REPORT_KIND.JOURNEY,
        periodFrom: window.from,
        periodTo: window.to,
        criteriaVersion: criteria.version,
        sessionIdsJson: sessionIds,
        language: await this.languageOf(tenantId),
        status: REPORT_STATUS.PENDING,
        createdBy: actorUserId,
        hidden: 0,
      }),
    );

    void this.run(report.id).catch((e) =>
      this.logger.error(`journey report ${report.id} failed: ${(e as Error).message}`),
    );
    return report;
  }

  async requestComparison(
    tenantId: number,
    reportIds: number[],
    actorUserId: number,
  ): Promise<JourneyReport> {
    if (reportIds.length !== 2) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    const sources = await this.repo.find({ where: { tenantId, id: In(reportIds) } });
    if (sources.length !== 2 || sources.some((s) => s.status !== REPORT_STATUS.READY)) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    const criteria = await this.criteria.current(tenantId, actorUserId);
    const report = await this.repo.save(
      this.repo.create({
        tenantId,
        groupId: sources[0].groupId,
        kind: REPORT_KIND.COMPARISON,
        periodFrom: null,
        periodTo: null,
        criteriaVersion: criteria.version,
        // A comparison reads reports, not sessions; the union is kept so the
        // row still says what it was about.
        sessionIdsJson: [...new Set(sources.flatMap((s) => s.sessionIdsJson))],
        sourceReportIds: sources.map((s) => Number(s.id)),
        language: await this.languageOf(tenantId),
        status: REPORT_STATUS.PENDING,
        createdBy: actorUserId,
        hidden: 0,
      }),
    );
    void this.run(report.id).catch((e) =>
      this.logger.error(`comparison report ${report.id} failed: ${(e as Error).message}`),
    );
    return report;
  }

  /** Compose, write, moderate, store. Failure leaves a reason, never half a report. */
  private async run(reportId: number): Promise<void> {
    const report = await this.repo.findOne({ where: { id: reportId } });
    if (!report) return;
    try {
      const criteria =
        (await this.criteria.version(report.tenantId, report.criteriaVersion)) ??
        (await this.criteria.current(report.tenantId, report.createdBy));

      const prompt =
        report.kind === REPORT_KIND.COMPARISON
          ? await this.comparisonPrompt(report, criteria)
          : await this.journeyPrompt(report, criteria);

      const res = await this.ai.complete({
        tenantId: report.tenantId,
        function: 'summary',
        // Its own label: one report is a large call, and folding it into
        // `summary` would hide it among the agent briefings.
        feature: 'journey_report',
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        maxTokens: 4000,
      });

      // Generated text is outbound like any other (FR-069). A blocked report is
      // a failure with a reason, not a report with holes in it.
      const verdict = await this.moderation.moderate({
        tenantId: report.tenantId,
        scope: 'ai',
        authorType: 'ai',
        text: res.text,
      });
      if (verdict.decision === MODERATION_DECISION.BLOCKED || !verdict.text) {
        await this.fail(report, 'blocked by moderation');
        return;
      }

      report.bodyMd = verdict.text;
      report.status = REPORT_STATUS.READY;
      report.provider = res.provider;
      report.model = res.model;
      report.finishedAt = new Date();
      await this.repo.save(report);

      await this.audit.write({
        tenantId: report.tenantId,
        actorType: 'user',
        actorId: report.createdBy,
        action: 'journey.report_created',
        target: `report:${report.id}`,
        metadata: { kind: report.kind, criteriaVersion: report.criteriaVersion },
      });
    } catch (e) {
      await this.fail(report, (e as Error).message);
    }
  }

  private async journeyPrompt(report: JourneyReport, criteria: Awaited<ReturnType<JourneyCriteriaService['current']>>) {
    const metrics = await this.metrics.compute(report.tenantId, report.sessionIdsJson);
    const samples = await this.sampleUtterances(
      report.sessionIdsJson,
      criteria.sampleCap,
      criteria.quoteMaxChars,
    );
    report.metricsJson = metrics as unknown as Record<string, unknown>;
    await this.repo.save(report);
    return buildJourneyPrompt({
      criteria,
      metrics,
      samples,
      language: report.language,
      period: { from: report.periodFrom, to: report.periodTo },
    });
  }

  private async comparisonPrompt(report: JourneyReport, criteria: Awaited<ReturnType<JourneyCriteriaService['current']>>) {
    const sources = await this.repo.find({ where: { id: In(report.sourceReportIds ?? []) } });
    const [older, newer] = [...sources].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const shape = (r: JourneyReport) => ({
      createdAt: r.createdAt.toISOString().slice(0, 10),
      criteriaVersion: r.criteriaVersion,
      metrics: (r.metricsJson ?? {}) as never,
      body: r.bodyMd ?? '',
    });
    return buildComparisonPrompt({
      criteria,
      older: shape(older),
      newer: shape(newer),
      language: report.language,
    });
  }

  /**
   * Representative customer utterances, capped.
   *
   * Evenly spread across the period rather than the newest N: the newest are
   * the ones the operator has just read, and the point of the report is the
   * shape of the whole relationship.
   */
  private async sampleUtterances(
    sessionIds: number[],
    cap: number,
    maxChars: number,
  ): Promise<SampleUtterance[]> {
    const conversations = await this.convRepo.find({ where: { sessionId: In(sessionIds) } });
    const convIds = conversations.map((c) => Number(c.id));
    if (!convIds.length) return [];
    const messages = await this.msgRepo.find({
      where: { conversationId: In(convIds) },
      order: { id: 'ASC' },
    });
    const said = messages.filter(
      (m) => m.senderType !== SENDER_TYPE.SYSTEM && (m.body ?? '').trim().length > 0,
    );
    const step = Math.max(1, Math.ceil(said.length / cap));
    return said
      .filter((_, i) => i % step === 0)
      .slice(0, cap)
      .map((m) => ({
        at: m.createdAt.toISOString().slice(0, 10),
        who: m.senderType,
        // Every other AI path already minimizes its egress copy; this one did
        // not, and it is the path that asks the model to write a "contact"
        // section (PLN-260920 P4). Quotes come back scrubbed, which is what
        // the report needs — the pattern of what shoppers ask, not who asked.
        text: scrubPii((m.body ?? '').slice(0, maxChars)).text,
      }));
  }

  private async fail(report: JourneyReport, reason: string): Promise<void> {
    report.status = REPORT_STATUS.FAILED;
    report.error = reason.slice(0, 255);
    report.finishedAt = new Date();
    await this.repo.save(report);
  }

  private async languageOf(tenantId: number): Promise<string> {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    return (tenant as { language?: string } | null)?.language ?? 'EN';
  }
}
