import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThan, Repository } from 'typeorm';
import { MODERATION_DECISION, SENDER_TYPE } from '@sharptalk/types';
import { JourneyReport, REPORT_KIND, REPORT_STATUS } from './entity/journey-report.entity';
import { JourneyMetricsService, JourneyWindow } from './journey-metrics.service';
import { JourneyCriteriaService } from './journey-criteria.service';
import {
  buildComparisonPrompt,
  buildJourneyPrompt,
  clip,
  SampleUtterance,
  SECTION_ORDER,
} from './journey-prompt';
import {
  contentTexts,
  contentToMarkdown,
  extractJson,
  groundContent,
  JourneyReportContent,
  withContentTexts,
} from './journey-report-content';
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

/**
 * The JSON reply repeats keys and quote references the prose did not, and a
 * reply cut at the limit is unparseable — a wasted call and a retry. The first
 * structured report (2 sessions) used 2,032 of 4,000; billed by use, not cap.
 */
const JSON_MAX_TOKENS = 6000;

/** Structured attempts before falling back to the Markdown report (PLN-261008 D1). */
const JSON_ATTEMPTS = 2;

/**
 * Joins the report's text fields for one moderation pass. A rule that rewrites
 * across it (rephrase) breaks the count, and the fields are then moderated one
 * by one instead.
 */
const FIELD_SEPARATOR = '\n\n§§§\n\n';

type Criteria = Awaited<ReturnType<JourneyCriteriaService['current']>>;

interface Written {
  body: string;
  content: JourneyReportContent | null;
  provider: string;
  model: string;
}

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

      const written =
        report.kind === REPORT_KIND.COMPARISON
          ? await this.writeComparison(report, criteria)
          : await this.writeJourney(report, criteria);
      // Generated text is outbound like any other (FR-069). A blocked report is
      // a failure with a reason, not a report with holes in it.
      if (!written) {
        await this.fail(report, 'blocked by moderation');
        return;
      }

      report.bodyMd = written.body;
      report.contentJson = written.content as unknown as Record<string, unknown> | null;
      report.status = REPORT_STATUS.READY;
      report.provider = written.provider;
      report.model = written.model;
      report.finishedAt = new Date();
      await this.repo.save(report);

      await this.audit.write({
        tenantId: report.tenantId,
        actorType: 'user',
        actorId: report.createdBy,
        action: 'journey.report_created',
        target: `report:${report.id}`,
        metadata: { kind: report.kind, criteriaVersion: report.criteriaVersion, structured: !!written.content },
      });
    } catch (e) {
      await this.fail(report, (e as Error).message);
    }
  }

  /**
   * The structured report first; the prose report when the structure does not
   * hold up twice. Either way the Markdown body is written — comparisons, old
   * screens and exports read it.
   */
  private async writeJourney(report: JourneyReport, criteria: Criteria): Promise<Written | null> {
    const metrics = await this.metrics.compute(report.tenantId, report.sessionIdsJson);
    const samples = await this.sampleUtterances(
      report.sessionIdsJson,
      criteria.sampleCap,
      criteria.quoteMaxChars,
    );
    report.metricsJson = metrics as unknown as Record<string, unknown>;
    await this.repo.save(report);

    const base = {
      criteria,
      metrics,
      samples,
      language: report.language,
      period: { from: report.periodFrom, to: report.periodTo },
    };
    const sectionKeys = SECTION_ORDER.filter((k) => criteria.sectionsJson[k]);

    for (let attempt = 1; attempt <= JSON_ATTEMPTS; attempt++) {
      const res = await this.complete(report, buildJourneyPrompt({ ...base, format: 'json' }), JSON_MAX_TOKENS);
      const grounded = groundContent(extractJson(res.text), samples, sectionKeys, criteria.topQuestionsN);
      if (!grounded) {
        this.logger.warn(`journey report ${report.id}: structured reply unusable (attempt ${attempt})`);
        continue;
      }
      if (grounded.dropped) {
        this.logger.log(`journey report ${report.id}: dropped ${grounded.dropped} item(s) without evidence`);
      }
      const content = await this.moderateContent(report.tenantId, grounded);
      if (!content) return null;
      return {
        content,
        body: contentToMarkdown(content, report.language),
        provider: res.provider,
        model: res.model,
      };
    }

    const res = await this.complete(report, buildJourneyPrompt({ ...base, format: 'markdown' }));
    const body = await this.moderateText(report.tenantId, res.text);
    return body == null ? null : { body, content: null, provider: res.provider, model: res.model };
  }

  private async writeComparison(report: JourneyReport, criteria: Criteria): Promise<Written | null> {
    const res = await this.complete(report, await this.comparisonPrompt(report, criteria));
    const body = await this.moderateText(report.tenantId, res.text);
    return body == null ? null : { body, content: null, provider: res.provider, model: res.model };
  }

  private complete(report: JourneyReport, prompt: { system: string; user: string }, maxTokens = 4000) {
    return this.ai.complete({
      tenantId: report.tenantId,
      function: 'summary',
      // Its own label: one report is a large call, and folding it into
      // `summary` would hide it among the agent briefings.
      feature: 'journey_report',
      system: prompt.system,
      messages: [{ role: 'user', content: prompt.user }],
      maxTokens,
    });
  }

  /** The moderated text, or null when the gate blocked it. */
  private async moderateText(tenantId: number, text: string): Promise<string | null> {
    const verdict = await this.moderation.moderate({ tenantId, scope: 'ai', authorType: 'ai', text });
    return verdict.decision === MODERATION_DECISION.BLOCKED || !verdict.text ? null : verdict.text;
  }

  /**
   * Every text field through the gate (FR-069), in one pass when possible.
   *
   * Field by field would write a moderation log row per sentence; joined, the
   * gate sees the report the way it saw the Markdown body. A block anywhere
   * blocks the report, as before.
   */
  async moderateContent(
    tenantId: number,
    content: JourneyReportContent,
  ): Promise<JourneyReportContent | null> {
    const texts = contentTexts(content);
    const joined = texts.join(FIELD_SEPARATOR);
    const whole = await this.moderateText(tenantId, joined);
    if (whole == null) return null;
    if (whole === joined) return content;

    const parts = whole.split(FIELD_SEPARATOR);
    if (parts.length === texts.length) return withContentTexts(content, parts);

    const each: string[] = [];
    for (const t of texts) {
      if (!t) {
        each.push('');
        continue;
      }
      const moderated = await this.moderateText(tenantId, t);
      if (moderated == null) return null;
      each.push(moderated);
    }
    return withContentTexts(content, each);
  }

  private async comparisonPrompt(report: JourneyReport, criteria: Criteria) {
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
        // Cut with a visible mark: a 278-character answer cut silently at 200
        // was quoted back as a sentence that ends mid-way (REQ-261008 F2).
        text: scrubPii(clip(m.body ?? '', maxChars)).text,
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
