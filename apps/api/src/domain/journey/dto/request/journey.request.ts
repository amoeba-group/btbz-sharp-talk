import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** POST /journey/groups/:groupId/reports — 전체는 두 값을 비운다. */
export class CreateJourneyReportRequest {
  @IsOptional() @IsString() @MaxLength(10) period_from?: string;
  @IsOptional() @IsString() @MaxLength(10) period_to?: string;
}

/** POST /journey/reports/compare — 사용자가 고른 두 건(D5). */
export class CompareJourneyReportsRequest {
  @IsArray() @IsInt({ each: true }) report_ids: number[];
}

/** PUT /journey/criteria — 저장은 항상 새 버전이 된다. */
export class SaveJourneyCriteriaRequest {
  @IsOptional() @IsObject() sections?: Record<string, string>;
  @IsOptional() @IsInt() top_questions_n?: number;
  @IsOptional() @IsInt() sample_cap?: number;
  @IsOptional() @IsInt() quote_max_chars?: number;
  @IsOptional() @IsString() @MaxLength(64) tone?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) banned?: string[];
}

// ---- journey management (PLN-261006) ----

/** PUT /journey/groups/:groupId/stage — null clears the stage. */
export class SetJourneyStageRequest {
  @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(32) stage_key: string | null;
}

/** PUT /journey/groups/:groupId/owner — null clears the owner. */
export class SetJourneyOwnerRequest {
  @ValidateIf((_o, v) => v !== null) @IsInt() owner_user_id: number | null;
}

/** POST /journey/groups/:groupId/tasks */
export class CreateJourneyTaskRequest {
  @IsString() @MinLength(1) @MaxLength(300) title: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) due_at?: string;
  @IsOptional() @IsInt() assignee_user_id?: number;
  @IsOptional() @IsIn(['manual', 'report']) source?: 'manual' | 'report';
  @IsOptional() @IsInt() report_id?: number;
}

/** PATCH /journey/tasks/:id — omitted fields stay as they are. */
export class UpdateJourneyTaskRequest {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) title?: string;
  @ValidateIf((_o, v) => v !== undefined && v !== null) @Matches(/^\d{4}-\d{2}-\d{2}$/) due_at?: string | null;
  @ValidateIf((_o, v) => v !== undefined && v !== null) @IsInt() assignee_user_id?: number | null;
  @IsOptional() @IsBoolean() done?: boolean;
}

export class JourneyStageInput {
  @IsString() @Matches(/^[a-z0-9_-]{1,32}$/) key: string;
  @IsObject() label: Record<string, string>;
  @IsOptional() @IsString() @MaxLength(9) color?: string | null;
}

/** PUT /journey/stages — the whole ordered list. */
export class SaveJourneyStagesRequest {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => JourneyStageInput)
  stages: JourneyStageInput[];
}

/** GET /journey/board */
export class JourneyBoardQuery {
  @IsOptional() @IsIn(['timeline', 'project']) kind?: 'timeline' | 'project';
  @IsOptional() @Matches(/^\d+$/) owner?: string;
  @IsOptional() @IsIn(['1', 'true']) overdue?: string;
}

/** GET /journey/groups/:groupId/timeline */
export class JourneyTimelineQuery {
  @IsOptional() @IsISO8601() before?: string;
}
