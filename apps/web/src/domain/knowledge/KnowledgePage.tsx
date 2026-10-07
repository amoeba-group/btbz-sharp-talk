import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Badge } from '@/components/Badge';
import { StatusBadge } from '@/components/StatusBadge';
import { Table } from '@/components/Table';
import type { Column } from '@/components/Table';
import { Modal } from '@/components/Modal';
import { knowledgeService } from './knowledge.service';
import type { UsageGuide, UsageType } from './knowledge.service';
import { Progress } from '@/components/Progress';
import { Pagination } from '@/components/Pagination';
import { FormRow, Input, Select } from '@/components/Field';
import { ArrowDown, ArrowUp, ExternalLink, MoreHorizontal, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { toast } from '@/store/toast-store';
import { KnowledgeQaPanel } from './KnowledgeQaPanel';
import { AiIngestModal } from './AiIngestModal';
import {
  AddDocumentHelp,
  CatalogSyncHelp,
  ProcessGuide,
  ProductCsvHelp,
  KNOWLEDGE_SECTION,
  StepNo,
} from './KnowledgeGuides';
import { SourceCredentialCard } from './SourceCredentialCard';
import { UsageTypeEditor } from './UsageTypeEditor';
import { CategoryManagerCard } from './CategoryManagerCard';
import { SourceHistoryModal } from './SourceHistoryModal';
import { GapTasksSection } from './GapTasksSection';
import { BoardCard } from './BoardCard';
import { useKnowledgeSettings } from '@/domain/settings/settings.hooks';
import { ConflictReview } from './ConflictReview';
import { RevisionHistory } from './RevisionHistory';
import {
  useMarkReviewed,
  useCategories,
  useSources,
  useCreateSource,
  useSetSourceStatus,
  useSyncSource,
  useGdriveCredential,
  useSaveGdriveCredential,
  useDeleteGdriveCredential,
  useTestGdrive,
  useNotionCredential,
  useSaveNotionCredential,
  useDeleteNotionCredential,
  useTestNotion,
  useDocuments,
  useDocumentFacets,
  useDocument,
  useCreateDocument,
  useImportProducts,
  useDeleteSource,
  useBulkImport,
  useBulkExport,
  useCatalogSyncPreview,
  useSyncCatalog,
  useCatalogSyncStatus,
  useCatalogSyncCompletion,
  useUsageGuides,
  useUsageTypes,
  useReorderUsageTypes,
  useCategoryRows,
  useProposals,
  useProposalDecision,
  useSaveUsageGuide,
  useUpdateDocument,
  useDeleteDocument,
} from './knowledge.hooks';
import type { KnowledgeSource, KnowledgeDocument } from './knowledge.service';

const PAGE_SIZE = 20;
/**
 * Source types the console offers; the API decides which can actually ingest.
 *
 * `repository` (GitHub) is deliberately absent: it was dropped from the roadmap
 * on 2026-08-24, and an option that can be picked but never ingests is worse
 * than no option — staging already holds a source an operator created that way.
 *
 * `board` is gone for a different reason (REQ-260826 R5). It was the internal
 * board, and it was this list's default: pick it, and you got a source no
 * console screen could ever write a post into. Five such sources exist on
 * staging and `kb_board_posts` has never held a row. Writing a post to turn it
 * into a document was a longer route to what "Add KB-Document" does directly.
 *
 * Both values stay in the API enum because rows created before this still carry
 * them, and the list renders `r.type` as stored rather than from this map.
 */
const SOURCE_TYPE = {
  GDRIVE: 'gdrive',
  NOTION: 'notion',
} as const;
type SourceType = (typeof SOURCE_TYPE)[keyof typeof SOURCE_TYPE];
const SOURCE_TYPES = Object.values(SOURCE_TYPE);
/**
 * Category suggestions come from the tenant now (PLN-260824 G8).
 *
 * There used to be nineteen hardcoded values here — IVY USA's policy tags,
 * offered to every tenant. Measured on staging, one tenant used eighteen of
 * them and an apparel tenant used exactly one, while its own eight categories
 * were nowhere in the list.
 */

export function KnowledgePage() {
  const { t } = useTranslation('knowledge');
  const navigate = useNavigate();
  const { t: tc } = useTranslation('common');
  const sources = useSources();
  const createSource = useCreateSource();
  const setSourceStatus = useSetSourceStatus();
  const syncSource = useSyncSource();
  const gdriveCred = useGdriveCredential();
  const saveGdriveCred = useSaveGdriveCredential();
  const deleteGdriveCred = useDeleteGdriveCredential();
  const testGdrive = useTestGdrive();
  const notionCred = useNotionCredential();
  const saveNotionCred = useSaveNotionCredential();
  const deleteNotionCred = useDeleteNotionCredential();
  const testNotion = useTestNotion();

  const [page, setPage] = useState(1);
  const [category, setCategory] = useState('');
  // '' = all groups. Switching groups clears the category, which belongs to the
  // group that was selected.
  const [group, setGroup] = useState('');
  // List filters + sort (PLN-260826-KB-Documents-List-UI). '' = no filter.
  // All applied server-side — the list is server-paginated, so sorting the
  // current page client-side would silently lie across pages.
  const [docActive, setDocActive] = useState('');
  const [docSource, setDocSource] = useState('');
  const [docStatus, setDocStatus] = useState('');
  const [docSort, setDocSort] = useState<'title' | 'updated' | null>(null);
  const [docOrder, setDocOrder] = useState<'asc' | 'desc'>('asc');
  const facets = useDocumentFacets();
  const setDocFilter = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setPage(1);
  };
  // Header click: none → asc → desc → none; picking one axis clears the other.
  const cycleSort = (axis: 'title' | 'updated') => {
    if (docSort !== axis) {
      setDocSort(axis);
      setDocOrder('asc');
    } else if (docOrder === 'asc') {
      setDocOrder('desc');
    } else {
      setDocSort(null);
      setDocOrder('asc');
    }
    setPage(1);
  };
  const documents = useDocuments({
    page,
    size: PAGE_SIZE,
    category: category || undefined,
    group: group || undefined,
    active: docActive || undefined,
    source: docSource || undefined,
    status: docStatus || undefined,
    sort: docSort ?? undefined,
    order: docSort ? docOrder : undefined,
  });
  // Which row's more-menu (⋯) is open, with the anchor rect: the panel is
  // position:fixed so the table's overflow container cannot clip it.
  const [moreFor, setMoreFor] = useState<{ id: string; top: number; right: number } | null>(null);
  useEffect(() => {
    if (!moreFor) return;
    const close = () => setMoreFor(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    // Click-away; the panel itself stops propagation.
    document.addEventListener('click', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('click', close);
    };
  }, [moreFor]);
  const createDocument = useCreateDocument();
  const updateDocument = useUpdateDocument();
  const deleteDocument = useDeleteDocument();
  const markReviewed = useMarkReviewed();

  // Always fetched ungrouped: the tab counts need every group, and the category
  // list is derived from the same rows.
  const categories = useCategories();
  // Explicit group select for Add KB-Document (PLN-260829 P1-7/D2-d).
  // Declared here because the category suggestions below follow it.
  const [docGroup, setDocGroup] = useState('counsel');
  const categoryRows = useCategoryRows(docGroup);
  const allCounts = categories.data ?? [];
  const groupTotals = allCounts.reduce<Record<string, number>>((acc, c) => {
    acc[c.group] = (acc[c.group] ?? 0) + c.total;
    return acc;
  }, {});
  const visibleCounts = group ? allCounts.filter((c) => c.group === group) : allCounts;
  // Same category name can appear under two groups; merge for display.
  const mergedCategories = Object.values(
    visibleCounts.reduce<Record<string, { category: string | null; total: number; active: number }>>(
      (acc, c) => {
        const k = c.category ?? '';
        acc[k] = acc[k]
          ? { ...acc[k], total: acc[k].total + c.total, active: acc[k].active + c.active }
          : { category: c.category, total: c.total, active: c.active };
        return acc;
      },
      {},
    ),
  ).sort((a, b) => b.total - a.total);
  const categoryTotal = visibleCounts.reduce((sum, c) => sum + c.total, 0);
  const selectGroup = (value: string) => {
    setGroup(value);
    setCategory('');
    setPage(1);
  };
  // What this tenant actually uses in that group, plus what it has registered
  // there (PLN-260829 D2-d) — a suggestion from another group would file the
  // document under a category that group does not own.
  const suggestionsFor = (g?: string) => [
    ...new Set([
      ...allCounts
        .filter((c) => !g || c.group === g)
        .map((c) => c.category)
        .filter((c): c is string => !!c),
      // Registered but not yet used: a category created for documents that have
      // not been filed yet would otherwise be impossible to pick. The rows are
      // fetched for the add-modal's group.
      ...(g === docGroup ? (categoryRows.data ?? []).filter((c) => !c.hidden).map((c) => c.name) : []),
    ]),
  ];
  const categorySuggestions = suggestionsFor(docGroup);
  const selectCategory = (value: string) => {
    setCategory(value);
    setPage(1);
  };

  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'content' | 'history'>('content');
  const detail = useDocument(detailId);
  // Edit mode for the detail modal — also entered directly from a QA source.
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editSourceUrl, setEditSourceUrl] = useState('');
  // The video this document explains (PLN-261006-KB-Video-Links).
  const [editVideoRef, setEditVideoRef] = useState('');
  const [editEffectiveFrom, setEditEffectiveFrom] = useState('');
  const [editReviewDays, setEditReviewDays] = useState('');

  // Load the fetched document into the edit fields whenever it changes.
  useEffect(() => {
    if (detail.data) {
      setEditTitle(detail.data.title);
      setEditCategory(detail.data.category ?? '');
      setEditContent(detail.data.content ?? '');
      setEditSourceUrl(detail.data.sourceUrl ?? '');
      setEditVideoRef(detail.data.videoRef ?? '');
      setEditEffectiveFrom(detail.data.effectiveFrom ?? '');
      setEditReviewDays(
        detail.data.reviewIntervalDays == null ? '' : String(detail.data.reviewIntervalDays),
      );
    }
  }, [detail.data]);

  // Deep link from a conversation transcript's grounding badge (?doc=<id>):
  // "which document produced this answer" has to land on the document itself,
  // not on page 1 of the list. Consumed once so closing the modal sticks.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const doc = searchParams.get('doc');
    if (!doc) return;
    setDetailId(doc);
    searchParams.delete('doc');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const closeDetail = () => {
    setDetailId(null);
    setEditing(false);
    setDetailTab('content');
  };

  const saveEdit = () => {
    if (!detail.data) return;
    updateDocument.mutate(
      {
        id: detail.data.id,
        body: {
          title: editTitle,
          category: editCategory,
          content: editContent,
          // Empty input clears the field rather than leaving a stale value —
          // null is a meaningful state for all three.
          source_url: editSourceUrl.trim() || null,
          video_ref: editVideoRef.trim() || null,
          effective_from: editEffectiveFrom || null,
          review_interval_days: editReviewDays.trim() === '' ? null : Number(editReviewDays),
        },
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  const [sourceOpen, setSourceOpen] = useState(false);
  // Conversion-history modal (PLN-260828): which source's history is open.
  const [historyFor, setHistoryFor] = useState<KnowledgeSource | null>(null);
  const [sourceName, setSourceName] = useState('');
  const [sourceType, setSourceType] = useState<SourceType>(SOURCE_TYPE.GDRIVE);
  const [folderId, setFolderId] = useState('');
  /** A Notion page/database id, or the share URL it was copied from. */
  const [notionTarget, setNotionTarget] = useState('');

  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const importProducts = useImportProducts();

  // AI import (PLN-260829 3차) — file/video → drafts → review → documents.
  const [aiImportOpen, setAiImportOpen] = useState(false);

  // Counsel/operation bulk upload (PLN-260828). The active tab is the target
  // group, so the modal never asks the operator to pick one.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const bulkImport = useBulkImport();

  // Bulk download (PLN-260903): same columns the importer accepts, so a
  // downloaded file re-uploads as a no-op until the operator edits it.
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const bulkExport = useBulkExport();
  const runExport = (format: 'csv' | 'xlsx') => {
    setExportMenuOpen(false);
    bulkExport.mutate({ docGroup: group, format });
  };
  const closeBulk = () => {
    setBulkOpen(false);
    setBulkFile(null);
    bulkImport.reset();
  };
  const runBulkImport = () => {
    if (!bulkFile) return;
    bulkImport.mutate(
      { file: bulkFile, docGroup: group },
      {
        onSuccess: (r) => {
          if (r.invalid || r.embedFailed) {
            toast.error(
              `${t('bulkImportDone', { created: r.created, updated: r.updated })} · ${t('importInvalid')} ${r.invalid + r.embedFailed}`,
            );
          } else {
            toast.success(t('bulkImportDone', { created: r.created, updated: r.updated }));
          }
        },
        onError: (err: Error & { code?: string }) => {
          // The five file-level rejections carry an Exxxx the UI localizes;
          // anything else falls back to the server's English message.
          const known = err.code && ['E5061', 'E5062', 'E5063', 'E5064', 'E5065'].includes(err.code);
          toast.error(known ? t(`bulkImportError.${err.code}`) : err.message);
        },
      },
    );
  };

  const [catalogOpen, setCatalogOpen] = useState(false);
  const catalogPreview = useCatalogSyncPreview(catalogOpen);
  const syncCatalog = useSyncCatalog();
  // Poll while the dialog is open OR a run is still in flight, so closing the
  // dialog does not orphan a job the operator started.
  const catalogJob = useCatalogSyncStatus(catalogOpen || syncCatalog.isSuccess);
  const job = catalogJob.data ?? null;
  const jobRunning = job?.status === 'running';
  useCatalogSyncCompletion(job);

  const proposals = useProposals();
  const proposalDecision = useProposalDecision();
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  // Usage guides are a shop feature switched on per tenant (PLN-260910 D-4);
  // while the switch is loading the section stays hidden rather than flashing.
  const knowledgeSettings = useKnowledgeSettings();
  const usageGuidesEnabled = knowledgeSettings.data?.usageGuidesEnabled === true;
  const usageGuides = useUsageGuides();
  const saveUsageGuide = useSaveUsageGuide();
  const usageTypes = useUsageTypes();
  const reorderTypes = useReorderUsageTypes();
  const [typeEditorOpen, setTypeEditorOpen] = useState(false);
  const [editingType, setEditingType] = useState<UsageType | null>(null);

  /**
   * Move one type past its neighbour. The whole order is sent rather than a
   * swap: the server stores positions, and reconciling two independent swaps
   * is not worth the round trip it saves.
   */
  const moveType = (index: number, delta: number) => {
    const ordered = (usageGuides.data ?? []).map((g) => g.id);
    const target = index + delta;
    if (target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    reorderTypes.mutate(ordered);
  };
  const [guideKey, setGuideKey] = useState<string | null>(null);
  const [guideTitle, setGuideTitle] = useState('');
  const [guideBody, setGuideBody] = useState('');
  const openGuide = async (g: UsageGuide) => {
    setGuideKey(g.key);
    setGuideTitle(g.title ?? g.label);
    setGuideBody('');
    // Editing starts from what is stored — a blank box would let a save
    // silently replace a written guide with whatever is typed next.
    if (g.documentId) {
      try {
        const doc = await knowledgeService.document(g.documentId);
        setGuideBody(doc.content ?? '');
      } catch {
        setGuideBody('');
      }
    }
  };
  // A run with nothing to create or update would still spend a round trip and
  // read as if something happened; the button says so instead.
  const nothingToApply =
    !!catalogPreview.data &&
    catalogPreview.data.created === 0 &&
    catalogPreview.data.updated === 0;

  const [docOpen, setDocOpen] = useState(false);
  const [docTitle, setDocTitle] = useState('');
  const [docCategory, setDocCategory] = useState('');
  const [docContent, setDocContent] = useState('');
  const openDoc = () => {
    setDocGroup(group || 'counsel');
    setDocOpen(true);
  };

  // Source deletion (PLN-260829 P1-1): two-step confirm; documents are
  // deactivated server-side, never deleted.
  const [sourceToDelete, setSourceToDelete] = useState<KnowledgeSource | null>(null);
  const deleteSource = useDeleteSource();

  const closeSource = () => {
    setSourceOpen(false);
    setSourceName('');
    setSourceType(SOURCE_TYPE.GDRIVE);
    setFolderId('');
    setNotionTarget('');
  };

  const saveSource = () => {
    createSource.mutate(
      {
        name: sourceName,
        type: sourceType,
        ...(sourceType === SOURCE_TYPE.GDRIVE ? { config_json: { folderId: folderId.trim() } } : {}),
        ...(sourceType === SOURCE_TYPE.NOTION ? { config_json: { targetId: notionTarget.trim() } } : {}),
      },
      { onSuccess: closeSource },
    );
  };

  const closeDoc = () => {
    setDocOpen(false);
    setDocTitle('');
    setDocCategory('');
    setDocContent('');
  };

  const saveDoc = () => {
    createDocument.mutate(
      { title: docTitle, category: docCategory, content: docContent, doc_group: docGroup },
      { onSuccess: closeDoc },
    );
  };

  const removeDoc = (id: string) => {
    if (window.confirm(t('deleteDocumentConfirm'))) {
      deleteDocument.mutate(id, { onSuccess: () => setDetailId(null) });
    }
  };

  const toggleActive = (doc: { id: string; active: number }) => {
    updateDocument.mutate({ id: doc.id, body: { active: doc.active === 1 ? 0 : 1 } });
  };

  const sourceColumns: Column<KnowledgeSource>[] = [
    {
      key: 'name',
      header: t('name'),
      // The name opens the conversion history — what this source turned into
      // knowledge, run by run (PLN-260828).
      render: (r) => (
        <button
          type="button"
          className="text-left font-medium text-primary-600 hover:underline"
          onClick={() => setHistoryFor(r)}
          title={t('history.open')}
        >
          {r.name}
        </button>
      ),
    },
    { key: 'type', header: t('type'), render: (r) => r.type },
    {
      key: 'status',
      header: t('status'),
      // A type with no adapter says so plainly. Showing it as "Enabled" is what
      // made operators believe a gdrive source was ingesting when nothing was.
      render: (r) =>
        r.supported === false ? (
          <Badge tone="warning">{t('sourceNotReady')}</Badge>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            disabled={setSourceStatus.isPending}
            onClick={() =>
              setSourceStatus.mutate({
                id: r.id,
                status: r.status === 'active' ? 'inactive' : 'active',
              })
            }
          >
            <Badge tone={r.status === 'active' ? 'success' : 'gray'}>
              {r.status === 'active' ? tc('enabled') : tc('disabled')}
            </Badge>
          </Button>
        ),
    },
    {
      key: 'lastSync',
      header: t('lastSync'),
      render: (r) => {
        if (!r.lastSyncAt) return <span className="text-gray-400">—</span>;
        const when = new Date(r.lastSyncAt).toLocaleString();
        const c = r.lastSyncResult;
        return (
          <div className="flex flex-col gap-0.5">
            <span className={r.lastSyncStatus === 'failed' ? 'text-error' : ''}>{when}</span>
            {c && (
              <span className="text-xs text-gray-500">
                {t('syncCounts', {
                  created: c.created,
                  updated: c.updated,
                  skipped: c.skipped,
                  hidden: c.hidden,
                })}
              </span>
            )}
            {/* A capped or half-read run must not look like a complete one. */}
            {!!c?.dropped && (
              <span className="text-xs text-error">{t('syncDropped', { count: c.dropped })}</span>
            )}
            {!!c?.truncated && (
              <span className="text-xs text-error">
                {t('syncTruncated', { count: c.truncated })}
              </span>
            )}
            {/* Why it failed (REQ-260828 B1) — a red timestamp alone sent the
                operator to us instead of to the actual fix. */}
            {!!c?.error && (
              <span className="max-w-md text-xs text-error" title={c.error}>
                {c.error}
              </span>
            )}
            {!!c?.error && /object_not_found|shared with your integration/i.test(c.error) && (
              <span className="max-w-md text-xs text-gray-500">{t('notionShareHint')}</span>
            )}
          </div>
        );
      },
    },
    {
      key: 'sync',
      header: t('sync'),
      render: (r) => (
        <Button
          variant="ghost"
          size="sm"
          disabled={r.supported === false || syncSource.isPending}
          title={r.supported === false ? t('sourceNotReadyHint') : undefined}
          onClick={() => syncSource.mutate(r.id)}
        >
          ↻
        </Button>
      ),
    },
    {
      key: 'createdAt',
      header: t('created'),
      render: (r) => (r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'),
    },
    {
      key: 'delete',
      header: '',
      className: 'w-10 text-right',
      render: (r) => (
        <button
          type="button"
          aria-label={t('deleteSource')}
          title={t('deleteSource')}
          onClick={() => setSourceToDelete(r)}
          className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ),
    },
  ];

  /** Clickable sort header: none → asc → desc → none (single axis). */
  const sortHeader = (axis: 'title' | 'updated', label: string) => (
    <button
      type="button"
      onClick={() => cycleSort(axis)}
      className="flex items-center gap-1 font-medium text-gray-600 hover:text-gray-800"
      aria-label={t('sortBy', { column: label })}
    >
      {label}
      {docSort === axis &&
        (docOrder === 'asc' ? (
          <ArrowUp className="h-3.5 w-3.5" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5" />
        ))}
    </button>
  );

  // Title-first layout (PLN-260826-KB-Documents-List-UI): the list's job is
  // finding and opening documents, so the title gets the remaining ~80% and
  // everything secondary (visibility/source/status/delete) moves into ⋯.
  const docColumns: Column<KnowledgeDocument>[] = [
    // The group column only earns its width on the All tab — on a group tab
    // every row would repeat the tab's own label.
    ...(group === ''
      ? [
          {
            key: 'docGroup',
            header: t('groupColumn'),
            className: 'w-28 whitespace-nowrap',
            render: (r) => (r.docGroup ? <Badge>{t(`group.${r.docGroup}`)}</Badge> : '—'),
          } as Column<KnowledgeDocument>,
        ]
      : []),
    {
      // Origin badge (B2 P4-7): board-adopted vs direct vs pipeline documents.
      key: 'source',
      header: t('sourceColumn'),
      className: 'w-24 whitespace-nowrap',
      render: (r) => (
        <Badge tone={r.source === 'board' ? 'success' : 'gray'}>
          {t(`sourceBadge.${r.source}`, { defaultValue: r.source })}
        </Badge>
      ),
    },
    {
      key: 'category',
      header: t('category'),
      className: 'w-32 whitespace-nowrap',
      render: (r) => (r.category ? <Badge tone="info">{r.category}</Badge> : '—'),
    },
    {
      key: 'title',
      header: sortHeader('title', t('title_column')),
      className: 'w-full',
      render: (r) => (
        <button
          type="button"
          className="text-left font-medium text-primary-600 hover:underline"
          onClick={() => setDetailId(r.id)}
        >
          {r.title}
        </button>
      ),
    },
    {
      key: 'updatedAt',
      header: sortHeader('updated', t('updated')),
      className: 'whitespace-nowrap',
      render: (r) => (
        <span className="flex items-center gap-1">
          {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : '—'}
          {r.stale && <Badge tone="warning">{t('staleBadge')}</Badge>}
        </span>
      ),
    },
    {
      key: 'more',
      header: '',
      className: 'w-10 text-right',
      render: (r) => (
        <button
          type="button"
          aria-label={t('moreActions')}
          title={t('moreActions')}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            setMoreFor((prev) =>
              prev?.id === r.id
                ? null
                : { id: r.id, top: rect.bottom + 4, right: window.innerWidth - rect.right },
            );
          }}
          className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      ),
    },
  ];

  const docList = documents.data;

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <ProcessGuide optionalGuides={usageGuidesEnabled} />

      {/* Knowledge-gap proposal inbox (P5) — renders nothing when empty. */}
      <GapTasksSection />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
        <Card
          id={KNOWLEDGE_SECTION.SOURCES}
          title={<span className="flex items-center gap-2"><StepNo n={1} />{t('sources')}</span>}
          action={<Button onClick={() => setSourceOpen(true)}>{t('addSource')}</Button>}
        >
          {/* What a source is for, said where the button is: an operator kept
              creating sources expecting them to hold knowledge on their own. */}
          <p className="mb-2 text-xs text-gray-500">{t('sourcesHint')}</p>
          <Table<KnowledgeSource>
            columns={sourceColumns}
            data={sources.data}
            loading={sources.isLoading}
            error={sources.error ? (sources.error as Error).message : null}
            emptyMessage={t('noSources')}
            rowKey={(r) => r.id}
          />

          {/* A source of either type is impossible without its credential, so
              both cards sit beside the source list rather than on a screen an
              operator would have to know to visit. */}
          <div className="mt-4 space-y-2">
            <SourceCredentialCard
              title={t('gdriveCredential')}
              connected={!!gdriveCred.data?.connected}
              identityLabel={t('shareFolderWith')}
              identityValue={gdriveCred.data?.clientEmail ?? null}
              inputHint={t('gdriveKeyHint')}
              placeholder='{ "type": "service_account", ... }'
              multiline
              removeConfirm={t('gdriveRemoveConfirm')}
              busy={{
                saving: saveGdriveCred.isPending,
                removing: deleteGdriveCred.isPending,
                testing: testGdrive.isPending,
              }}
              onSave={(value, clear) => saveGdriveCred.mutate(value, { onSuccess: clear })}
              onRemove={() => deleteGdriveCred.mutate()}
              onTest={() => testGdrive.mutate(undefined)}
            />
            <SourceCredentialCard
              title={t('notionCredential')}
              connected={!!notionCred.data?.connected}
              identityLabel={t('notionTokenStored')}
              identityValue={notionCred.data?.tokenHint ?? null}
              inputHint={t('notionKeyHint')}
              placeholder="ntn_..."
              removeConfirm={t('notionRemoveConfirm')}
              busy={{
                saving: saveNotionCred.isPending,
                removing: deleteNotionCred.isPending,
                testing: testNotion.isPending,
              }}
              onSave={(value, clear) => saveNotionCred.mutate(value, { onSuccess: clear })}
              onRemove={() => deleteNotionCred.mutate()}
              // Target-aware test (REQ-260828 B2): a token-only probe answered
              // 200 while every sync 404'd — so when a Notion source exists,
              // its target is probed too and the message names both halves.
              onTest={() =>
                testNotion.mutate(
                  (sources.data ?? []).find(
                    (src) =>
                      src.type === 'notion' &&
                      src.status === 'active' &&
                      typeof src.configJson?.targetId === 'string',
                  )?.configJson?.targetId as string | undefined,
                )
              }
            />
          </div>
        </Card>

        {/* Answer proposals (PLN-260810 S4). Rendered only when something is
            waiting: an empty review queue should not take up the screen, but a
            full one must be impossible to miss. */}
        {(proposals.data?.length ?? 0) > 0 && (
          <Card title={`${t('proposals')} ${proposals.data!.length}`}>
            <ul className="space-y-3">
              {proposals.data!.map((p) => (
                <li key={p.id} className="rounded-lg border border-gray-200 p-3">
                  <dl className="space-y-1 text-sm">
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-gray-500">{t('proposalQuestion')}</dt>
                      <dd className="font-medium text-gray-800">{p.question}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-gray-500">{t('proposalAnswer')}</dt>
                      <dd className="whitespace-pre-wrap text-gray-700">{p.answer}</dd>
                    </div>
                  </dl>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-500">
                      {p.conversationId ? (
                        <a
                          className="underline-offset-2 hover:underline"
                          href={`/live-chat?c=${p.conversationId}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t('proposalFromConversation', { id: p.conversationId })}
                        </a>
                      ) : (
                        t('proposalNoConversation')
                      )}
                    </span>
                    <span className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRejecting(p.id);
                          setRejectReason('');
                        }}
                      >
                        {t('proposalReject')}
                      </Button>
                      <Button
                        size="sm"
                        disabled={proposalDecision.approve.isPending}
                        onClick={() => proposalDecision.approve.mutate({ id: p.id })}
                      >
                        {t('proposalApprove')}
                      </Button>
                    </span>
                  </div>

                  {rejecting === p.id && (
                    <div className="mt-2 border-t border-gray-100 pt-2">
                      <Input
                        value={rejectReason}
                        placeholder={t('proposalRejectReason')}
                        onChange={(e) => setRejectReason(e.target.value)}
                      />
                      <div className="mt-2 flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setRejecting(null)}>
                          {tc('close')}
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={rejectReason.trim().length < 2}
                          onClick={() =>
                            proposalDecision.reject.mutate(
                              { id: p.id, reason: rejectReason.trim() },
                              { onSuccess: () => setRejecting(null) },
                            )
                          }
                        >
                          {t('proposalReject')}
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* Usage guides (PLN-260807 P2). The storefront publishes no usage text
            at all — 31 of 2,275 products carry any — so these ten guides are
            where "how do I apply this?" gets answered. Types with no guide are
            listed on purpose: a gap nobody can see is a gap nobody fills. */}
        {usageGuidesEnabled && (
        <>
        <Card
          id={KNOWLEDGE_SECTION.GUIDES}
          title={t('usageGuides')}
          action={
            <Button
              size="sm"
              onClick={() => {
                setEditingType(null);
                setTypeEditorOpen(true);
              }}
            >
              {t('usageTypeAdd')}
            </Button>
          }
        >
          <p className="mb-2 text-xs text-gray-500">{t('usageGuidesHint')}</p>
          {/* A tenant with no catalogue still writes guides; the count is just
              always zero, and saying so beats hiding the whole feature (D3). */}
          {usageGuides.data && usageGuides.data.every((g) => g.productCount === 0) ? (
            <p className="mb-2 text-xs text-gray-500">{t('usageNoCatalogHint')}</p>
          ) : null}
          <Table<UsageGuide>
            columns={[
              {
                key: 'key',
                header: t('usageType'),
                render: (g) => (
                  <span className={g.active ? 'font-medium' : 'font-medium text-gray-400'}>
                    {g.label}
                  </span>
                ),
              },
              {
                key: 'productCount',
                header: t('usageProducts'),
                render: (g) => (
                  <span className="tabular-nums">{g.productCount.toLocaleString()}</span>
                ),
              },
              {
                key: 'state',
                header: t('usageState'),
                render: (g) =>
                  g.documentId ? (
                    <Badge tone="success">{t('usageWritten')}</Badge>
                  ) : (
                    <Badge tone="warning">{t('usageMissing')}</Badge>
                  ),
              },
              {
                key: 'action',
                header: '',
                render: (g) => {
                  const i = usageGuides.data?.findIndex((x) => x.key === g.key) ?? 0;
                  return (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" onClick={() => void openGuide(g)}>
                      {g.documentId ? t('usageEdit') : t('usageWrite')}
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        const type = usageTypes.data?.find((ty) => ty.key === g.key) ?? null;
                        setEditingType(type);
                        setTypeEditorOpen(true);
                      }}
                    >
                      {t('usageTypeEditAction')}
                    </Button>
                    {/* Order decides which type claims a product, so it is
                        editable here rather than buried in the dialog. */}
                    <Button
                      variant="ghost"
                      disabled={i === 0 || reorderTypes.isPending}
                      title={t('usageTypeMoveUp')}
                      onClick={() => moveType(i, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={
                        i === (usageGuides.data?.length ?? 0) - 1 || reorderTypes.isPending
                      }
                      title={t('usageTypeMoveDown')}
                      onClick={() => moveType(i, 1)}
                    >
                      ↓
                    </Button>
                  </div>
                  );
                },
              },
            ]}
            data={usageGuides.data}
            loading={usageGuides.isLoading}
            error={usageGuides.error ? (usageGuides.error as Error).message : null}
            emptyMessage={t('noUsageGuides')}
            rowKey={(g) => g.key}
          />
        </Card>

        <UsageTypeEditor
          open={typeEditorOpen}
          type={editingType}
          onClose={() => setTypeEditorOpen(false)}
        />
        </>
        )}

        <div id={KNOWLEDGE_SECTION.CATEGORIES}>
          <CategoryManagerCard />
        </div>

        {/* Step ③ sits between the taxonomy it uses and the documents it produces (REQ-260910 R1). */}
        <BoardCard group={group} />

        <Card
          id={KNOWLEDGE_SECTION.DOCUMENTS}
          title={<span className="flex items-center gap-2"><StepNo n={4} />{t('documents')}</span>}
          action={
            <div className="flex items-center gap-2">
              <CatalogSyncHelp />
              <Button variant="secondary" onClick={() => setCatalogOpen(true)}>
                {t('syncCatalog')}
              </Button>
              <ProductCsvHelp />
              <Button variant="secondary" onClick={() => setImportOpen(true)}>
                {t('importProducts')}
              </Button>
              {/* Bulk download + import target the active tab's group; on the
                  All tab the target would be a guess, so both hide there. */}
              {group !== '' && (
                <div className="relative">
                  <Button
                    variant="secondary"
                    disabled={bulkExport.isPending}
                    onClick={() => setExportMenuOpen((v) => !v)}
                  >
                    {bulkExport.isPending ? tc('loading') : t('bulkExport')} ▾
                  </Button>
                  {exportMenuOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setExportMenuOpen(false)} />
                      <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
                        <button
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                          onClick={() => runExport('csv')}
                        >
                          {t('bulkExportCsv')}
                        </button>
                        <button
                          type="button"
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                          onClick={() => runExport('xlsx')}
                        >
                          {t('bulkExportXlsx')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {group !== '' && (
                <Button variant="secondary" onClick={() => setBulkOpen(true)}>
                  {t('bulkImport')}
                </Button>
              )}
              <Button variant="secondary" onClick={() => setAiImportOpen(true)}>
                {t('aiImport')}
              </Button>
              <AddDocumentHelp />
              {/* Knowledge starts on the board (B3 P5-6); direct add stays for
                  emergencies (D-1: no hard block). */}
              <Button onClick={() => navigate(`/knowledge/board/new?group=${group || 'counsel'}`)}>
                {t('writeOnBoard')}
              </Button>
              <Button variant="ghost" onClick={openDoc}>
                {t('addDocument')}
              </Button>
            </div>
          }
        >
          {/* Group tabs sit above the category navigator: ProductInfo and
              CounselInfo answer different kinds of question, and mixing their
              category lists made neither readable. */}
          <div className="mb-3 flex flex-wrap gap-1 border-b border-gray-200">
            {[
              { key: '', label: t('group.all'), count: Object.values(groupTotals).reduce((a, b) => a + b, 0) },
              { key: 'counsel', label: t('group.counsel'), count: groupTotals.counsel ?? 0 },
              { key: 'product', label: t('group.product'), count: groupTotals.product ?? 0 },
              { key: 'operation', label: t('group.operation'), count: groupTotals.operation ?? 0 },
            ].map((g) => (
              <button
                key={g.key || 'all'}
                type="button"
                onClick={() => selectGroup(g.key)}
                className={`-mb-px border-b-2 px-3 py-2 text-sm ${
                  group === g.key
                    ? 'border-primary-600 font-medium text-primary-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {g.label} <span className="ml-1 tabular-nums text-xs text-gray-400">{g.count}</span>
              </button>
            ))}
          </div>

          {/* Category navigator (PLN-Knowledge-QA F3) replaces the old dropdown:
              the whole taxonomy and its sizes are visible at a glance. */}
          <div className="flex flex-col gap-4 md:flex-row">
            <nav className="flex shrink-0 flex-row flex-wrap gap-1 md:w-52 md:flex-col md:flex-nowrap">
              <CategoryLink
                label={t('allCategories')}
                count={categoryTotal}
                selected={category === ''}
                onSelect={() => selectCategory('')}
              />
              {mergedCategories.map((c) => (
                <CategoryLink
                  key={c.category ?? 'uncategorized'}
                  label={c.category ?? t('uncategorized')}
                  count={c.total}
                  inactive={c.total - c.active}
                  selected={category === (c.category ?? '')}
                  onSelect={() => selectCategory(c.category ?? '')}
                />
              ))}
            </nav>

            <div className="min-w-0 flex-1">
              {/* Server-side filters (PLN-260826): visibility / source / status.
                  Source & status options come from tenant facets, never a
                  hardcoded list — a new origin appears the day its first
                  document does. */}
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <select
                  value={docActive}
                  onChange={(e) => setDocFilter(setDocActive)(e.target.value)}
                  aria-label={t('filter.activeLabel')}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 outline-none focus:border-primary-400"
                >
                  <option value="">{t('filter.activeAll')}</option>
                  <option value="1">{t('visible')}</option>
                  <option value="0">{t('hidden')}</option>
                </select>
                <select
                  value={docSource}
                  onChange={(e) => setDocFilter(setDocSource)(e.target.value)}
                  aria-label={t('filter.sourceLabel')}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 outline-none focus:border-primary-400"
                >
                  <option value="">{t('filter.sourceAll')}</option>
                  {(facets.data?.sources ?? []).map((v) => (
                    <option key={v} value={v}>
                      {t(`source.${v}`, { defaultValue: v })}
                    </option>
                  ))}
                </select>
                <select
                  value={docStatus}
                  onChange={(e) => setDocFilter(setDocStatus)(e.target.value)}
                  aria-label={t('filter.statusLabel')}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 outline-none focus:border-primary-400"
                >
                  <option value="">{t('filter.statusAll')}</option>
                  {(facets.data?.statuses ?? []).map((v) => (
                    <option key={v} value={v}>
                      {t(`docStatus.${v}`, { defaultValue: v })}
                    </option>
                  ))}
                </select>
              </div>
              <Table<KnowledgeDocument>
                columns={docColumns}
                data={docList?.items}
                loading={documents.isLoading}
                error={documents.error ? (documents.error as Error).message : null}
                emptyMessage={t('noDocuments')}
                rowKey={(r) => r.id}
              />
              {/* Stated under the table, not only in a tooltip: the operator
                  decides what to fix from this list, and "pending" quietly
                  meaning "already answering customers" changes that decision. */}
              <p className="mt-2 text-xs text-gray-500">{t('statusLegend')}</p>
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={docList?.total ?? 0}
                onPageChange={setPage}
              />
            </div>
          </div>
        </Card>

        {/* Conversion history of one source (PLN-260828). Keyed by source so
          the doc-list page resets between sources. */}
      <SourceHistoryModal
        key={historyFor?.id ?? 'none'}
        source={historyFor}
        onClose={() => setHistoryFor(null)}
        onOpenDocument={(id) => {
          setHistoryFor(null);
          setDetailId(id);
        }}
      />

      {/* Row more-menu (⋯): fixed so the table's scroll container cannot
            clip it. Holds everything the old columns held — visibility toggle,
            source, status, product link, delete (PLN-260826). */}
        {moreFor &&
          (() => {
            const doc = docList?.items.find((d) => d.id === moreFor.id);
            if (!doc) return null;
            return (
              <div
                role="menu"
                onClick={(e) => e.stopPropagation()}
                style={{ position: 'fixed', top: moreFor.top, right: moreFor.right, zIndex: 40 }}
                className="w-56 rounded-lg border border-gray-200 bg-white p-2 shadow-lg"
              >
                <button
                  type="button"
                  disabled={updateDocument.isPending}
                  onClick={() => {
                    toggleActive(doc);
                    setMoreFor(null);
                  }}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                >
                  <span>{t('active')}</span>
                  <Badge tone={doc.active === 1 ? 'success' : 'warning'}>
                    {doc.active === 1 ? t('visible') : t('hidden')}
                  </Badge>
                </button>
                <div className="flex items-center justify-between px-2 py-1.5 text-sm text-gray-500">
                  <span>{t('sourceColumn')}</span>
                  <Badge tone="gray">{t(`source.${doc.source}`, { defaultValue: doc.source })}</Badge>
                </div>
                <div
                  className="flex items-center justify-between px-2 py-1.5 text-sm text-gray-500"
                  title={doc.status === 'pending' ? t('statusPendingHint') : undefined}
                >
                  <span>{t('status')}</span>
                  <StatusBadge status={doc.status} />
                </div>
                {doc.sourceUrl && (
                  <a
                    href={doc.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setMoreFor(null)}
                    className="flex w-full items-center justify-between rounded px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <span>{t('openProductPage')}</span>
                    <ExternalLink className="h-4 w-4 text-gray-400" />
                  </a>
                )}
                <div className="my-1 border-t border-gray-100" />
                <button
                  type="button"
                  disabled={deleteDocument.isPending}
                  onClick={() => {
                    setMoreFor(null);
                    removeDoc(doc.id);
                  }}
                  className="w-full rounded px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
                >
                  {tc('delete')}
                </button>
              </div>
            );
          })()}
        </div>

        <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <KnowledgeQaPanel onEditSource={(id) => { setDetailId(id); setEditing(true); }} />
          {/* Conflict review sits beside QA on purpose: the QA panel is where a
              contradiction shows up, and this is where it gets settled. */}
          <ConflictReview onOpenDocument={(id) => setDetailId(id)} />
        </div>
      </div>

      {/* Usage guide editor (PLN-260807 P2). */}
      <Modal
        open={guideKey !== null}
        onClose={() => setGuideKey(null)}
        title={usageGuides.data?.find((g) => g.key === guideKey)?.label ?? ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setGuideKey(null)}>
              {tc('close')}
            </Button>
            <Button
              disabled={guideBody.trim().length < 20 || saveUsageGuide.isPending}
              onClick={() =>
                guideKey &&
                saveUsageGuide.mutate(
                  { key: guideKey, title: guideTitle.trim(), content: guideBody.trim() },
                  { onSuccess: () => setGuideKey(null) },
                )
              }
            >
              {saveUsageGuide.isPending ? tc('loading') : tc('save')}
            </Button>
          </>
        }
      >
        <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
          {t('usageGuideHelp')}
        </p>
        <FormRow label={t('title_column')}>
          <Input value={guideTitle} onChange={(e) => setGuideTitle(e.target.value)} />
        </FormRow>
        <FormRow label={t('content')}>
          <textarea
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500"
            rows={12}
            value={guideBody}
            onChange={(e) => setGuideBody(e.target.value)}
            placeholder={t('usageGuidePlaceholder')}
          />
        </FormRow>
      </Modal>

      {/* Catalogue → knowledge (PLN-260807 P1). Preview first: the run rewrites
          the product half of the knowledge base and issues embedding calls, so
          a human sees the plan — including which products merged — before it
          lands. */}
      <Modal
        open={catalogOpen}
        onClose={() => {
          setCatalogOpen(false);
          syncCatalog.reset();
        }}
        title={t('catalogSyncTitle')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCatalogOpen(false);
                syncCatalog.reset();
              }}
            >
              {tc('close')}
            </Button>
            {job?.status !== 'succeeded' && (
              <Button
                disabled={
                  !catalogPreview.data || syncCatalog.isPending || jobRunning || nothingToApply
                }
                onClick={() => syncCatalog.mutate()}
              >
                {syncCatalog.isPending || jobRunning ? t('catalogRunning') : t('catalogRun')}
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {catalogPreview.isPending && <p className="text-gray-500">{tc('loading')}</p>}
          {catalogPreview.error && (
            <p className="text-red-600">{(catalogPreview.error as Error).message}</p>
          )}

          {catalogPreview.data && !job && (
            <>
              <p className="text-gray-700">
                {t('catalogSyncIntro', { scanned: catalogPreview.data.scanned })}
              </p>
              <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                {[
                  ['catalogCreated', catalogPreview.data.created],
                  ['catalogUpdated', catalogPreview.data.updated],
                  ['catalogCuratedKept', catalogPreview.data.curatedKept],
                  ['catalogAbsorbed', catalogPreview.data.absorbed],
                  ['catalogUnchanged', catalogPreview.data.unchanged],
                  ['catalogHeld', catalogPreview.data.held],
                ].map(([key, value]) => (
                  <div key={key as string} className="flex justify-between px-3 py-1.5">
                    <dt className="text-gray-600">{t(key as string)}</dt>
                    <dd className="font-medium tabular-nums">{value as number}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-gray-500">
                {t('catalogEmbedEstimate', {
                  batches: Math.ceil(
                    (catalogPreview.data.created + catalogPreview.data.updated) / 64,
                  ),
                })}
              </p>
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {t('catalogCuratedHint')}
              </p>

              {catalogPreview.data.familySamples.length > 0 && (
                <details className="rounded-lg border border-gray-200 px-3 py-2">
                  <summary className="cursor-pointer text-gray-700">
                    {t('catalogMergeSamples')}
                  </summary>
                  <ul className="mt-2 space-y-2">
                    {catalogPreview.data.familySamples.map((f) => (
                      <li key={f.representative} className="text-xs">
                        <span className="font-medium text-gray-800">{f.representative}</span>
                        <span className="ml-1 text-gray-500">
                          {t('catalogMergedInto', { count: f.absorbed })}
                        </span>
                        <ul className="mt-0.5 list-disc pl-5 text-gray-500">
                          {f.variants.map((v) => (
                            <li key={v}>{v}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {catalogPreview.data.held > 0 && (
                <details className="rounded-lg border border-gray-200 px-3 py-2">
                  <summary className="cursor-pointer text-gray-700">{t('catalogHeldList')}</summary>
                  <p className="mt-1 text-xs text-gray-500">{t('catalogHeldHint')}</p>
                  <ul className="mt-1 list-disc pl-5 text-xs text-gray-600">
                    {catalogPreview.data.heldSamples.map((h) => (
                      <li key={h.handle}>{h.title}</li>
                    ))}
                  </ul>
                </details>
              )}

              {nothingToApply && <p className="text-gray-500">{t('catalogNothingToDo')}</p>}
            </>
          )}

          {job && (
            <div className="space-y-3">
              {/* Progress, not a spinner: the run is minutes long and the
                  operator needs to see it move (RPT-260808 D3). */}
              {job.status === 'running' && (
                <div className="space-y-2">
                  <Progress
                    label={t('catalogPhaseWriting')}
                    done={job.written}
                    total={job.writeTotal}
                  />
                  <Progress
                    label={t('catalogPhaseEmbedding')}
                    done={job.embedded}
                    total={job.embedTotal}
                  />
                  <p className="text-xs text-gray-500">{t('catalogKeepOpenHint')}</p>
                </div>
              )}

              {job.status === 'failed' && (
                <p className="text-red-600">
                  {t('catalogFailed')}: {job.error}
                </p>
              )}

              {job.status === 'succeeded' && job.result && (
                <>
                  <p className="font-medium text-gray-800">{t('catalogDone')}</p>
                  <dl className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                    {[
                      ['catalogCreated', job.result.created],
                      ['catalogUpdated', job.result.updated],
                      ['catalogCuratedKept', job.result.curatedKept],
                      ['catalogHeld', job.result.held],
                      ['importEmbedded', job.result.embedded],
                    ].map(([key, value]) => (
                      <div key={key as string} className="flex justify-between px-3 py-1.5">
                        <dt className="text-gray-600">{t(key as string)}</dt>
                        <dd className="font-medium tabular-nums">{value as number}</dd>
                      </div>
                    ))}
                  </dl>
                  {job.result.embedFailed > 0 && (
                    <p className="text-red-600">
                      {t('catalogNotIndexed')}: {job.result.embedFailed}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => {
          setImportOpen(false);
          setImportFile(null);
          importProducts.reset();
        }}
        title={t('importProducts')}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setImportOpen(false);
                setImportFile(null);
                importProducts.reset();
              }}
            >
              {tc('close')}
            </Button>
            <Button
              disabled={!importFile || importProducts.isPending}
              onClick={() => importFile && importProducts.mutate(importFile)}
            >
              {importProducts.isPending ? tc('loading') : t('import')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-600 file:px-3 file:py-2 file:text-sm file:text-white"
          />
          <p className="text-xs text-gray-500">{t('importRequiredColumns')}</p>
          <p className="text-xs text-gray-500">{t('importUpsertHint')}</p>
          <p className="text-xs text-warning">{t('importPriceNote')}</p>

          {importProducts.data && (
            <dl className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-3 text-xs">
              <Stat label={t('importParsed')} value={importProducts.data.parsed} />
              <Stat label={t('importCreated')} value={importProducts.data.created} />
              <Stat label={t('importUpdated')} value={importProducts.data.updated} />
              <Stat label={t('importSkipped')} value={importProducts.data.skipped} />
              <Stat label={t('importInvalid')} value={importProducts.data.invalid} />
              <Stat label={t('importEmbedded')} value={importProducts.data.embedded} />
            </dl>
          )}
          {(importProducts.data?.errors.length ?? 0) > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-warning/40 bg-amber-50 p-2 text-xs">
              {importProducts.data!.errors.slice(0, 20).map((e, i) => (
                <li key={i}>
                  {t('importRow', { n: e.row })}: {e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <AiIngestModal
        open={aiImportOpen}
        onClose={() => setAiImportOpen(false)}
        defaultGroup={group || 'counsel'}
      />

      <Modal
        open={bulkOpen}
        onClose={closeBulk}
        title={`${t('bulkImport')} — ${t(`group.${group || 'counsel'}`)}`}
        footer={
          <>
            <Button variant="ghost" onClick={closeBulk}>
              {tc('close')}
            </Button>
            <Button disabled={!bulkFile || bulkImport.isPending} onClick={runBulkImport}>
              {bulkImport.isPending ? tc('loading') : t('import')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {/* A described format is still guesswork until you see one. Product
              gets its own example rows; the columns are the same. */}
          <div className="flex gap-3">
            <a
              className="text-sm font-medium text-primary hover:underline"
              href={
                group === 'product'
                  ? '/samples/kb-product-bulk-sample.csv'
                  : '/samples/kb-bulk-import-sample.csv'
              }
              download
            >
              ⬇ {t('bulkImportSampleCsv')}
            </a>
            <a
              className="text-sm font-medium text-primary hover:underline"
              href={
                group === 'product'
                  ? '/samples/kb-product-bulk-sample.xlsx'
                  : '/samples/kb-bulk-import-sample.xlsx'
              }
              download
            >
              ⬇ {t('bulkImportSampleXlsx')}
            </a>
          </div>
          {/* The universal counsel guide is a full starter KB, not a format
              sample — counsel tab only (PLN-260903 D6). */}
          {group === 'counsel' && (
            <div className="flex gap-3 rounded-lg bg-primary-50 p-2">
              <span className="text-xs text-gray-600">{t('universalGuideHint')}</span>
              <a
                className="shrink-0 text-xs font-medium text-primary hover:underline"
                href="/samples/universal-counsel-guide.csv"
                download
              >
                ⬇ CSV
              </a>
              <a
                className="shrink-0 text-xs font-medium text-primary hover:underline"
                href="/samples/universal-counsel-guide.xlsx"
                download
              >
                ⬇ XLSX
              </a>
            </div>
          )}
          <p className="text-xs text-gray-500">{t('bulkImportColumns')}</p>
          <p className="text-xs text-gray-500">{t('bulkImportOptional')}</p>
          <p className="text-xs text-gray-500">{t('bulkImportUpsert')}</p>
          {group === 'product' && <p className="text-xs text-gray-500">{t('bulkImportProductNote')}</p>}
          <p className="text-xs text-gray-500">{t('bulkImportSyncedNote')}</p>
          <p className="text-xs text-warning">{t('bulkImportEncoding')}</p>
          <input
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setBulkFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-gray-700 file:mr-3 file:rounded-lg file:border-0 file:bg-primary-600 file:px-3 file:py-2 file:text-sm file:text-white"
          />

          {bulkImport.data && (
            <dl className="grid grid-cols-3 gap-2 rounded-lg bg-gray-50 p-3 text-xs">
              <Stat label={t('importParsed')} value={bulkImport.data.parsed} />
              <Stat label={t('importCreated')} value={bulkImport.data.created} />
              <Stat label={t('importUpdated')} value={bulkImport.data.updated} />
              <Stat label={t('importSkipped')} value={bulkImport.data.skipped} />
              <Stat label={t('importInvalid')} value={bulkImport.data.invalid} />
              <Stat label={t('importEmbedded')} value={bulkImport.data.embedded} />
            </dl>
          )}
          {(bulkImport.data?.errors.length ?? 0) > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded border border-warning/40 bg-amber-50 p-2 text-xs">
              {bulkImport.data!.errors.slice(0, 20).map((e, i) => (
                <li key={i}>
                  {t('importRow', { n: e.row })}: {e.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>

      <Modal
        open={sourceToDelete !== null}
        onClose={() => setSourceToDelete(null)}
        title={t('deleteSource')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSourceToDelete(null)}>
              {tc('cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={deleteSource.isPending}
              onClick={() =>
                sourceToDelete &&
                deleteSource.mutate(sourceToDelete.id, { onSuccess: () => setSourceToDelete(null) })
              }
            >
              {deleteSource.isPending ? tc('loading') : tc('delete')}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm">
          <p>{t('deleteSourceConfirm', { name: sourceToDelete?.name ?? '' })}</p>
          {/* The documents survive as inactive — say so, or the deletion reads
              as destroying the knowledge itself. */}
          <p className="text-xs text-warning">{t('deleteSourceDocsNote')}</p>
        </div>
      </Modal>

      <Modal
        open={sourceOpen}
        onClose={closeSource}
        title={t('addSource')}
        footer={
          <>
            <Button variant="ghost" onClick={closeSource}>
              {tc('cancel')}
            </Button>
            <Button onClick={saveSource} disabled={createSource.isPending || !sourceName}>
              {tc('save')}
            </Button>
          </>
        }
      >
        <FormRow label={t('name')}>
          <Input value={sourceName} onChange={(e) => setSourceName(e.target.value)} />
        </FormRow>
        <FormRow label={t('type')}>
          <Select value={sourceType} onChange={(e) => setSourceType(e.target.value as SourceType)}>
            {SOURCE_TYPES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        </FormRow>
        {sourceType === SOURCE_TYPE.GDRIVE && (
          <>
            <FormRow label={t('folderId')}>
              <Input
                value={folderId}
                placeholder="1a2B3c4D5e6F7g8H9i_JkLmNoPq"
                onChange={(e) => setFolderId(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500">{t('folderIdHint')}</p>
            </FormRow>
            {/* The folder must be shared with the service account, and nothing
                else on screen says which address to share it with. */}
            <div className="rounded-md bg-warning/10 p-3 text-xs text-gray-700">
              {gdriveCred.data?.connected ? (
                <>
                  <p>{t('shareFolderWith')}</p>
                  <code className="mt-1 block break-all font-mono">{gdriveCred.data.clientEmail}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1"
                    disabled={testGdrive.isPending || !folderId.trim()}
                    onClick={() => testGdrive.mutate(folderId.trim())}
                  >
                    {t('testConnection')}
                  </Button>
                </>
              ) : (
                <p>{t('registerKeyFirst')}</p>
              )}
            </div>
          </>
        )}
        {sourceType === SOURCE_TYPE.NOTION && (
          <>
            <FormRow label={t('notionTargetId')}>
              <Input
                value={notionTarget}
                placeholder="https://www.notion.so/Support-Manual-1a2b3c…"
                onChange={(e) => setNotionTarget(e.target.value)}
              />
              <p className="mt-1 text-xs text-gray-500">{t('notionTargetIdHint')}</p>
            </FormRow>
            {/* Connecting the target to the integration is a separate step in
                Notion that nothing prompts for, and skipping it looks exactly
                like an empty page. */}
            <div className="rounded-md bg-warning/10 p-3 text-xs text-gray-700">
              {notionCred.data?.connected ? (
                <>
                  <p>{t('shareWithIntegration')}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1"
                    disabled={testNotion.isPending || !notionTarget.trim()}
                    onClick={() => testNotion.mutate(notionTarget.trim())}
                  >
                    {t('testConnection')}
                  </Button>
                </>
              ) : (
                <p>{t('registerTokenFirst')}</p>
              )}
            </div>
          </>
        )}
      </Modal>

      <Modal
        open={docOpen}
        onClose={closeDoc}
        title={t('addDocument')}
        footer={
          <>
            <Button variant="ghost" onClick={closeDoc}>
              {tc('cancel')}
            </Button>
            <Button
              onClick={saveDoc}
              disabled={createDocument.isPending || !docTitle || !docCategory || !docContent}
            >
              {tc('save')}
            </Button>
          </>
        }
      >
        <p className="mb-2 text-xs text-warning">{t('directAddHint')}</p>
        <FormRow label={t('groupColumn')}>
          <Select value={docGroup} onChange={(e) => setDocGroup(e.target.value)}>
            <option value="counsel">{t('group.counsel')}</option>
            <option value="product">{t('group.product')}</option>
            <option value="operation">{t('group.operation')}</option>
          </Select>
        </FormRow>
        <FormRow label={t('title_column')}>
          <Input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
        </FormRow>
        <FormRow label={t('category')}>
          <>
            <Input
              value={docCategory}
              onChange={(e) => setDocCategory(e.target.value)}
              list="kb-categories"
              placeholder={t('categoryPlaceholder')}
            />
            <datalist id="kb-categories">
              {categorySuggestions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </>
        </FormRow>
        <FormRow label={t('content')}>
          <textarea
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500"
            rows={8}
            value={docContent}
            onChange={(e) => setDocContent(e.target.value)}
          />
        </FormRow>
      </Modal>

      <Modal
        open={detailId !== null}
        onClose={closeDetail}
        title={detail.data?.title ?? t('documentDetail')}
        footer={
          <>
            {detail.data && !editing && (
              <>
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  {tc('edit')}
                </Button>
                <Button
                  variant="secondary"
                  disabled={updateDocument.isPending}
                  onClick={() => toggleActive(detail.data)}
                >
                  {detail.data.active === 1 ? t('deactivate') : t('activate')}
                </Button>
              </>
            )}
            {detail.data && editing && (
              <Button onClick={saveEdit} disabled={updateDocument.isPending || !editTitle.trim()}>
                {tc('save')}
              </Button>
            )}
            <Button variant="ghost" onClick={editing ? () => setEditing(false) : closeDetail}>
              {editing ? tc('cancel') : tc('close')}
            </Button>
          </>
        }
      >
        {detail.isLoading ? (
          <p className="py-6 text-center text-sm text-gray-500">{tc('loading')}</p>
        ) : detail.error ? (
          <p className="py-6 text-center text-sm text-error">{(detail.error as Error).message}</p>
        ) : detail.data ? (
          <div className="space-y-3">
            <div className="flex gap-1 border-b border-gray-200">
              {(['content', 'history'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setDetailTab(tab)}
                  className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
                    detailTab === tab
                      ? 'border-primary-600 font-medium text-primary-700'
                      : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {t(`detailTab.${tab}`)}
                </button>
              ))}
            </div>
            {detailTab === 'history' ? (
              <RevisionHistory
                documentId={detail.data.id}
                currentContent={detail.data.content ?? ''}
              />
            ) : (
            <>
            <div className="flex flex-wrap items-center gap-2">
              {detail.data.category && <Badge tone="info">{detail.data.category}</Badge>}
              <Badge tone={detail.data.active === 1 ? 'success' : 'warning'}>
                {detail.data.active === 1 ? t('visible') : t('hidden')}
              </Badge>
              <StatusBadge status={detail.data.status} />
              <Badge tone="gray">
                {t(`source.${detail.data.source}`, { defaultValue: detail.data.source })}
              </Badge>
              {detail.data.stale && <Badge tone="warning">{t('staleBadge')}</Badge>}
              {detail.data.sourceUrl && (
                <a
                  href={detail.data.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary-600 underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t('openProductPage')}
                </a>
              )}
              {detail.data.updatedAt && (
                <span className="text-xs text-gray-500">
                  {t('updated')}: {new Date(detail.data.updatedAt).toLocaleString()}
                </span>
              )}
            </div>

            {/* Review state. `updatedAt` moves for any edit, including one that
                never revisited the facts, so it cannot answer "is this still
                true?" — that is what the review stamp is for. */}
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
              <span>
                {t('reviewedAt')}:{' '}
                {detail.data.reviewedAt
                  ? new Date(detail.data.reviewedAt).toLocaleDateString()
                  : t('neverReviewed')}
              </span>
              {detail.data.reviewDueAt && (
                <span>
                  {t('reviewDue')}: {new Date(detail.data.reviewDueAt).toLocaleDateString()}
                </span>
              )}
              {detail.data.supersededBy && (
                <Badge tone="warning">
                  {t('supersededBy', { id: String(detail.data.supersededBy).slice(0, 8) })}
                </Badge>
              )}
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto"
                disabled={markReviewed.isPending}
                onClick={() => markReviewed.mutate(detail.data!.id)}
              >
                {t('markReviewed')}
              </Button>
            </div>
            {(() => {
              // Managed on the board: adopted rows carry a BRD- key, KB-imported
              // rows are linked by id and may keep their own key (PLN-260910 D-6).
              const boardId =
                detail.data?.boardDocumentId ??
                (detail.data?.externalKey?.startsWith('BRD-') ? detail.data.externalKey.slice(4) : null);
              return boardId ? (
                <div className="mb-2 rounded-md bg-primary-50 px-3 py-2 text-xs text-primary-800">
                  {t('boardOriginNote')}{' '}
                  <button
                    type="button"
                    className="font-medium underline"
                    onClick={() => navigate(`/knowledge/board/${boardId}`)}
                  >
                    {t('boardOriginOpen')}
                  </button>
                </div>
              ) : null;
            })()}
            {editing ? (
              /* Saving re-embeds when the content changed (updateDocument), so a
                 corrected source is searchable again straight away. */
              <div className="space-y-2">
                <FormRow label={t('title_column')}>
                  <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                </FormRow>
                <FormRow label={t('category')}>
                  <>
                    <Input
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      list="kb-categories-edit"
                    />
                    <datalist id="kb-categories-edit">
                      {suggestionsFor(detail.data?.docGroup).map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </>
                </FormRow>
                <FormRow label={t('sourceUrl')}>
                  <Input
                    value={editSourceUrl}
                    placeholder="https://…"
                    onChange={(e) => setEditSourceUrl(e.target.value)}
                  />
                </FormRow>
                <FormRow label={t('videoRef')}>
                  <Input
                    value={editVideoRef}
                    placeholder="https://…  |  notion:<block id>"
                    onChange={(e) => setEditVideoRef(e.target.value)}
                  />
                </FormRow>
                <p className="-mt-2 mb-2 text-xs text-gray-400">{t('videoRefHint')}</p>
                <div className="grid grid-cols-2 gap-2">
                  <FormRow label={t('effectiveFrom')}>
                    <Input
                      type="date"
                      value={editEffectiveFrom}
                      onChange={(e) => setEditEffectiveFrom(e.target.value)}
                    />
                  </FormRow>
                  <FormRow label={t('reviewInterval')}>
                    <Input
                      type="number"
                      min={0}
                      value={editReviewDays}
                      placeholder="180"
                      onChange={(e) => setEditReviewDays(e.target.value)}
                    />
                  </FormRow>
                </div>
                <FormRow label={t('content')}>
                  <textarea
                    className="h-64 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-primary-500"
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                  />
                </FormRow>
                <p className="text-[11px] text-gray-400">{t('editReindexHint')}</p>
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm leading-relaxed">
                {detail.data.content ?? t('noContent')}
              </div>
            )}
            </>
            )}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

/** One row in the category navigator: name, size, and how many are hidden. */
function CategoryLink({
  label,
  count,
  inactive,
  selected,
  onSelect,
}: {
  label: string;
  count: number;
  inactive?: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm',
        selected ? 'bg-primary-500/10 font-medium text-primary-600' : 'text-gray-600 hover:bg-gray-50',
      )}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 text-xs tabular-nums text-gray-400">
        {count}
        {inactive ? ` (−${inactive})` : ''}
      </span>
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd className="tabular-nums font-medium text-gray-800">{value}</dd>
    </div>
  );
}
