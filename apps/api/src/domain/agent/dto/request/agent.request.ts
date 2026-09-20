import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class ListSessionsQuery {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() size?: string;
  /** Customer name/email filter (decrypt-then-filter window — see CustomerService). */
  @IsOptional() @IsString() q?: string;
  /** 'all' (default, includes live AI threads) | 'queue' | 'ended'. */
  @IsOptional() @IsString() status?: string;
  /** Origin channel filter: 'all' (default) | widget | telegram | zalo | email … */
  @IsOptional() @IsString() channel?: string;
  /** AI-agent filter (REQ-260825 R7): agent id; omitted/'all' = every agent. */
  @IsOptional() @IsString() ai_agent_id?: string;
}

/** Re-pin the session to another AI agent — applies from the next turn. */
export class SetSessionAiAgentRequest {
  @IsInt() @Min(1) ai_agent_id: number;
}

/** Hand the conversation to a specific human agent (REQ-260825 R8-②). */
export class AssignConversationRequest {
  @IsInt() @Min(1) user_id: number;
}

/** File the conversation as an issue (REQ-260825 R8-③); unknown types → 'other'.
 * With `message_id` (PLN-260826 R5) the filing targets that customer message —
 * its excerpt plus the optional memo land in the issue timeline. */
export class FileIssueRequest {
  @IsString() @MaxLength(32) type: string;
  @IsOptional() @IsInt() @Min(1) message_id?: number;
  @IsOptional() @IsString() @MaxLength(300) memo?: string;
}

/** Pin or unpin the conversation in the queue — team-shared, max 3 (PLN-260826). */
export class SetConversationPinRequest {
  @IsBoolean() pinned: boolean;
}

/** Translate one message into a system language for the console (PLN-260826). */
export class TranslateMessageRequest {
  @IsString() @MaxLength(8) lang: string;
}

/** Transcript paging for the console (PLN-260807): recent tail, then older blocks. */
export class ConversationQuery {
  @IsOptional() @IsString() limit?: string;
  /** Load the block older than this message id. */
  @IsOptional() @IsString() before_id?: string;
}

export class ListStatsQuery {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() size?: string;
}

/** CSAT statistics window + filters (PLN-260826). Dates are YYYY-MM-DD on the
 * ended_at axis; omitted range = the last 30 days. */
export class CsatQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsIn(['1', '2', '3', '4', '5']) rating?: string;
  @IsOptional() @IsString() agent_id?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() size?: string;
}

export class ListAlertsQuery {
  @IsOptional() @IsString() status?: string;
}

/** Operator display name for a session; blank/omitted clears it (PLN-260812). */
export class SetSessionAliasRequest {
  @IsOptional() @IsString() @MaxLength(60) alias?: string | null;
}

/** Per-session auto-reply choice: inherit | on | off (PLN-260812). */
export class SetAutoReplyRequest {
  @IsString() mode: string;
}

/** Approve the pending draft; `body` replaces it when the agent edited it. */
export class ApproveDraftRequest {
  @IsOptional() @IsString() body?: string;
}

export class AgentMessageRequest {
  /** May be empty when files carry the reply (PLN-260814); the controller
   * refuses a reply that has neither text nor attachments. */
  @IsString() body: string;
  /** Attachment uuids from the console upload endpoint, in display order. */
  @IsOptional() @IsArray() @IsString({ each: true }) attachment_ids?: string[];
}

/** Session group create (PLN-260824-Session-Grouping): kind is a classifier only. */
export class CreateGroupRequest {
  @IsIn(['timeline', 'project']) kind: 'timeline' | 'project';
  @IsString() @MinLength(1) @MaxLength(100) title: string;
  @IsArray() @ArrayMinSize(2) @IsInt({ each: true }) session_ids: number[];
}

export class UpdateGroupRequest {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) title?: string;
  @IsOptional() @IsIn(['timeline', 'project']) kind?: 'timeline' | 'project';
}

export class AddGroupMembersRequest {
  @IsArray() @ArrayMinSize(1) @IsInt({ each: true }) session_ids: number[];
}

/** 1:1 send from a group room — exactly one member session as the recipient. */
export class GroupMessageRequest {
  @IsInt() @Min(1) session_id: number;
  @IsString() @MinLength(1) body: string;
}

/** Internal operator note on a thread or its session (REQ-260824 R4). */
export class CreateCommentRequest {
  @IsIn(['conversation', 'session']) scope: 'conversation' | 'session';
  @IsString() @MinLength(1) @MaxLength(2000) body: string;
}

export class UpdateCommentRequest {
  @IsString() @MinLength(1) @MaxLength(2000) body: string;
}

/** Translate a stored briefing into one of the system languages (REQ-260824 R3). */
export class TranslateBriefingRequest {
  @IsString() @MaxLength(8) lang: string;
}

export class LinkCustomerRequest {
  @IsInt() @Min(1) customer_id: number;
}

export class CreateCustomerRequest {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
}

/** Customer search term carried in the body so it stays out of access logs. */
export class SearchCustomersRequest {
  @IsOptional() @IsString() @MaxLength(200) q?: string;
}

export class UpsertProfileRequest {
  @IsOptional() @IsString() languages?: string;
  @IsOptional() @IsString() skills?: string;
  @IsOptional() @IsInt() @Min(1) max_concurrent?: number;
  @IsOptional() @IsString() status?: string;
}
