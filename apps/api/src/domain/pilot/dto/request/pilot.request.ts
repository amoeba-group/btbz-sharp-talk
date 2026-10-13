import { IsBoolean, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { PILOT_NON_PILOT, PILOT_NOTE_MAX_LENGTH } from '@sharptalk/types';
import type { PilotNonPilot } from '@sharptalk/types';
import { PILOT_IMPORT_MAX_CHARS } from '../../pilot.util';

/** Request DTOs — snake_case (amoeba_code_convention). */

/**
 * The pilot switch, sent whole (PLN-261012 SG-40). `notice` keys are validated by
 * the service against the registered languages; a stray key is refused with
 * E5133 there rather than dropped here, so a typo is heard about.
 */
export class UpdatePilotAccessRequest {
  @IsBoolean() enabled: boolean;
  @IsBoolean() guest_allowed: boolean;
  @IsIn(Object.values(PILOT_NON_PILOT)) non_pilot: PilotNonPilot;
  @IsOptional() @IsObject() notice?: Record<string, string>;
}

/** One hotel. `hotel_sn` is validated by the service so the reply carries E5130. */
export class AddPilotHotelRequest {
  @IsString() @MaxLength(64) hotel_sn: string;
  @IsOptional() @IsString() @MaxLength(PILOT_NOTE_MAX_LENGTH) note?: string | null;
}

/** A pasted list or the text of a CSV file, previewed (`dry_run`) or applied. */
export class ImportPilotHotelsRequest {
  @IsString() @MaxLength(PILOT_IMPORT_MAX_CHARS) text: string;
  @IsOptional() @IsBoolean() dry_run?: boolean;
}

/** Pause or resume one hotel without losing its row. */
export class UpdatePilotHotelRequest {
  @IsBoolean() active: boolean;
}

/** Query params are snake_case strings, like every other list endpoint. */
export class ListPilotHotelsQuery {
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() size?: string;
  /** Serial prefix or a word of the note. */
  @IsOptional() @IsString() @MaxLength(64) q?: string;
  /** 'true' | 'false' — omit for both. */
  @IsOptional() @IsIn(['true', 'false']) active?: string;
}
