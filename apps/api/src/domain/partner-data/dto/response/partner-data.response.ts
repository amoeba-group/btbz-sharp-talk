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
  /**
   * The tenant's own lookup-mode override (PLN-261012 SG-33): `prefetch`, `tools`, or null =
   * follow the server default.
   */
  dataMode: 'prefetch' | 'tools' | null;
  /** What actually runs: the override, else PARTNER_DATA_MODE; `prefetch` while the kill switch is on. */
  effectiveMode: 'prefetch' | 'tools';
  /** The server default (PARTNER_DATA_MODE). */
  serverMode: 'prefetch' | 'tools';
  /** False when PARTNER_TOOLS_ENABLED=0 forces every tenant to prefetch. */
  toolsAllowed: boolean;
  /**
   * Whether the AI engine that answers this tenant's customers can run lookup tools (provider adapter
   * AND the engine's `tools` capability). When it cannot, tools mode falls back to prefetch on every
   * turn. Omitted when it could not be determined.
   */
  toolsSupport?: { supported: boolean; reason: string };
}
