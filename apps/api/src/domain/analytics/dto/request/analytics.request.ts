import { IsIn, IsOptional, IsString } from 'class-validator';

export class ConversationSearchQuery {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() escalated?: string;
  /** Inclusive lower bound; `YYYY-MM-DD` or ISO-8601. */
  @IsOptional() @IsString() from?: string;
  /** Exclusive upper bound; a bare date widens to the end of that day. */
  @IsOptional() @IsString() to?: string;
  /** Numeric id sent as a string — the query string has no other type. */
  @IsOptional() @IsString() agent_id?: string;
  /** Free-text search over message bodies. */
  @IsOptional() @IsString() q?: string;
  /** 'true'/'1' includes admin-preview sandbox threads (excluded by default). */
  @IsOptional() @IsString() include_preview?: string;
  /** b2b = threads of a B2B company, b2c = the rest (PLN-261022 stage 2). */
  @IsOptional() @IsIn(['b2b', 'b2c']) segment?: string;
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() size?: string;
}

export class QuestionStatsQuery {
  /** intent | category | document | keyword | cluster (default: intent). */
  @IsOptional() @IsString() dimension?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  /** Rows in the ranking table; clamped server-side to 1..100. */
  @IsOptional() @IsString() limit?: string;
}
