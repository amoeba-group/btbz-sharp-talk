import { IsBoolean, IsIn, IsOptional } from 'class-validator';

/** Request DTOs — snake_case (code convention §2). */

/** What `data_mode` may be: an explicit mode, or `inherit` (clear the override, follow the server default). */
export const PARTNER_DATA_MODE_INPUTS = ['prefetch', 'tools', 'inherit'] as const;
export type PartnerDataModeInput = (typeof PARTNER_DATA_MODE_INPUTS)[number];

/**
 * PUT /partner-data/settings — the tenant's "Partner data lookup" switch (PLN-261012 SG-31) and,
 * since SG-33, how its questions are answered. Both fields are optional so a client that only knows
 * the switch keeps working unchanged; at least one must be sent.
 */
export class UpdatePartnerDataSettingsRequest {
  @IsOptional() @IsBoolean() enabled?: boolean;

  /** `prefetch` (default behaviour), `tools` (the model chooses the lookups) or `inherit` (server default). */
  @IsOptional() @IsIn(PARTNER_DATA_MODE_INPUTS as unknown as string[]) data_mode?: PartnerDataModeInput;
}
