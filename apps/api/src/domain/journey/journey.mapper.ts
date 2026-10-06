import { JourneyReport } from './entity/journey-report.entity';
import { JourneyReportCriteria } from './entity/journey-report-criteria.entity';
import { JourneyStage } from './entity/journey-stage.entity';
import { Journey } from './entity/journey.entity';
import { JourneyTask } from './entity/journey-task.entity';
import type { BoardCard, TimelineItem } from './journey-manage.service';
import type { AuditLogWithActor } from '../audit/audit.service';

export class JourneyMapper {
  /**
   * The body is omitted from lists on purpose — a report runs to several
   * thousand words and a group can hold dozens.
   */
  static toReport(r: JourneyReport, withBody = false) {
    return {
      id: String(r.id),
      groupId: String(r.groupId),
      kind: r.kind,
      periodFrom: r.periodFrom,
      periodTo: r.periodTo,
      criteriaVersion: r.criteriaVersion,
      sessionCount: r.sessionIdsJson?.length ?? 0,
      status: r.status,
      error: r.error,
      language: r.language,
      provider: r.provider,
      model: r.model,
      sourceReportIds: r.sourceReportIds?.map(String) ?? null,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      ...(withBody ? { bodyMd: r.bodyMd, metrics: r.metricsJson } : {}),
    };
  }

  static toReportList(rows: JourneyReport[]) {
    return rows.map((r) => this.toReport(r));
  }

  static toCriteria(c: JourneyReportCriteria) {
    return {
      id: String(c.id),
      version: c.version,
      sections: c.sectionsJson,
      topQuestionsN: c.topQuestionsN,
      sampleCap: c.sampleCap,
      quoteMaxChars: c.quoteMaxChars,
      tone: c.tone,
      banned: c.bannedJson ?? [],
      createdAt: c.createdAt,
    };
  }

  // ---- journey management (PLN-261006) ----

  static toStage(s: JourneyStage) {
    return { key: s.key, label: s.label, color: s.color, sortOrder: s.sortOrder };
  }

  static toTask(t: JourneyTask, names: Map<number, string>) {
    return {
      id: String(t.id),
      title: t.title,
      dueAt: t.dueAt,
      assigneeUserId: t.assigneeUserId != null ? String(t.assigneeUserId) : null,
      assigneeName: t.assigneeUserId != null ? names.get(Number(t.assigneeUserId)) ?? null : null,
      done: t.doneAt != null,
      doneAt: t.doneAt,
      source: t.source,
      reportId: t.reportId != null ? String(t.reportId) : null,
      createdAt: t.createdAt,
    };
  }

  static toCard(
    groupId: number,
    journey: Journey | null,
    tasks: JourneyTask[],
    names: Map<number, string>,
  ) {
    return {
      groupId: String(groupId),
      stageKey: journey?.stageKey ?? null,
      stageChangedAt: journey?.stageChangedAt ?? null,
      ownerUserId: journey?.ownerUserId != null ? String(journey.ownerUserId) : null,
      ownerName: journey?.ownerUserId != null ? names.get(Number(journey.ownerUserId)) ?? null : null,
      tasks: tasks.map((t) => JourneyMapper.toTask(t, names)),
    };
  }

  static toBoardCard(c: BoardCard) {
    return {
      ...c,
      groupId: String(c.groupId),
      ownerUserId: c.ownerUserId != null ? String(c.ownerUserId) : null,
    };
  }

  static toHistory(rows: AuditLogWithActor[]) {
    return rows.map((r) => {
      const meta = (r.metadata ?? {}) as { from?: string | null; to?: string | null };
      return { at: r.createdAt, actorName: r.actorName, from: meta.from ?? null, to: meta.to ?? null };
    });
  }

  static toTimelineItem(i: TimelineItem) {
    return {
      ...i,
      sessionId: i.sessionId != null ? String(i.sessionId) : null,
      conversationId: i.conversationId != null ? String(i.conversationId) : null,
    };
  }
}
