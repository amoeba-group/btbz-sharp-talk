import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ORG_CODE_PATTERN } from '../../default-org';

/** Request DTOs — snake_case (amoeba_code_convention). PLN-261019 P1. */

export class CreateUnitRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(24)
  @Matches(ORG_CODE_PATTERN)
  code: string;

  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;
}

/**
 * Places a unit/label covers (PLN-261022 stage 1). Regions are the tenant's
 * routing category codes (PLN-261024) — the service refuses a code that is not
 * one (E5109), since a typo would make a team silently unreachable. Province
 * names are the tenant's own list (NFC-normalised and de-duplicated server-side).
 * Omitted = unchanged; an empty array clears it.
 */
export class RegionScopeRequest {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  regions?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  provinces?: string[];
}

/** Rename and/or set the covered places — at least one field is expected. */
export class UpdateUnitRequest extends RegionScopeRequest {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;
}
