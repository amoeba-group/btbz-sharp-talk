import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { MOBILE_APP_LIMITS, MOBILE_FONT, MOBILE_HEADER, MOBILE_SDK_VERSIONS } from '@sharptalk/types';

/** Request DTOs — snake_case (amoeba_code_convention). Normalised again in `normalizeMobileAppConfig`. */
export class MobileAppSurfaceRequest {
  @IsIn(Object.values(MOBILE_FONT)) font: string;
  @IsInt() @Min(13) @Max(16) font_size: number;
  @IsIn(['card', 'chip']) menu_style: string;
  @IsIn(Object.values(MOBILE_HEADER)) header: string;
  /** `#RRGGBB`, or null/absent for the web brand. */
  @IsOptional() @IsString() @Matches(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i) brand?: string | null;
}

export class MobileAppEntryRequest {
  @IsString() @MaxLength(MOBILE_APP_LIMITS.screen) screen: string;
  @IsString() @MaxLength(MOBILE_APP_LIMITS.agentCode) agent_code: string;
  @IsOptional() @IsString() @MaxLength(MOBILE_APP_LIMITS.contextLabel) context_label?: string | null;
}

/** PATCH /tenants/mobile-app — sent whole, like the widget-access card. */
export class UpdateMobileAppRequest {
  @IsOptional() @ValidateNested() @Type(() => MobileAppSurfaceRequest) app?: MobileAppSurfaceRequest;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MOBILE_APP_LIMITS.maxEntries)
  @ValidateNested({ each: true })
  @Type(() => MobileAppEntryRequest)
  entries?: MobileAppEntryRequest[];
  @IsOptional() @IsIn([...MOBILE_SDK_VERSIONS]) min_sdk?: string;
}
