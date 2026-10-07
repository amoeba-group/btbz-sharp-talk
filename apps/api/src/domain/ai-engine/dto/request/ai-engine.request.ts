import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsUrl,
  ValidateIf,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Tenant-selectable AI functions (FR-070). */
export const AI_FUNCTIONS = ['chat', 'rag', 'summary', 'assist', 'moderation', 'coach'] as const;

// ---- Platform engine catalog ----

export class CreateEngineRequest {
  @IsString() provider: string; // anthropic/openai/google/azure/custom
  @IsString() name: string;
  @IsString() model: string;
  // A URL or nothing (PLN-261007 S8): a browser autofill once saved the console
  // login e-mail here and every call failed with "Failed to parse URL".
  @IsOptional() @IsString() @ValidateIf((o) => o.endpoint != null && o.endpoint !== '') @IsUrl({ require_protocol: true, require_tld: false }) endpoint?: string;
  @IsOptional() @IsString() api_key?: string;
  @IsOptional() @IsString() capabilities?: string;
  @IsOptional() @IsInt() is_default?: number;
  @IsOptional() @IsInt() tenant_id?: number | null;
}

export class UpdateEngineRequest {
  @IsOptional() @IsString() provider?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() @ValidateIf((o) => o.endpoint != null && o.endpoint !== '') @IsUrl({ require_protocol: true, require_tld: false }) endpoint?: string;
  @IsOptional() @IsString() api_key?: string;
  @IsOptional() @IsString() capabilities?: string;
  @IsOptional() @IsString() status?: string; // enabled/disabled
  @IsOptional() @IsInt() is_default?: number;
  /** Platform engines: may tenants choose it (PLN-261007 D1). */
  @IsOptional() @IsBoolean() tenant_selectable?: boolean;
}

// ---- Tenant AI settings ----

export class UpsertAiSettingRequest {
  // Clients echo engine ids back as strings (bigint PKs serialize as strings);
  // coerce before @IsInt so "3" doesn't 400.
  @Type(() => Number) @IsInt() engine_id: number;
  @IsOptional() @IsObject() params?: Record<string, unknown>;
}

/** PUT /ai-settings — one engine for every function at once (PLN-261007 S5). */
export class ApplyAiEngineRequest {
  @Type(() => Number) @IsInt() engine_id: number;
}

export class FunctionParam {
  @IsString() @IsIn(AI_FUNCTIONS as unknown as string[]) function: string;
}

/** POST /tenants/me/ai-engines — the tenant registers its own engine (PLN-260824). */
export class SaveTenantEngineRequest {
  @IsString() @MinLength(1) @MaxLength(64) name: string;

  /** Validated again in the service — the form list is not the boundary. */
  @IsString() @MaxLength(24) provider: string;

  @IsString() @MinLength(1) @MaxLength(64) model: string;

  @IsOptional() @IsString() @MaxLength(255) @ValidateIf((o) => o.endpoint != null && o.endpoint !== '') @IsUrl({ require_protocol: true, require_tld: false }) endpoint?: string;

  /** Omitted on update means "keep the stored key", not "clear it". */
  @IsOptional() @IsString() @MaxLength(512) api_key?: string;
}

export class UpdateTenantEngineRequest {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) name?: string;
  @IsOptional() @IsString() @MaxLength(24) provider?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64) model?: string;
  @IsOptional() @IsString() @MaxLength(255) @ValidateIf((o) => o.endpoint != null && o.endpoint !== '') @IsUrl({ require_protocol: true, require_tld: false }) endpoint?: string;
  @IsOptional() @IsString() @MaxLength(512) api_key?: string;
}

/** GET /tenants/me/ai-usage — 기간·집계축 (PLN-260824 A). */
export class AiUsageQueryRequest {
  /** YYYY-MM-DD. 일·주·월·기간지정 모두 이 두 값으로 표현된다. */
  @IsString() @MaxLength(10) from: string;
  @IsString() @MaxLength(10) to: string;

  @IsOptional() @IsIn(['feature', 'function', 'engine', 'owner']) group_by?: string;
}
