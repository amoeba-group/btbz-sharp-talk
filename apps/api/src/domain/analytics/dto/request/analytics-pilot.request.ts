import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Query of `GET /analytics/pilot` and `GET /analytics/pilot/conversations.csv` (PLN-261012 SG-52).
 * snake_case like every request DTO. `group` is validated by the service rather than by `@IsIn`, so a
 * bad value answers with the module's own E5140 instead of the generic validation envelope.
 */
export class PilotAnalyticsQuery {
  /** hotel | role | day (default hotel). Ignored by the CSV, which is one row per conversation. */
  @IsOptional() @IsString() @MaxLength(16) group?: string;
  /** Inclusive lower bound; `YYYY-MM-DD` or ISO-8601. Default: 14 days before `to`. */
  @IsOptional() @IsString() @MaxLength(40) from?: string;
  /** Exclusive upper bound; a bare date widens to the end of that day. Default: now. */
  @IsOptional() @IsString() @MaxLength(40) to?: string;
  /** Only conversations stamped with this hotel serial (exact match). */
  @IsOptional() @IsString() @MaxLength(80) hotel_sn?: string;
  /** Only conversations stamped with this signed role (exact match). */
  @IsOptional() @IsString() @MaxLength(80) role?: string;
}
