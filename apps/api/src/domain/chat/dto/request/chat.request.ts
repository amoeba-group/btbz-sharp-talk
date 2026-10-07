import { Type } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Request DTOs — snake_case (amoeba_code_convention). */
export class SendMessageRequest {
  @IsString() session_token: string;
  /**
   * May be empty when the turn carries files instead (PLN-260814). "Neither
   * text nor attachments" is refused in the controller — the DTO alone cannot
   * express that either-or.
   */
  @IsString() message: string;
  /** Attachment uuids from POST /files/upload, in display order. */
  @IsOptional() @IsArray() @IsString({ each: true }) attachment_ids?: string[];
}

/** POST /chat/end — customer ends the current conversation (PLN-260808 Track B). */
export class EndChatRequest {
  @IsString() session_token: string;
}

export class EscalateRequest {
  @IsString() session_token: string;
  // Widget echoes the id back as a string (bigint PKs serialize as strings).
  @Type(() => Number) @IsInt() conversation_id: number;
  /** Team option id from the chip the customer tapped (PLN-261007 Team Routing). */
  @IsOptional() @IsString() @MaxLength(32) support_type?: string;
}

export class ScenarioRequest {
  @IsString() session_token: string;
  @IsString() @MinLength(1) action: string;
  /**
   * What to ask on the shopper's behalf when the action has no script — the
   * button's own message, or its label. Ignored for scripted actions.
   */
  @IsOptional() @IsString() @MaxLength(500) text?: string;
}

/** Address an off-hours shopper wants the answer sent to (PLN-260806). */
export class ContactEmailRequest {
  @IsString() session_token: string;
  @IsEmail() @MaxLength(255) email: string;
}

/** Star rating for a finished conversation (PLN-260810 P2). */
export class RateChatRequest {
  @IsString() session_token: string;
  @Type(() => Number) @IsInt() conversation_id: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(5) rating: number;
}
