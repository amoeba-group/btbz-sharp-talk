import { IsEmail, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

/** Request DTOs — snake_case (amoeba_code_convention). */
export class EmbedIdentifyRequest {
  @IsString() session_token: string;
  /** The id the customer's own system uses; length-capped to the stored column. */
  @IsString() @MaxLength(120) user_id: string;
  /**
   * Hex HMAC-SHA256 with the tenant's embed secret over `user_id`, or — when
   * `attributes` is sent — over `user_id` + `\n` + `key=value` lines in
   * alphabetical key order (PLN-261015 D2).
   */
  @IsString() @MaxLength(128) hash: string;

  // Profile fields are NOT signed — they fill gaps in the customer record and
  // are never trusted to establish who the visitor is.
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsEmail() @MaxLength(320) email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;

  /**
   * Signed facts about the user — spec v1.4: hotel_id, hotel_name, province_sn,
   * role (region and province are still accepted from v1.3 senders). Other keys
   * are ignored. Included in the signature, unlike the profile fields.
   */
  @IsOptional() @IsObject() attributes?: Record<string, unknown>;
}
