import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { REGION_CODES } from '@sharptalk/types';
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
 * Places a unit/label covers (PLN-261022 stage 1). Regions are catalogue codes
 * only — free text would let a typo make a team silently unreachable. Province
 * names are the tenant's own list (NFC-normalised and de-duplicated server-side).
 * Omitted = unchanged; an empty array clears it.
 */
export class RegionScopeRequest {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(REGION_CODES.length)
  @IsIn(REGION_CODES as unknown as string[], { each: true })
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
