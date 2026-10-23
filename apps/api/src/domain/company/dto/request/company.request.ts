import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { REGION_CODES } from '@sharptalk/types';

/** GET /companies query — snake_case (amoeba_code_convention). PLN-261022 stage 2. */
export class ListCompaniesQuery {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  size?: string;

  /** Substring of the company name. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @IsIn(REGION_CODES as unknown as string[])
  region?: string;
}

/** POST /companies — add a Go2Joy hotel by its number (PLN-261023 D1-③). */
export class AddHotelRequest {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(9_999_999_999)
  hotel_sn: number;
}

/**
 * PATCH /companies/:id/profile — operator-entered hotel profile (PLN-261023).
 * Every field optional; `null` or '' clears it. Partner-synced fields (hours,
 * cancellation policy, room types) are not editable here.
 */
export class UpdateCompanyProfileRequest {
  @IsOptional() @IsString() @MaxLength(200) name?: string | null;
  @IsOptional() @IsString() @MaxLength(64) code?: string | null;
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  @IsOptional() @IsString() @MaxLength(120) province?: string | null;
  @IsOptional() @IsString() @MaxLength(120) district?: string | null;
  @IsOptional() @IsString() @MaxLength(500) address?: string | null;
  @IsOptional() @IsString() @MaxLength(120) group_name?: string | null;
  @IsOptional() @IsBoolean() promotion?: boolean | null;
  @IsOptional() @IsBoolean() hot?: boolean | null;
  @IsOptional() @IsBoolean() is_new?: boolean | null;
  @IsOptional() @ValidateIf((_, v) => v !== '' && v != null) @Matches(/^\d{4}-\d{2}-\d{2}$/) contract_start?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== '' && v != null) @Matches(/^\d{4}-\d{2}-\d{2}$/) contract_end?: string | null;
  @IsOptional() @IsString() @MaxLength(200) payment?: string | null;
  @IsOptional() @IsString() @MaxLength(120) hotel_type?: string | null;
  @IsOptional() @IsString() @MaxLength(200) enterprise_name?: string | null;
  @IsOptional() @IsString() @MaxLength(64) enterprise_reg_no?: string | null;
  @IsOptional() @IsBoolean() extra_fee?: boolean | null;
  @IsOptional() @IsString() @MaxLength(4000) description_en?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) description_vi?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) policy_en?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) policy_vi?: string | null;
}
