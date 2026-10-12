import { IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { GUEST_POLICY, type GuestPolicy } from '@sharptalk/types';

/** Request DTOs — snake_case (amoeba_code_convention). */
export class CreateAiAgentRequest {
  /** Routing key for embed snippets/channel bindings; lowercased, locked after create. */
  @IsString() @MaxLength(64) code: string;

  @IsString() @MaxLength(100) name: string;

  @IsOptional() @IsString() @MaxLength(4000) persona?: string;

  @IsOptional() @IsArray() @IsString({ each: true }) rules?: string[];

  /** Guest policy (PLN-261001 v1.1); omitted = `open`. */
  @IsOptional() @IsIn(Object.values(GUEST_POLICY)) guest_policy?: GuestPolicy;
}

export class UpdateAiAgentRequest {
  @IsOptional() @IsString() @MaxLength(100) name?: string;

  /** Shopper-facing name (REQ-260825 R4); blank clears back to the tenant name. */
  @IsOptional() @IsString() @MaxLength(100) display_name?: string;

  @IsOptional() @IsString() @MaxLength(4000) persona?: string;

  @IsOptional() @IsArray() @IsString({ each: true }) rules?: string[];

  /** Per-agent first message, lang→text (REQ-260825 R3); server sanitizes keys. */
  @IsOptional() @IsObject() greeting?: Record<string, string>;

  @IsOptional() @IsBoolean() active?: boolean;

  /** `open` | `login_guidance` (PLN-261001 v1.1). */
  @IsOptional() @IsIn(Object.values(GUEST_POLICY)) guest_policy?: GuestPolicy;
}
