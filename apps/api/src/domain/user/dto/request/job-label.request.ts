import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
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

export class UpdateJobLabelRequest {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name: string;
}
