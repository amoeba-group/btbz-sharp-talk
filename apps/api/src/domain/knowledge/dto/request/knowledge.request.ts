import { BULK_IMPORT_GROUPS, DOC_GROUP } from '../../entity/kb-document.entity';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Knowledge source ingestion modes (FR-064). board/repository were removed
 * (PLN-260829 P1-3): no adapter exists, every registered row stayed empty, and
 * createSource already refused them — this promotes the refusal to the DTO.
 * Legacy rows of those types still list, update and delete normally.
 */
export const KNOWLEDGE_SOURCE_TYPES = ['gdrive', 'notion'] as const;

// ---- Sources ----

export class CreateSourceRequest {
  @IsString() @IsIn(KNOWLEDGE_SOURCE_TYPES as unknown as string[]) type: string;
  @IsString() name: string;
  @IsOptional() @IsInt() designated?: number;
  @IsOptional() @IsObject() config_json?: Record<string, unknown>;
}

/** Service-account key, pasted whole (PLN-260815 G1). */
export class SaveGdriveCredentialRequest {
  @IsString() key_json: string;
}

export class TestGdriveRequest {
  @IsOptional() @IsString() folder_id?: string;
}

/** Notion internal-integration token, pasted whole (PLN-260821 W1). */
export class SaveNotionCredentialRequest {
  @IsString() token: string;
}

export class TestNotionRequest {
  /** A page/database id or the share URL it came from; both are accepted. */
  @IsOptional() @IsString() target_id?: string;
}

export class UpdateSourceRequest {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() status?: string; // active/inactive
  @IsOptional() @IsInt() designated?: number;
}

// ---- Documents ----

export class ListDocumentsQuery {
  @IsOptional() @IsString() source_id?: string;
  @IsOptional() @IsString() category?: string;
  /** counsel | product — omit for all groups. */
  @IsOptional() @IsString() group?: string;
  // List filters/sort (PLN-260826-KB-Documents-List-UI). All server-side —
  // the list is server-paginated, so client-side sorting would only ever
  // order the current page.
  /** '1' | '0' — visibility filter; omit for both. */
  @IsOptional() @IsIn(['1', '0']) active?: string;
  /** Origin system (knowledge_store/google_drive/…); values come from facets. */
  @IsOptional() @IsString() source?: string;
  /** embedded | pending. */
  @IsOptional() @IsString() status?: string;
  /** Sort axis — anything else falls back to the default id DESC. */
  @IsOptional() @IsIn(['title', 'updated']) sort?: string;
  @IsOptional() @IsIn(['asc', 'desc']) order?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() size?: string;
}

export class CreateDocumentRequest {
  @IsOptional() @IsInt() source_id?: number;
  /** counsel (default) | product | operation — a closed set, so reject anything else. */
  @IsOptional() @IsIn(Object.values(DOC_GROUP)) doc_group?: string;
  @IsOptional() @IsString() source?: string; // knowledge_store/google_drive
  @IsString() category: string;
  @IsString() title: string;
  @IsString() content: string;
  /**
   * Where this knowledge came from — e.g. the live-chat conversation an agent
   * wrote a model answer from (PLN-260807). Provenance matters when someone
   * later asks why a document says what it says.
   */
  @IsOptional() @IsString() @MaxLength(512) source_url?: string;
}

/** Multipart form fields riding along the bulk-import file (PLN-260828 D3). */
export class BulkImportRequest {
  /**
   * counsel (default) | operation | product. Product rows here are generic
   * documents (category/title/content) — shop-export catalogue files still go
   * through the dedicated importer.
   */
  @IsOptional() @IsIn(BULK_IMPORT_GROUPS as readonly string[]) doc_group?: string;
}

// ---- Board review (PLN-260829 B2) ----

export class PromoteBoardDocumentRequest {
  /** Overrides the default KB category mapping (2nd level, else 1st). */
  @IsOptional() @IsString() @MaxLength(64) category?: string;
}

export class SimulateBoardDocumentRequest {
  @IsString() @MinLength(1) question: string;
  @IsOptional() @IsString() language?: string;
  @IsOptional() @IsInt() ai_agent_id?: number;
}

// ---- AI ingest (PLN-260829 3차) ----

/** Multipart form fields riding along the ingest file upload. */
export class IngestFileRequest {
  /** counsel (default) | product | operation. */
  @IsOptional() @IsIn(Object.values(DOC_GROUP)) doc_group?: string;
}

export class IngestVideoRequest {
  @IsString() @MaxLength(512) video_url: string;
  @IsOptional() @IsIn(Object.values(DOC_GROUP)) doc_group?: string;
}

/**
 * The operator-reviewed drafts to save. Field-level validation happens in the
 * service (trim/length/non-empty) — the array shape is all the DTO pins down.
 */
export class ApproveIngestRequest {
  @IsArray() articles: Array<{ title: string; category: string; content: string }>;
}

export class UpdateDocumentRequest {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() content?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsInt() active?: number;
  // Provenance & staleness (PLN D7). Nullable on purpose: clearing a review
  // cadence is a legitimate edit, so `null` is distinct from "not sent".
  @IsOptional() @IsString() source_url?: string | null;
  @IsOptional() @IsString() effective_from?: string | null;
  @IsOptional() @IsInt() review_interval_days?: number | null;
  @IsOptional() @IsInt() owner_user_id?: number | null;
}

/** Conflict review queue filter. */
export class ListConflictsQuery {
  /** pending (default view) | resolved | dismissed */
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() size?: string;
}

export class ResolveConflictRequest {
  /** kept_a | kept_b | kept_both */
  @IsString() resolution: string;
}

/** Console knowledge QA (PLN-Knowledge-QA-Console F1). */
export class AskKnowledgeRequest {
  @IsString() question: string;
  @IsOptional() @IsString() language?: string; // en/es/ko
  /** Bias retrieval toward one group; omit for no preference. */
  @IsOptional() @IsString() group?: string;
  /** Answer as this AI agent would (its knowledge scope); omit to see everything. */
  @IsOptional() @IsInt() ai_agent_id?: number;
}

// ---- Board posts ----

export class CreatePostRequest {
  @IsString() title: string;
  @IsOptional() @IsString() body?: string;
}

/** Usage guide body for one product type (PLN-260807 P2). */
export class SaveUsageGuideRequest {
  @IsString() @MaxLength(255) title: string;
  @IsString() @MinLength(20) @MaxLength(20000) content: string;
}

/** PUT/POST /knowledge/usage-types — 테넌트별 사용법 유형 (PLN-260824 A축). */
export class SaveUsageTypeRequest {
  @IsString() @MinLength(1) @MaxLength(128) label: string;

  /** 한 줄에 하나. 비우면 매칭 없음 — 본문을 먼저 쓰고 키워드는 나중에 손볼 수 있다. */
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(64, { each: true })
  keywords?: string[];

  @IsOptional() @IsBoolean() active?: boolean;
}

/** POST /knowledge/usage-types/preview — 저장 전 매칭 개수 확인 (PLN D2). */
export class PreviewUsageTypeRequest {
  @IsArray() @IsString({ each: true }) @MaxLength(64, { each: true }) keywords: string[];

  /** 수정 중인 유형. 자기 자신은 경쟁에서 빼고, 위 순서의 유형만 가져간 것으로 계산. */
  @IsOptional() @IsInt() exclude_id?: number;
}

/** PUT /knowledge/usage-types/reorder — 매칭 순서(첫 매치 우선이라 순서가 의미). */
export class ReorderRequest {
  @IsArray() @IsInt({ each: true }) ids: number[];
}

/** POST /knowledge/categories — 카테고리 생성 (PLN-260824 B축). */
export class CreateCategoryRequest {
  @IsString() @MinLength(1) @MaxLength(64) name: string;
  @IsOptional() @IsString() @MaxLength(128) label?: string;
  /** counsel (default) | product | operation — the manager tab it was created on. */
  @IsOptional() @IsIn(Object.values(DOC_GROUP)) doc_group?: string;
}

/** PUT /knowledge/categories/:id/rename */
export class RenameCategoryRequest {
  @IsString() @MinLength(1) @MaxLength(64) name: string;
}

/** POST /knowledge/categories/merge — 문서를 옮기고 빈 카테고리를 지운다. */
export class MergeCategoriesRequest {
  @IsArray() @IsInt({ each: true }) from_ids: number[];
  @IsInt() into_id: number;
}

/** PUT /knowledge/categories/:id/hidden */
export class SetCategoryHiddenRequest {
  @IsBoolean() hidden: boolean;
}

/** PUT /knowledge/categories/:id/agents — empty list restores "every agent". */
export class SetCategoryAgentsRequest {
  @IsArray() @IsInt({ each: true }) agent_ids: number[];
}

/** PUT /knowledge/categories/:id/guest-visible (PLN-261001 v1.1 T2). */
export class SetCategoryGuestVisibleRequest {
  @IsBoolean() guest_visible: boolean;
}

/** POST /knowledge/gap-tasks/:id/accept — 승인 전 인라인 편집(P5). */
export class AcceptGapTaskRequest {
  @IsOptional() @IsString() @MaxLength(300) title?: string;
  @IsOptional() @IsString() content?: string;
}

/** Chat handler proposes an answer for the knowledge base (PLN-260810 S4). */
export class ProposeAnswerRequest {
  @IsOptional() @IsInt() conversation_id?: number;
  @IsString() @MaxLength(500) question: string;
  @IsString() @MinLength(10) answer: string;
}

export class ApproveProposalRequest {
  @IsOptional() @IsString() @MaxLength(255) title?: string;
  @IsOptional() @IsString() @MaxLength(64) category?: string;
  @IsOptional() @IsString() answer?: string;
}

export class RejectProposalRequest {
  @IsString() @MinLength(2) @MaxLength(500) reason: string;
}
