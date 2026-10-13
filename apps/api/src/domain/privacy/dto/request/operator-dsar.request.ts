import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, MaxLength, Min } from 'class-validator';

/** Request DTOs for the operator DSAR tool — snake_case (amoeba_code_convention). */

export const DSAR_LOOKUP_BY = ['email', 'phone', 'external_id'] as const;
export type DsarLookupBy = (typeof DSAR_LOOKUP_BY)[number];

/**
 * The search term travels in the BODY, never the query string: a customer's
 * address in a URL ends up in every proxy access log and in browser history,
 * neither of which any retention window reaches (same rule as customer search,
 * PLN-260920 P3).
 */
export class DsarLookupRequest {
  @IsIn(DSAR_LOOKUP_BY as unknown as string[]) by: DsarLookupBy;
  @IsString() @Length(1, 320) term: string;
}

export class DsarExportRequest {
  // @Type: a bigint id that travelled as a string must still validate as an integer.
  @Type(() => Number) @IsInt() @Min(1) customer_id: number;
  /** Where the request came from (ticket / email id) — recorded in the audit row only. */
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
}

export class DsarEraseRequest {
  @Type(() => Number) @IsInt() @Min(1) customer_id: number;
  /** Must repeat `customer_id`: a second, deliberate step before an irreversible action. */
  @Type(() => Number) @IsInt() @Min(1) confirm_customer_id: number;
  @IsBoolean() confirm: boolean;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
}
