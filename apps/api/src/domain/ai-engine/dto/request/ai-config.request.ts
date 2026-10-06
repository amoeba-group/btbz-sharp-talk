import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString } from 'class-validator';
import { SCENARIO_AUDIENCE, type ScenarioAudience } from '@sharptalk/types';

class ScenarioButtonDto {
  @IsString() id: string;
  @IsString() label: string;
  @IsString() action: string;
  @IsBoolean() enabled: boolean;
  /** AI agents this button shows for (REQ-260825 R5); empty/absent = all. */
  @IsOptional() @IsArray() @IsInt({ each: true }) agentIds?: number[];
  /** Who sees it (PLN-261001 v1.1): all | guest | verified; absent = all. */
  @IsOptional() @IsIn(Object.values(SCENARIO_AUDIENCE)) audience?: ScenarioAudience;
}

/** /ai-setting preview sandbox session (PLN-AiSetting-Preview W1). */
export class CreatePreviewSessionRequest {
  @IsOptional() @IsString() language?: string; // en/es/ko

  /** Which AI agent to preview as (PLN-260820); omitted = the default agent. */
  @IsOptional() @IsInt() ai_agent_id?: number;
}

/** Request DTO — snake_case. */
export class UpdateAiConfigRequest {
  @IsOptional() @IsString() persona?: string;

  @IsOptional() @IsArray() @IsString({ each: true }) rules?: string[];

  @IsOptional() @IsArray() scenario_buttons?: ScenarioButtonDto[];

  /**
   * Per-action script edits keyed by scenario action. Shape is validated and
   * pruned in AiConfigService.sanitizeOverrides (blank fields fall back to the
   * built-in script), so an object check is the right depth here.
   */
  @IsOptional() @IsObject() scenario_overrides?: Record<string, unknown>;

  /** Escalation routing; shape is documented on HandoffConfig (entity). */
  @IsOptional() @IsObject() handoff_config?: Record<string, unknown>;

  /**
   * Sign-in guidance for gated guests (PLN-261001 v1.1): `{ login_url,
   * signup_url, notice: {EN: …}, host_link_template }`. Pruned/validated in
   * AiConfigService.sanitizeGuestGuidance (https URLs only, known languages).
   */
  @IsOptional() @IsObject() guest_guidance?: Record<string, unknown>;

  /** Why this change was made — stored on the revision, never sent to the model. */
  @IsOptional() @IsString() note?: string;

  /** Which AI agent a persona/rules write targets (PLN-260820); omitted = the default agent. */
  @IsOptional() @IsInt() ai_agent_id?: number;
}
