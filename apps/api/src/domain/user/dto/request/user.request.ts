import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { USER_RANK } from '@sharptalk/types';
import { IsStrongPassword } from '../../../../global/util/password-policy.util';
import { PASSWORD_MIN_LENGTH } from '../../../../global/constant/security.constant';

/** Request DTOs — snake_case (amoeba_code_convention). */

const RANK_VALUES = Object.values(USER_RANK);

export class InviteUserRequest {
  @IsEmail()
  email: string;

  @IsString()
  @IsIn(RANK_VALUES)
  rank: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  label_codes?: string[];

  /** Team (`units.id`) to place the invitee in; omitted or null = none (PLN-261019 P1). */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  unit_id?: number | null;
}

export class AcceptInviteRequest {
  @IsString()
  token: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @IsStrongPassword()
  new_password: string;
}

export class UpdateRankRequest {
  @IsString()
  @IsIn(RANK_VALUES)
  rank: string;
}

export class UpdateLabelsRequest {
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  label_codes: string[];
}

export class UpdateUnitRequest {
  /** `null` clears the assignment. */
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  unit_id: number | null;
}

export class UpdateStatusRequest {
  @IsString()
  @IsIn(['active', 'suspended'])
  status: string;
}

export class IssueTempPasswordRequest {
  // PLN-260824 S4: also email the temp password to the user (default: manual hand-off only).
  @IsOptional()
  @IsBoolean()
  send_email?: boolean;
}
