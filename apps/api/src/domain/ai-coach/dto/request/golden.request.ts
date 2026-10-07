import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { GOLDEN_RUN_KIND } from '../../entity/golden-run.entity';

/** Request DTOs — snake_case (code convention §2). */

export class CreateGoldenQuestionRequest {
  @IsString() @MinLength(2) @MaxLength(500) question: string;
  @IsOptional() @IsString() @MaxLength(8) language?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  /** Facts the answer must contain (PLN-261007 R7); shape enforced by sanitizeChecks. */
  @IsOptional() @IsArray() expected?: string[];
  @IsOptional() @IsArray() forbidden?: string[];
}

export class UpdateGoldenQuestionRequest {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(500) question?: string;
  @IsOptional() @IsString() @MaxLength(8) language?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @Type(() => Number) @IsInt() active?: number;
  @IsOptional() @IsArray() expected?: string[];
  @IsOptional() @IsArray() forbidden?: string[];
}

/** POST /ai-coach/golden/questions/bulk — TSV paste (PLN-261007 R7 S4). */
export class BulkGoldenQuestionsRequest {
  @IsString() @MaxLength(100_000) text: string;
  @IsOptional() @IsString() @MaxLength(8) language?: string;
}

export class CreateGoldenRunRequest {
  /**
   * `manual` is a plain snapshot; `noise` re-runs the same config so the natural
   * variance can be told apart from an actual effect.
   */
  @IsOptional() @IsIn([GOLDEN_RUN_KIND.MANUAL, GOLDEN_RUN_KIND.NOISE]) kind?: string;
  @IsOptional() @IsString() @MaxLength(120) label?: string;
  /** Ask as this AI agent (persona + knowledge scope); omitted = no scope. */
  @IsOptional() @Type(() => Number) @IsInt() ai_agent_id?: number;
}

export class CompareRunsQuery {
  @Type(() => Number) @IsInt() base: number;
  @Type(() => Number) @IsInt() target: number;
}
