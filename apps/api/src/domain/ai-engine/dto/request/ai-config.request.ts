import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

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

/** What the routing simulator is asked about (PLN-261024 D6). All optional — empty = "unknown". */
class RoutingSimulateContextDto {
  @IsOptional() @IsString() @MaxLength(64) consult_category?: string;
  @IsOptional() @IsString() @MaxLength(64) region?: string;
  @IsOptional() @IsString() @MaxLength(120) province?: string;
  @IsOptional() @IsString() @MaxLength(8) language?: string;
  @IsOptional() @IsString() @MaxLength(500) text?: string;
  @IsOptional() @IsString() @MaxLength(32) identity_level?: string;
  @IsOptional() @IsString() @MaxLength(120) hotel_name?: string;
}

/** POST /ai-config/routing/simulate — the rules being edited (handoff_config shape) and a context. */
export class RoutingSimulateRequest {
  @IsArray() @ArrayMaxSize(100) @IsObject({ each: true }) rules: Record<string, unknown>[];
  @IsOptional() @IsArray() @ArrayMaxSize(100) assignee_user_ids?: number[];
  @ValidateNested() @Type(() => RoutingSimulateContextDto) context: RoutingSimulateContextDto;
}
