import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { USER_RANK, USER_REGION } from '@sharptalk/types';
import { IsStrongPassword } from '../../../../global/util/password-policy.util';
import { PASSWORD_MIN_LENGTH } from '../../../../global/constant/security.constant';

/** Request DTOs — snake_case (amoeba_code_convention). */

const RANK_VALUES = Object.values(USER_RANK);
/** '' clears the region (nationwide) — a select has no "null" option. */
const REGION_VALUES = [...Object.values(USER_REGION), ''];

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

  /** Operational region (PLN-261007): north | south; omit or '' = nationwide. */
  @IsOptional()
  @IsString()
  @IsIn(REGION_VALUES)
  region?: string;
}

export class ListUsersQuery {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() size?: string;
  /** Filter by held role label code (PLN-261007). */
  @IsOptional() @IsString() label?: string;
  /** Filter by region; 'none' = nationwide only. */
  @IsOptional() @IsString() @IsIn([...REGION_VALUES, 'none']) region?: string;
}

export class UpdateRegionRequest {
  @IsString()
  @IsIn(REGION_VALUES)
  region: string;
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
