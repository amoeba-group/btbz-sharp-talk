import { IsBoolean, IsOptional, IsString } from 'class-validator';

/** Request DTOs — snake_case (amoeba_code_convention). */
export class EnsureSessionRequest {
  @IsOptional() @IsString() session_token?: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() shop_domain?: string;
  /**
   * Origin of the page hosting the widget (PLN-260819 S1). Optional: loaders
   * already installed on live storefronts do not send it, and their absence must
   * not be read as a violation.
   */
  @IsOptional() @IsString() parent_origin?: string;
  /**
   * AI agent code from the embed snippet's `data-agent` (PLN-260820). Unknown
   * or inactive codes fall back to the tenant's default agent — a typo in a
   * snippet must never take the widget down.
   */
  @IsOptional() @IsString() agent_code?: string;
  /**
   * Storefront page the widget is mounted on (PLN-260920). Optional — installs
   * predating this send nothing, and the server normalizes/discards anything it
   * cannot parse, so a bad value never fails the call that mounts the widget.
   */
  @IsOptional() @IsString() landing_path?: string;
}

/** Panel-open ping (PLN-260920). Fire-and-forget; identified by session token. */
export class SessionOpenedRequest {
  @IsString() session_token: string;
}

export class ConsentRequest {
  @IsString() session_token: string;
  @IsBoolean() granted: boolean;
}

export class LanguageRequest {
  @IsString() session_token: string;
  @IsString() language: string;
}
