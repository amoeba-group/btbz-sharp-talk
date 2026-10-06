import { apiGet, apiGetBlob, apiGetList, apiPost, apiPostForm, apiPatch, apiPut, apiDelete, saveBlob } from '@/lib/api-client';
import type { Paginated } from '@/lib/types';

/** Shapes mirror KnowledgeMapper (apps/api knowledge.mapper.ts). */
export interface GdriveCredentialStatus {
  connected: boolean;
  clientEmail: string | null;
}

export interface GdriveTestResult {
  ok: boolean;
  message: string;
  files?: number;
}

export interface NotionCredentialStatus {
  connected: boolean;
  /** Last four characters only — enough to tell two tokens apart. */
  tokenHint: string | null;
}

export interface NotionTestResult {
  ok: boolean;
  message: string;
  kind?: string;
  pages?: number;
}

export interface SyncResult {
  fetched: number;
  created: number;
  updated: number;
  skipped: number;
  hidden: number;
  failed: number;
  embedded?: number;
  embedFailed?: number;
  /** Pages the source held but this run did not convert (Notion's page cap). */
  dropped?: number;
  /** Documents stored with only part of their source content. */
  truncated?: number;
  elapsedMs?: number;
  /** Why a failed run failed (clamped server-side, REQ-260828 B1). */
  error?: string;
}

export interface KnowledgeSource {
  id: string;
  type: string; // board/repository/gdrive/notion
  name: string;
  status: string; // active/inactive
  designated: number;
  /** Source config as stored (e.g. Notion targetId) — used by the card's
   * target-aware connection test (REQ-260828 B2). */
  configJson?: Record<string, unknown> | null;
  /** False when the type has no working adapter yet — shown as "준비중". */
  supported?: boolean;
  lastSyncAt?: string | null;
  lastSyncStatus?: string | null; // ok/failed
  lastSyncResult?: SyncResult | null;
  createdAt?: string;
}

export interface KnowledgeDocument {
  id: string;
  source: string; // knowledge_store/google_drive
  sourceId: string | null;
  category: string | null;
  title: string;
  active: number;
  status: string; // embedded/pending
  /** counsel | product | operation */
  docGroup?: string;
  externalKey?: string | null;
  createdAt?: string;
  updatedAt?: string;
  // Provenance & staleness (PLN D7). `stale`/`reviewDueAt` are derived server-side.
  sourceUrl?: string | null;
  ownerUserId?: string | null;
  effectiveFrom?: string | null;
  reviewIntervalDays?: number | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  supersededBy?: string | null;
  stale?: boolean;
  reviewDueAt?: string | null;
}

/** Detail adds the LONGTEXT content the list endpoint omits (PERF-9). */
export interface KnowledgeDocumentDetail extends KnowledgeDocument {
  content: string | null;
  /** Board document managing this row (adopted or KB-imported) — PLN-260910. */
  boardDocumentId?: string | null;
}

/** KB QA answer with the source documents behind it (PLN-Knowledge-QA F1). */
export interface KnowledgeSource_ {
  id: number;
  title: string;
  category: string | null;
  similarity: number | null;
  snippet: string;
  /** Origin system: knowledge_store / google_drive. */
  source?: string | null;
  /** Past its review cadence. */
  stale?: boolean;
  /** Named in an open conflict with another document. */
  conflicted?: boolean;
}

export interface KnowledgeAnswer {
  answer: string;
  confidence: number;
  /** True when moderation would block this answer — the text is withheld. */
  blocked: boolean;
  sources: KnowledgeSource_[];
}

export interface CategoryCount {
  /** counsel | product */
  group: string;
  category: string | null;
  total: number;
  active: number;
}

/** Dry-run plan for the storefront catalogue → knowledge conversion (PLN-260807 P1). */
export interface CatalogSyncPreview {
  scanned: number;
  families: number;
  absorbed: number;
  created: number;
  updated: number;
  curatedKept: number;
  unchanged: number;
  held: number;
  heldSamples: Array<{ handle: string; title: string }>;
  familySamples: Array<{ representative: string; absorbed: number; variants: string[] }>;
}

/** What a catalogue sync actually did. */
export interface CatalogSyncResult extends Omit<CatalogSyncPreview, 'heldSamples' | 'familySamples'> {
  embedded: number;
  embedFailed: number;
}

/** An answer a chat handler wants to become knowledge (PLN-260810 S4). */
export interface AnswerProposal {
  id: string;
  conversationId: string | null;
  question: string;
  answer: string;
  status: 'pending' | 'approved' | 'rejected';
  proposedBy: string;
  rejectReason: string | null;
  documentId: string | null;
  createdAt: string;
}

/** One product type's usage guide and how many products it serves (PLN-260807 P2). */
export interface UsageGuide {
  /** Row id of the type — the guide is still addressed by `key`. */
  id: string;
  key: string;
  label: string;
  active: boolean;
  productCount: number;
  documentId: string | null;
  title: string | null;
  updatedAt: string | null;
}

/** A tenant's usage-guide type (PLN-260824 A축). */
export interface UsageType {
  id: string;
  key: string;
  label: string;
  keywords: string[];
  sortOrder: number;
  active: boolean;
}

/** What a keyword set would claim, before it is saved (PLN D2). */
export interface UsageTypePreview {
  matched: number;
  samples: string[];
  /** Products these keywords describe that a type above already claims. */
  takenByOthers: number;
  takenBy: string | null;
}

/** A tenant's document category (PLN-260824 B축). */
export interface KbCategoryRow {
  id: string;
  name: string;
  label: string | null;
  /** manual | catalog | seed — `catalog` rows are read-only. */
  origin: string;
  hidden: boolean;
  documentCount: number;
  /** Agents allowed to cite documents here; empty = every agent (REQ-260826). */
  agentIds: number[];
  /**
   * Whether an UNIDENTIFIED visitor may be answered from here when the agent
   * runs the login-guidance policy (PLN-261001 W3). Default off.
   */
  guestVisible?: boolean;
}

/** Live state of the async conversion (PLN-260807 P1 / RPT-260808 D3). */
export interface CatalogSyncJob {
  id: string;
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  phase: 'planning' | 'writing' | 'embedding' | 'done';
  written: number;
  writeTotal: number;
  embedded: number;
  embedTotal: number;
  result: CatalogSyncResult | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ProductImportResult {
  parsed: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
  embedded: number;
  embedFailed: number;
  errors: Array<{ row: number; reason: string }>;
}

/** Generic counsel/operation bulk import (PLN-260828 D3). */
export interface BulkImportResult extends ProductImportResult {
  docGroup: string;
}

// ---- AI ingest (PLN-260829 3차) ----

export interface IngestDraft {
  title: string;
  category: string;
  content: string;
  /** A parse-failure fallback draft — the whole chunk, review carefully. */
  fallback: boolean;
}

export interface IngestJob {
  id: string;
  status: 'running' | 'ready' | 'consumed' | 'failed';
  phase: 'extracting' | 'analyzing' | 'done';
  analyzed: number;
  analyzeTotal: number;
  sourceLabel: string;
  sourceKind: string;
  docGroup: string;
  truncated: boolean;
  drafts: IngestDraft[];
  /** An Exxxx code (localizable) or free text. */
  error: string | null;
  result: Record<string, unknown> | null;
}

export interface IngestApproveResult {
  saved: number;
  docGroup: string;
  /** B2: approval publishes onto the board — these are board document ids. */
  target: 'board';
  boardDocumentIds: string[];
}

/** One side of a conflicting pair, as rendered on the review card. */
export interface ConflictDoc {
  id: string;
  title: string;
  category: string | null;
  source: string;
  sourceUrl: string | null;
  content: string;
  effectiveFrom: string | null;
  updatedAt: string | null;
  reviewedAt: string | null;
  active: boolean;
  stale: boolean;
}

export interface KnowledgeConflict {
  id: string;
  similarity: number | null;
  verdict: string | null; // conflict/duplicate/complementary — null when failed
  rationale: string | null;
  /** Verdict stands; the moderation gate suppressed its explanation. */
  rationaleWithheld?: boolean;
  /** model_error | parse_fail | bad_verdict — set only when status is failed. */
  failureReason?: string | null;
  attempts?: number;
  retriesLeft?: number;
  lastAttemptAt?: string | null;
  status: string; // pending/resolved/dismissed/failed
  resolution: string | null;
  detectedAt: string;
  resolvedAt: string | null;
  docA: ConflictDoc | null;
  docB: ConflictDoc | null;
}

export interface ScanResult {
  scanned: number;
  candidates: number;
  judged: number;
  conflicts: number;
  failed: number;
  withheld: number;
}

export interface DocumentRevision {
  id: string;
  revisionNo: number;
  title: string;
  category: string | null;
  changedFields: string[];
  /** baseline | create | update | restore | delete */
  changeKind: string;
  actorUserId: string | null;
  restoredFrom: number | null;
  createdAt: string;
}

/** Detail adds the snapshotted body; lists omit it. */
export interface DocumentRevisionDetail extends DocumentRevision {
  content: string | null;
  sourceUrl: string | null;
  effectiveFrom: string | null;
  reviewIntervalDays: number | null;
  active: number;
}

export interface DocumentListParams {
  page: number;
  size: number;
  category?: string;
  group?: string;
  /** Restrict to one knowledge source's documents (conversion-history modal). */
  sourceId?: string;
  // Server-side filters/sort (PLN-260826-KB-Documents-List-UI).
  /** '1' visible only | '0' hidden only. */
  active?: string;
  source?: string;
  status?: string;
  sort?: 'title' | 'updated';
  order?: 'asc' | 'desc';
}

/** One sync run from the audit log (PLN-260828). `result` carries the counts
 * (created/updated/…, dropped/truncated/embedded, error) as recorded. */
export interface SourceRun {
  at: string;
  actorId: number | null;
  status: string; // ok | failed
  result: Partial<SyncResult> & Record<string, unknown>;
}

/** Distinct values present for this tenant — filter select options. */
export interface DocumentFacets {
  sources: string[];
  statuses: string[];
}

export const knowledgeService = {
  sources: () => apiGet<KnowledgeSource[]>('/knowledge/sources'),
  gdriveCredential: () => apiGet<GdriveCredentialStatus>('/knowledge/gdrive/credential'),
  saveGdriveCredential: (keyJson: string) =>
    apiPut<{ clientEmail: string }>('/knowledge/gdrive/credential', { key_json: keyJson }),
  deleteGdriveCredential: () => apiDelete<{ removed: boolean }>('/knowledge/gdrive/credential'),
  testGdrive: (folderId?: string) =>
    apiPost<GdriveTestResult>('/knowledge/gdrive/test', { folder_id: folderId }),
  notionCredential: () => apiGet<NotionCredentialStatus>('/knowledge/notion/credential'),
  saveNotionCredential: (token: string) =>
    apiPut<{ hint: string }>('/knowledge/notion/credential', { token }),
  deleteNotionCredential: () => apiDelete<{ removed: boolean }>('/knowledge/notion/credential'),
  testNotion: (targetId?: string) =>
    apiPost<NotionTestResult>('/knowledge/notion/test', { target_id: targetId }),
  createSource: (body: { name: string; type: string; config_json?: Record<string, unknown> }) =>
    apiPost<KnowledgeSource>('/knowledge/sources', body),
  setSourceStatus: (id: string, status: 'active' | 'inactive') =>
    apiPatch<KnowledgeSource>(`/knowledge/sources/${id}`, { status }),
  /** Deletes the source; its documents are deactivated, not deleted (PLN-260829). */
  deleteSource: (id: string) =>
    apiDelete<{ deleted: boolean; deactivatedDocuments: number }>(`/knowledge/sources/${id}`),
  syncSource: (id: string) => apiPost<SyncResult>(`/knowledge/sources/${id}/sync`, {}),
  documents: (params: DocumentListParams): Promise<Paginated<KnowledgeDocument>> =>
    apiGetList<KnowledgeDocument>('/knowledge/documents', {
      page: params.page,
      size: params.size,
      ...(params.category ? { category: params.category } : {}),
      ...(params.group ? { group: params.group } : {}),
      ...(params.sourceId ? { source_id: params.sourceId } : {}),
      ...(params.active ? { active: params.active } : {}),
      ...(params.source ? { source: params.source } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.sort ? { sort: params.sort, order: params.order ?? 'asc' } : {}),
    }),
  documentFacets: (): Promise<DocumentFacets> =>
    apiGet<DocumentFacets>('/knowledge/documents/facets'),
  /** Sync-run history of one source, newest first (PLN-260828). */
  sourceRuns: (id: string, limit = 20): Promise<SourceRun[]> =>
    apiGet<SourceRun[]>(`/knowledge/sources/${id}/runs`, { limit }),
  document: (id: string) => apiGet<KnowledgeDocumentDetail>(`/knowledge/documents/${id}`),
  createDocument: (body: {
    title: string;
    category: string;
    content: string;
    source_id?: number;
    /** counsel (default) | product | operation — the group tab the operator was on. */
    doc_group?: string;
    /** Where the answer came from (e.g. the conversation it was written from). */
    source_url?: string;
  }) =>
    apiPost<KnowledgeDocumentDetail>('/knowledge/documents', body),
  updateDocument: (
    id: string,
    body: {
      title?: string;
      category?: string;
      content?: string;
      active?: number;
      // snake_case: request DTOs are snake_case by convention.
      source_url?: string | null;
      effective_from?: string | null;
      review_interval_days?: number | null;
    },
  ) => apiPatch<KnowledgeDocumentDetail>(`/knowledge/documents/${id}`, body),
  markReviewed: (id: string) =>
    apiPost<KnowledgeDocumentDetail>(`/knowledge/documents/${id}/reviewed`, {}),
  deleteDocument: (id: string) => apiDelete<{ deleted: true }>(`/knowledge/documents/${id}`),
  categories: (group?: string) =>
    apiGet<CategoryCount[]>('/knowledge/categories/counts', group ? { group } : undefined),
  importProducts: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    // Left to the browser on purpose: setting Content-Type by hand drops the
    // multipart boundary and the server sees an empty body.
    return apiPostForm<ProductImportResult>('/knowledge/documents/import/product', form);
  },
  ingestFile: (file: File, docGroup: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('doc_group', docGroup);
    return apiPostForm<IngestJob>('/knowledge/ingest/file', form);
  },
  ingestVideo: (videoUrl: string, docGroup: string) =>
    apiPost<IngestJob>('/knowledge/ingest/video', { video_url: videoUrl, doc_group: docGroup }),
  ingestStatus: () => apiGet<IngestJob | null>('/knowledge/ingest/status'),
  approveIngest: (articles: Array<{ title: string; category: string; content: string }>) =>
    apiPost<IngestApproveResult>('/knowledge/ingest/approve', { articles }),
  bulkImport: (file: File, docGroup: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('doc_group', docGroup);
    return apiPostForm<BulkImportResult>('/knowledge/documents/import/bulk', form);
  },
  /** Download → edit → bulkImport round-trip (PLN-260903). */
  exportDocuments: async (docGroup: string, format: 'csv' | 'xlsx') => {
    const { blob, filename } = await apiGetBlob('/knowledge/documents/export', {
      doc_group: docGroup,
      format,
    });
    saveBlob(blob, filename ?? `kb-${docGroup}.${format}`);
  },
  previewCatalogSync: () =>
    apiGet<CatalogSyncPreview>('/knowledge/documents/import/catalog/preview'),
  syncCatalog: () => apiPost<CatalogSyncJob>('/knowledge/documents/import/catalog', {}),
  catalogSyncStatus: () =>
    apiGet<CatalogSyncJob | null>('/knowledge/documents/import/catalog/status'),
  proposals: (status = 'pending') =>
    apiGet<AnswerProposal[]>('/knowledge/proposals', { status }),
  approveProposal: (id: string, body: { title?: string; category?: string; answer?: string }) =>
    apiPost<AnswerProposal>(`/knowledge/proposals/${id}/approve`, body),
  rejectProposal: (id: string, reason: string) =>
    apiPost<AnswerProposal>(`/knowledge/proposals/${id}/reject`, { reason }),
  usageGuides: () => apiGet<UsageGuide[]>('/knowledge/usage-guides'),
  usageTypes: () => apiGet<UsageType[]>('/knowledge/usage-types'),
  createUsageType: (body: { label: string; keywords: string[] }) =>
    apiPost<UsageType>('/knowledge/usage-types', body),
  updateUsageType: (id: string, body: { label?: string; keywords?: string[]; active?: boolean }) =>
    apiPut<UsageType>(`/knowledge/usage-types/${id}`, body),
  reorderUsageTypes: (ids: string[]) =>
    apiPut<{ reordered: number }>('/knowledge/usage-types/reorder', { ids: ids.map(Number) }),
  previewUsageType: (keywords: string[], excludeId?: string) =>
    apiPost<UsageTypePreview>('/knowledge/usage-types/preview', {
      keywords,
      ...(excludeId ? { exclude_id: Number(excludeId) } : {}),
    }),
  categoryRows: (group: string) => apiGet<KbCategoryRow[]>('/knowledge/categories', { group }),
  createCategory: (body: { name: string; label?: string; doc_group: string }) =>
    apiPost<KbCategoryRow>('/knowledge/categories', body),
  renameCategory: (id: string, name: string) =>
    apiPut<KbCategoryRow>(`/knowledge/categories/${id}/rename`, { name }),
  mergeCategories: (fromIds: string[], intoId: string) =>
    apiPost<{ moved: number }>('/knowledge/categories/merge', {
      from_ids: fromIds.map(Number),
      into_id: Number(intoId),
    }),
  setCategoryAgents: (id: string, agentIds: number[]) =>
    apiPut<KbCategoryRow>(`/knowledge/categories/${id}/agents`, { agent_ids: agentIds }),
  setCategoryHidden: (id: string, hidden: boolean) =>
    apiPut<KbCategoryRow>(`/knowledge/categories/${id}/hidden`, { hidden }),
  setCategoryGuestVisible: (id: string, guestVisible: boolean) =>
    apiPut<KbCategoryRow>(`/knowledge/categories/${id}/guest-visible`, {
      guest_visible: guestVisible,
    }),
  removeCategory: (id: string) =>
    apiDelete<{ removed: boolean }>(`/knowledge/categories/${id}`),
  saveUsageGuide: (key: string, body: { title: string; content: string }) =>
    apiPut<{ id: string; embedded: number; embedFailed: number }>(
      `/knowledge/usage-guides/${key}`,
      body,
    ),
  ask: (question: string, language: string, aiAgentId?: number | null) =>
    apiPost<KnowledgeAnswer>('/knowledge/ask', {
      question,
      language,
      // Omitted = answer from everything the tenant has, which is what an
      // operator managing the knowledge base needs to see.
      ...(aiAgentId ? { ai_agent_id: aiAgentId } : {}),
    }),
  conflicts: (params: { status?: string; page: number; size: number }) =>
    apiGetList<KnowledgeConflict>('/knowledge/conflicts', params),
  scanConflicts: () => apiPost<ScanResult>('/knowledge/conflicts/scan', {}),
  resolveConflict: (id: string, resolution: 'kept_a' | 'kept_b' | 'kept_both') =>
    apiPost<KnowledgeConflict>(`/knowledge/conflicts/${id}/resolve`, { resolution }),
  dismissConflict: (id: string) =>
    apiPost<KnowledgeConflict>(`/knowledge/conflicts/${id}/dismiss`, {}),
  retryConflict: (id: string) =>
    apiPost<KnowledgeConflict>(`/knowledge/conflicts/${id}/retry`, {}),
  rejudgeConflict: (id: string) =>
    apiPost<KnowledgeConflict>(`/knowledge/conflicts/${id}/rejudge`, {}),
  revisions: (documentId: string) =>
    apiGet<DocumentRevision[]>(`/knowledge/documents/${documentId}/revisions`),
  revision: (documentId: string, revisionId: string) =>
    apiGet<DocumentRevisionDetail>(`/knowledge/documents/${documentId}/revisions/${revisionId}`),
  restoreRevision: (documentId: string, revisionId: string) =>
    apiPost<KnowledgeDocumentDetail>(
      `/knowledge/documents/${documentId}/revisions/${revisionId}/restore`,
      {},
    ),
};
