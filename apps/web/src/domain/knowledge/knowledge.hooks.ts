import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { knowledgeService } from './knowledge.service';
import type { CatalogSyncJob, DocumentListParams } from './knowledge.service';
import { toast } from '@/store/toast-store';
import { useTenantKey } from '@/lib/use-tenant-key';

export function useSources() {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['knowledge', tenantKey, 'sources'],
    queryFn: () => knowledgeService.sources(),
  });
}

export function useCreateSource() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (body: { name: string; type: string; config_json?: Record<string, unknown> }) =>
      knowledgeService.createSource(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'sources'] });
      toast.success('Source added');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useSetSourceStatus() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (vars: { id: string; status: 'active' | 'inactive' }) =>
      knowledgeService.setSourceStatus(vars.id, vars.status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'sources'] });
      toast.success('Source updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/**
 * Delete a source (PLN-260829 P1-1). Its documents are deactivated server-side,
 * so the document/category lists move too — invalidate all three.
 */
export function useDeleteSource() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const { t } = useTranslation('knowledge');
  return useMutation({
    mutationFn: (id: string) => knowledgeService.deleteSource(id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'sources'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'documents'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'categories'] });
      toast.success(t('sourceDeleted', { count: r.deactivatedDocuments }));
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/** Drive service-account key: status, registration, removal, connection test. */
export function useGdriveCredential() {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['knowledge', tenantKey, 'gdrive-credential'],
    queryFn: () => knowledgeService.gdriveCredential(),
  });
}

export function useSaveGdriveCredential() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const { t } = useTranslation('knowledge');
  return useMutation({
    mutationFn: (keyJson: string) => knowledgeService.saveGdriveCredential(keyJson),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'gdrive-credential'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'sources'] });
      // Echo the address, because sharing the folder with it is the next step
      // and nothing else on screen says what it is.
      toast.success(t('gdriveConnectedAs', { email: r.clientEmail }));
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteGdriveCredential() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const { t } = useTranslation('knowledge');
  return useMutation({
    mutationFn: () => knowledgeService.deleteGdriveCredential(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'gdrive-credential'] });
      toast.success(t('gdriveRemoved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useTestGdrive() {
  return useMutation({
    mutationFn: (folderId?: string) => knowledgeService.testGdrive(folderId),
    // A failed check is a result, not a request error: the message explains
    // which half is wrong (key or folder sharing).
    onSuccess: (r) => (r.ok ? toast.success(r.message) : toast.error(r.message)),
    onError: (err: Error) => toast.error(err.message),
  });
}

/** Notion token: status, registration, removal, connection test. */
export function useNotionCredential() {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['knowledge', tenantKey, 'notion-credential'],
    queryFn: () => knowledgeService.notionCredential(),
  });
}

export function useSaveNotionCredential() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const { t } = useTranslation('knowledge');
  return useMutation({
    mutationFn: (token: string) => knowledgeService.saveNotionCredential(token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'notion-credential'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'sources'] });
      // No address to echo the way Drive has one; connecting the target to the
      // integration is the next step, so the toast points at that instead.
      toast.success(t('notionSaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteNotionCredential() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const { t } = useTranslation('knowledge');
  return useMutation({
    mutationFn: () => knowledgeService.deleteNotionCredential(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'notion-credential'] });
      toast.success(t('notionRemoved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useTestNotion() {
  return useMutation({
    mutationFn: (targetId?: string) => knowledgeService.testNotion(targetId),
    // A failed check is a result, not a request error: the message says which
    // half is wrong — the token, or the target nobody connected.
    onSuccess: (r) => (r.ok ? toast.success(r.message) : toast.error(r.message)),
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useSyncSource() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const { t } = useTranslation('knowledge');
  return useMutation({
    mutationFn: (id: string) => knowledgeService.syncSource(id),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'sources'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'documents'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'categories'] });
      // Same reasoning as the CSV import: a bare "synced" hides the rows that
      // came back but never got indexed.
      const parts = [
        t('syncCreated', { count: r.created }),
        t('syncUpdated', { count: r.updated }),
      ];
      if (r.skipped) parts.push(t('syncUnchanged', { count: r.skipped }));
      if (r.hidden) parts.push(t('syncHidden', { count: r.hidden }));
      if (r.failed) parts.push(t('syncFailed', { count: r.failed }));
      if (r.embedFailed) parts.push(t('syncNotIndexed', { count: r.embedFailed }));
      // A run that left pages behind, or stored them half-read, is not a
      // success however tidy the rest of the counts look.
      if (r.dropped) parts.push(t('syncNotConverted', { count: r.dropped }));
      if (r.truncated) parts.push(t('syncPartial', { count: r.truncated }));
      const incomplete = !!(r.failed || r.embedFailed || r.dropped || r.truncated);
      toast[incomplete ? 'error' : 'success'](t('syncSummary', { detail: parts.join(', ') }));
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDocuments(params: DocumentListParams) {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['knowledge', tenantKey, 'documents', params],
    queryFn: () => knowledgeService.documents(params),
    placeholderData: keepPreviousData,
  });
}

/** Sync-run history for the conversion-history modal (PLN-260828). */
export function useSourceRuns(id: string | null) {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['knowledge', tenantKey, 'source-runs', id],
    queryFn: () => knowledgeService.sourceRuns(id as string),
    enabled: !!id,
  });
}

/** Filter-select options — distinct source/status values for this tenant. */
export function useDocumentFacets() {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['knowledge', tenantKey, 'document-facets'],
    queryFn: () => knowledgeService.documentFacets(),
    staleTime: 5 * 60_000,
  });
}

export function useDocument(id: string | null) {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['knowledge', tenantKey, 'document', id],
    queryFn: () => knowledgeService.document(id as string),
    enabled: id !== null,
  });
}

export function useCategories(group?: string) {
  const tenantKey = useTenantKey();
  return useQuery({
    // group is part of the key: without it, switching groups would serve the
    // previous group's category counts from cache.
    queryKey: ['knowledge', tenantKey, 'categories', group ?? 'all'],
    queryFn: () => knowledgeService.categories(group),
  });
}

/** Ask the KB a question. A mutation, not a query: it runs on demand only. */
export function useAskKnowledge() {
  return useMutation({
    mutationFn: (vars: { question: string; language: string; aiAgentId?: number | null }) =>
      knowledgeService.ask(vars.question, vars.language, vars.aiAgentId),
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useCreateDocument() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (body: {
      title: string;
      category: string;
      content: string;
      source_id?: number;
      doc_group?: string;
      source_url?: string;
    }) => knowledgeService.createDocument(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'documents'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'categories'] });
      toast.success('Document added');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useUpdateDocument() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (vars: {
      id: string;
      body: {
        title?: string;
        category?: string;
        content?: string;
        active?: number;
        source_url?: string | null;
        video_ref?: string | null;
        effective_from?: string | null;
        review_interval_days?: number | null;
      };
    }) => knowledgeService.updateDocument(vars.id, vars.body),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'documents'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'categories'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'document', vars.id] });
      toast.success('Document updated');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDeleteDocument() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (id: string) => knowledgeService.deleteDocument(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'documents'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'categories'] });
      toast.success('Document deleted');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useMarkReviewed() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (id: string) => knowledgeService.markReviewed(id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'documents'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'document', id] });
      toast.success('Marked as reviewed');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/** Conflict review queue (PLN S4). */
export function useConflicts(params: { status?: string; page: number; size: number }) {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['knowledge', tenantKey, 'conflicts', params],
    queryFn: () => knowledgeService.conflicts(params),
  });
}

export function useScanConflicts() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: () => knowledgeService.scanConflicts(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'conflicts'] });
      // The count matters: "scan finished" with nothing found reads as a
      // failure otherwise.
      // Report failures too: "scan complete" with pairs quietly dropped reads
      // as success when it is not.
      const parts = [`${r.conflicts} conflict(s) from ${r.candidates} candidate pair(s)`];
      if (r.failed > 0) parts.push(`${r.failed} unjudged`);
      if (r.withheld > 0) parts.push(`${r.withheld} rationale(s) withheld`);
      toast.success(`Scan complete — ${parts.join(', ')}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useResolveConflict() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (vars: { id: string; resolution: 'kept_a' | 'kept_b' | 'kept_both' }) =>
      knowledgeService.resolveConflict(vars.id, vars.resolution),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'conflicts'] });
      // Resolving hides a document, so the list and category counts move too.
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'documents'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'categories'] });
      toast.success('Conflict resolved');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useDismissConflict() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (id: string) => knowledgeService.dismissConflict(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'conflicts'] });
      toast.success('Dismissed');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useRetryConflict() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (id: string) => knowledgeService.retryConflict(id),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'conflicts'] });
      toast[c.status === 'failed' ? 'error' : 'success'](
        c.status === 'failed' ? `Still failing (${c.failureReason})` : 'Judged',
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useRejudgeConflict() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (id: string) => knowledgeService.rejudgeConflict(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'conflicts'] });
      toast.success('Re-judged');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/** Change history for one document (PLN T3). */
export function useRevisions(documentId: string | null) {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['knowledge', tenantKey, 'revisions', documentId],
    queryFn: () => knowledgeService.revisions(documentId as string),
    enabled: !!documentId,
  });
}

export function useRevision(documentId: string | null, revisionId: string | null) {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['knowledge', tenantKey, 'revision', documentId, revisionId],
    queryFn: () => knowledgeService.revision(documentId as string, revisionId as string),
    enabled: !!documentId && !!revisionId,
  });
}

export function useRestoreRevision() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (vars: { documentId: string; revisionId: string }) =>
      knowledgeService.restoreRevision(vars.documentId, vars.revisionId),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'documents'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'document', vars.documentId] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'revisions', vars.documentId] });
      toast.success('Restored');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/** Dry run of the catalogue → knowledge conversion (PLN-260807 P1). */
export function useCatalogSyncPreview(enabled: boolean) {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['knowledge', tenantKey, 'catalog-preview'],
    queryFn: () => knowledgeService.previewCatalogSync(),
    // Only while the dialog is open, and never from cache: the plan is only
    // meaningful against the catalogue as it stands right now.
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

/**
 * Live progress of the conversion. Polls only while a run is in flight — the
 * job is minutes long, so the console must show movement rather than a spinner
 * that used to end in a 504 (RPT-260808 D3).
 */
export function useCatalogSyncStatus(enabled: boolean) {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['knowledge', tenantKey, 'catalog-status'],
    queryFn: () => knowledgeService.catalogSyncStatus(),
    enabled,
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 2000 : false),
    staleTime: 0,
    gcTime: 0,
  });
}

/** Start the catalogue conversion (PLN-260807 P1). Returns once the job is queued. */
export function useSyncCatalog() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: () => knowledgeService.syncCatalog(),
    onSuccess: () => {
      // Nothing has changed yet — the run has only started. The status poll
      // reports the outcome, and invalidation happens when it finishes.
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'catalog-status'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/** Refresh the document lists once a run finishes, and say how it went. */
export function useCatalogSyncCompletion(job: CatalogSyncJob | null | undefined) {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (!job || job.status === 'running' || seen.current === job.id) return;
    seen.current = job.id;
    if (job.status === 'failed') {
      toast.error(job.error ?? 'Catalog sync failed');
      return;
    }
    if (job.status !== 'succeeded' || !job.result) return;
    qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'documents'] });
    qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'categories'] });
    const r = job.result;
    const parts = [`${r.created} created`, `${r.updated} updated`];
    if (r.curatedKept) parts.push(`${r.curatedKept} curated kept`);
    if (r.held) parts.push(`${r.held} held`);
    if (r.embedFailed) parts.push(`${r.embedFailed} not indexed`);
    toast[r.embedFailed ? 'error' : 'success'](`Catalog sync: ${parts.join(', ')}`);
  }, [job, qc, tenantKey]);
}

/** Answer proposals awaiting a knowledge owner's decision (PLN-260810 S4). */
export function useProposals(status = 'pending') {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['knowledge', tenantKey, 'proposals', status],
    queryFn: () => knowledgeService.proposals(status),
  });
}

/** Approve or reject a proposal. Approval creates and indexes the document. */
export function useProposalDecision() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'proposals'] });
    qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'documents'] });
  };
  const approve = useMutation({
    mutationFn: (v: { id: string; title?: string; category?: string; answer?: string }) =>
      knowledgeService.approveProposal(v.id, { title: v.title, category: v.category, answer: v.answer }),
    onSuccess: () => {
      invalidate();
      toast.success('Approved — the answer is now searchable');
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const reject = useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      knowledgeService.rejectProposal(v.id, v.reason),
    onSuccess: () => {
      invalidate();
      toast.success('Rejected — the reason is shown to whoever proposed it');
    },
    onError: (err: Error) => toast.error(err.message),
  });
  return { approve, reject };
}

/** Usage guides per product type, written or not (PLN-260807 P2). */
export function useUsageGuides() {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['knowledge', tenantKey, 'usage-guides'],
    queryFn: () => knowledgeService.usageGuides(),
  });
}

/** Write one usage guide. It is indexed on save, so the toast can promise it. */
export function useSaveUsageGuide() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (v: { key: string; title: string; content: string }) =>
      knowledgeService.saveUsageGuide(v.key, { title: v.title, content: v.content }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'usage-guides'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'documents'] });
      if (r.embedFailed) toast.error('Saved, but not indexed — retry to make it searchable');
      else toast.success('Usage guide saved');
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/** Product catalogue CSV import (PLN-260804 P3). */
export function useImportProducts() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (file: File) => knowledgeService.importProducts(file),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'documents'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'categories'] });
      // Report what happened, not just that it finished: "imported" with 144
      // rows silently skipped reads as success when it is not.
      const parts = [`${r.created} created`, `${r.updated} updated`];
      if (r.skipped) parts.push(`${r.skipped} unchanged`);
      if (r.invalid) parts.push(`${r.invalid} skipped`);
      if (r.embedFailed) parts.push(`${r.embedFailed} not indexed`);
      toast[r.invalid || r.embedFailed ? 'error' : 'success'](`Import: ${parts.join(', ')}`);
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/**
 * Counsel/operation bulk import (PLN-260828 D3). Toasts live in the modal —
 * it knows the target group and localizes the five file-level error codes.
 */
export function useBulkImport() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (vars: { file: File; docGroup: string }) =>
      knowledgeService.bulkImport(vars.file, vars.docGroup),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'documents'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'categories'] });
    },
  });
}

/**
 * Bulk export (PLN-260903). The saved file IS the success feedback (dev-kit
 * §4.3 self-evident exemption); only failure needs a toast.
 */
export function useBulkExport() {
  return useMutation({
    mutationFn: (vars: { docGroup: string; format: 'csv' | 'xlsx' }) =>
      knowledgeService.exportDocuments(vars.docGroup, vars.format),
    onError: (err: Error) => toast.error(err.message),
  });
}

// ---- AI ingest (PLN-260829 3차) ----

/** Start analyzing an uploaded file. Toasts live in the modal (it localizes codes). */
export function useIngestFile() {
  return useMutation({
    mutationFn: (v: { file: File; docGroup: string }) =>
      knowledgeService.ingestFile(v.file, v.docGroup),
  });
}

export function useIngestVideo() {
  return useMutation({
    mutationFn: (v: { url: string; docGroup: string }) =>
      knowledgeService.ingestVideo(v.url, v.docGroup),
  });
}

/** Poll while the modal is open and a run is live; idle otherwise. */
export function useIngestStatus(enabled: boolean) {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['knowledge', tenantKey, 'ingest-status'],
    queryFn: () => knowledgeService.ingestStatus(),
    enabled,
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? 1500 : false,
  });
}

export function useApproveIngest() {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (articles: Array<{ title: string; category: string; content: string }>) =>
      knowledgeService.approveIngest(articles),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'documents'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'categories'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'ingest-status'] });
    },
  });
}

// ---- Usage types (PLN-260824 A축) ----

export function useUsageTypes() {
  const tenantKey = useTenantKey();
  return useQuery({
    queryKey: ['knowledge', tenantKey, 'usage-types'],
    queryFn: () => knowledgeService.usageTypes(),
  });
}

/**
 * Both lists move together: a type's label and order are what the guide list
 * shows, so refreshing one and not the other leaves the screen disagreeing
 * with itself.
 */
function useTaxonomyInvalidator(kind: 'usage-types' | 'categories') {
  const qc = useQueryClient();
  const tenantKey = useTenantKey();
  return () => {
    qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, kind] });
    if (kind === 'usage-types') {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'usage-guides'] });
    } else {
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'documents'] });
      qc.invalidateQueries({ queryKey: ['knowledge', tenantKey, 'category-counts'] });
    }
  };
}

export function useSaveUsageType() {
  const invalidate = useTaxonomyInvalidator('usage-types');
  const { t } = useTranslation('knowledge');
  return useMutation({
    mutationFn: (v: { id?: string; label: string; keywords: string[]; active?: boolean }) =>
      v.id
        ? knowledgeService.updateUsageType(v.id, {
            label: v.label,
            keywords: v.keywords,
            active: v.active,
          })
        : knowledgeService.createUsageType({ label: v.label, keywords: v.keywords }),
    onSuccess: () => {
      invalidate();
      toast.success(t('usageTypeSaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useReorderUsageTypes() {
  const invalidate = useTaxonomyInvalidator('usage-types');
  const { t } = useTranslation('knowledge');
  return useMutation({
    mutationFn: (ids: string[]) => knowledgeService.reorderUsageTypes(ids),
    onSuccess: () => {
      invalidate();
      toast.success(t('usageTypeReordered'));
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

/**
 * Live match count while the operator types keywords.
 *
 * A wrong keyword fails silently — it matches nothing, and "0 products" reads
 * the same as "this catalogue has none of those". This is the only place that
 * distinction is cheap to make (PLN D2), so it is a mutation the editor fires
 * on change rather than something hidden behind a save.
 */
export function usePreviewUsageType() {
  return useMutation({
    mutationFn: (v: { keywords: string[]; excludeId?: string }) =>
      knowledgeService.previewUsageType(v.keywords, v.excludeId),
  });
}

// ---- Categories (PLN-260824 B축) ----

export function useCategoryRows(group: string) {
  const tenantKey = useTenantKey();
  return useQuery({
    // Group in the key: each manager tab is its own list (PLN-260829 D2-a).
    queryKey: ['knowledge', tenantKey, 'categories', group],
    queryFn: () => knowledgeService.categoryRows(group),
  });
}

export function useCreateCategory() {
  const invalidate = useTaxonomyInvalidator('categories');
  const { t } = useTranslation('knowledge');
  return useMutation({
    mutationFn: (v: { name: string; label?: string; doc_group: string }) =>
      knowledgeService.createCategory(v),
    onSuccess: () => {
      invalidate();
      toast.success(t('categorySaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useRenameCategory() {
  const invalidate = useTaxonomyInvalidator('categories');
  const { t } = useTranslation('knowledge');
  return useMutation({
    mutationFn: (v: { id: string; name: string }) =>
      knowledgeService.renameCategory(v.id, v.name),
    onSuccess: () => {
      invalidate();
      toast.success(t('categoryRenamed'));
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useMergeCategories() {
  const invalidate = useTaxonomyInvalidator('categories');
  const { t } = useTranslation('knowledge');
  return useMutation({
    mutationFn: (v: { fromIds: string[]; intoId: string }) =>
      knowledgeService.mergeCategories(v.fromIds, v.intoId),
    onSuccess: (res) => {
      invalidate();
      toast.success(t('categoryMerged', { count: res.moved }));
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useSetCategoryAgents() {
  const invalidate = useTaxonomyInvalidator('categories');
  const { t } = useTranslation('knowledge');
  return useMutation({
    mutationFn: (v: { id: string; agentIds: number[] }) =>
      knowledgeService.setCategoryAgents(v.id, v.agentIds),
    onSuccess: () => {
      invalidate();
      toast.success(t('categoryAgentsSaved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useSetCategoryHidden() {
  const invalidate = useTaxonomyInvalidator('categories');
  const { t } = useTranslation('knowledge');
  return useMutation({
    mutationFn: (v: { id: string; hidden: boolean }) =>
      knowledgeService.setCategoryHidden(v.id, v.hidden),
    onSuccess: (_res, v) => {
      invalidate();
      toast.success(v.hidden ? t('categoryHidden') : t('categoryShown'));
    },
    onError: (err: Error) => toast.error(err.message),
  });
}

export function useRemoveCategory() {
  const invalidate = useTaxonomyInvalidator('categories');
  const { t } = useTranslation('knowledge');
  return useMutation({
    mutationFn: (id: string) => knowledgeService.removeCategory(id),
    onSuccess: () => {
      invalidate();
      toast.success(t('categoryRemoved'));
    },
    onError: (err: Error) => toast.error(err.message),
  });
}
