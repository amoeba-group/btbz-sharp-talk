import { KnowledgeSource } from './entity/knowledge-source.entity';
import { UsageType } from './entity/usage-type.entity';
import { KbCategory } from './entity/kb-category.entity';
import { parseKeywords } from './usage-guide.types';
import { KbDocument } from './entity/kb-document.entity';
import { isStale } from './kb-conflict.service';
import { KbDocumentRevision } from './entity/kb-document-revision.entity';
import { KnowledgeGapTask } from './entity/knowledge-gap-task.entity';

/** When this document next falls due for review, or null if no cadence is set. */
function reviewDueAt(d: KbDocument): Date | null {
  if (!d.reviewIntervalDays || d.reviewIntervalDays <= 0) return null;
  const anchor = d.reviewedAt ?? d.updatedAt;
  if (!anchor) return null;
  const due = new Date(anchor);
  due.setDate(due.getDate() + d.reviewIntervalDays);
  return due;
}

/** Entity -> camelCase response mapping for the knowledge domain. */
export class KnowledgeMapper {
  /** Gap task → console response (P5). */
  static toGapTask(t: KnowledgeGapTask) {
    return {
      id: String(t.id),
      source: t.source,
      title: t.title,
      detail: t.detail,
      metric: t.metricJson ?? {},
      status: t.status,
      createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : '',
    };
  }

  /**
   * `supported` says whether this source type can actually ingest today.
   *
   * Without it the console shows a registered gdrive source as "Enabled" while
   * nothing whatsoever happens behind it — the exact misreading this field
   * exists to remove (REQ-260804 §7).
   */
  static toSource(s: KnowledgeSource, supported = true) {
    return {
      id: s.id,
      type: s.type,
      name: s.name,
      status: s.status,
      designated: s.designated,
      configJson: s.configJson ?? null,
      supported,
      lastSyncAt: s.lastSyncAt ?? null,
      lastSyncStatus: s.lastSyncStatus ?? null,
      lastSyncResult: s.lastSyncResult ?? null,
      createdAt: s.createdAt,
    };
  }

  static toSourceList(sources: KnowledgeSource[], supportedTypes: string[] = []) {
    const supported = new Set(supportedTypes);
    return sources.map((s) => this.toSource(s, supported.has(s.type)));
  }

  static toDocument(d: KbDocument) {
    return {
      id: d.id,
      source: d.source,
      sourceId: d.sourceId ?? null,
      docGroup: d.docGroup,
      externalKey: d.externalKey ?? null,
      category: d.category ?? null,
      title: d.title,
      content: d.content ?? null,
      embeddingRef: d.embeddingRef ?? null,
      active: d.active,
      status: d.status,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      // Provenance & staleness (PLN D7). `stale` is derived rather than stored
      // so it cannot drift out of date between writes.
      sourceUrl: d.sourceUrl ?? null,
      videoRef: d.videoRef ?? null,
      ownerUserId: d.ownerUserId ?? null,
      effectiveFrom: d.effectiveFrom ?? null,
      reviewIntervalDays: d.reviewIntervalDays ?? null,
      reviewedAt: d.reviewedAt ?? null,
      reviewedBy: d.reviewedBy ?? null,
      supersededBy: d.supersededBy ?? null,
      stale: isStale(d),
      reviewDueAt: reviewDueAt(d),
    };
  }

  static toDocumentList(docs: KbDocument[]) {
    return docs.map((d) => this.toDocument(d));
  }


  /** History row. `content` is omitted from lists — a page of them would drag
   * every past body along for a table that only shows who/when/what. */
  static toRevision(r: KbDocumentRevision, withContent = false) {
    return {
      id: r.id,
      revisionNo: r.revisionNo,
      title: r.title,
      category: r.category,
      changedFields: r.changedFields ?? [],
      changeKind: r.changeKind,
      actorUserId: r.actorUserId,
      restoredFrom: r.restoredFrom,
      createdAt: r.createdAt,
      ...(withContent
        ? {
            content: r.content,
            sourceUrl: r.sourceUrl,
            effectiveFrom: r.effectiveFrom,
            reviewIntervalDays: r.reviewIntervalDays,
            active: r.active,
          }
        : {}),
    };
  }

  static toRevisionList(rows: KbDocumentRevision[]) {
    return rows.map((r) => this.toRevision(r));
  }

  /** usage_types row → console shape (PLN-260824 A축). */
  static toUsageType(t: UsageType) {
    return {
      id: String(t.id),
      key: t.key,
      label: t.label,
      // Split back into lines: the console edits these as a list, and the
      // stored newline form is a storage detail.
      keywords: parseKeywords(t.keywords),
      sortOrder: t.sortOrder,
      active: t.active === 1,
      updatedAt: t.updatedAt,
    };
  }

  static toUsageTypeList(rows: UsageType[]) {
    return rows.map((t) => this.toUsageType(t));
  }

  /** kb_categories row → console shape (PLN-260824 B축). */
  static toCategory(c: KbCategory) {
    return {
      id: String(c.id),
      name: c.name,
      label: c.label,
      origin: c.origin,
      sortOrder: c.sortOrder,
      hidden: c.hidden === 1,
      agentIds: c.agentIds ?? [],
    };
  }
}
