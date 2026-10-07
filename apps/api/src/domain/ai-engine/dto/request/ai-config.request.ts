import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString } from 'class-validator';

class ScenarioButtonDto {
  @IsString() id: string;
  @IsString() label: string;
  @IsString() action: string;
  @IsBoolean() enabled: boolean;
  /** AI agents this button shows for (REQ-260825 R5); empty/absent = all. */
  @IsOptional() @IsArray() @IsInt({ each: true }) agentIds?: number[];
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

  /** Contact footer + protected values (PLN-261007 R4); shape enforced by sanitizeAnswerFooter. */
  @IsOptional() @IsObject() answer_footer?: Record<string, unknown>;

  /** Why this change was made — stored on the revision, never sent to the model. */
  @IsOptional() @IsString() note?: string;

  /** Which AI agent a persona/rules write targets (PLN-260820); omitted = the default agent. */
  @IsOptional() @IsInt() ai_agent_id?: number;
}
