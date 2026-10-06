import { IsEmail, IsIn, IsInt, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { IDENTITY_ROLE, type IdentityRole } from '@sharptalk/types';

/**
 * identify v2 claims (PLN-261001 v1.1 H1 / REQ-261006). `hotel_sn`, `role` and
 * `iat` are covered by `hash` — HMAC over `user_id|hotel_sn|role|iat`; the
 * name and code are display text and are not signed.
 */
export class EmbedIdentifyClaimsRequest {
  @IsString() @MaxLength(32) hotel_sn: string;

  @IsIn(Object.values(IDENTITY_ROLE)) role: IdentityRole;

  /** Unix seconds at signing time; accepted within ±10 minutes (replay guard). */
  @IsInt() iat: number;

  @IsOptional() @IsString() @MaxLength(200) hotel_name?: string;

  @IsOptional() @IsString() @MaxLength(64) hotel_code?: string;
}

/** Request DTOs — snake_case (amoeba_code_convention). */
export class EmbedIdentifyRequest {
  @IsString() session_token: string;
  /** The id the customer's own system uses; length-capped to the stored column. */
  @IsString() @MaxLength(120) user_id: string;
  /**
   * Hex HMAC-SHA256 with the tenant's embed secret: over `user_id` alone (v1),
   * or over `user_id|hotel_sn|role|iat` when `claims` is present (v2).
   */
  @IsString() @MaxLength(128) hash: string;

  /** Present = v2; the signature must then cover the claims (never v1 + claims). */
  @IsOptional()
  @ValidateNested()
  @Type(() => EmbedIdentifyClaimsRequest)
  claims?: EmbedIdentifyClaimsRequest;

  // Profile fields are NOT signed — they fill gaps in the customer record and
  // are never trusted to establish who the visitor is.
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsEmail() @MaxLength(320) email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
}
