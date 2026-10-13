/** Response DTOs — camelCase (code convention §2). */

export interface PartnerDataSettingsResponse {
  /** The tenant's own switch (default off). */
  enabled: boolean;
  /**
   * The server-wide PARTNER_DATA_ENABLED env. While it is off the tenant switch
   * has no effect — the console says so instead of letting the toggle look live.
   */
  serverEnabled: boolean;
  /** `mock` = built-in fixtures (no real data); `live` = the real partner API. */
  mode: 'mock' | 'live';
  /** Whether a base URL and key are saved (only relevant in live mode). */
  configured: boolean;
  /** Result of the last connection test, or null when never tested. */
  connectionStatus: string | null;
}
