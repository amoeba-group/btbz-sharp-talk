import { IsBoolean } from 'class-validator';

/** Request DTOs — snake_case (code convention §2). */

/** PUT /partner-data/settings — the tenant's "Partner data lookup" switch (PLN-261012 SG-31). */
export class UpdatePartnerDataSettingsRequest {
  @IsBoolean() enabled: boolean;
}
