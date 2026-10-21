import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { RegionScopeRequest } from './unit.request';
import { ORG_CODE_PATTERN } from '../../default-org';

/** Request DTOs — snake_case (amoeba_code_convention). */

export class CreateJobLabelRequest {
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

/** Rename and/or set the covered places — at least one field is expected. */
export class UpdateJobLabelRequest extends RegionScopeRequest {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;
}
