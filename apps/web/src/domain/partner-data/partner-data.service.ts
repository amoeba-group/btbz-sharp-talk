import { apiGet, apiPut } from '@/lib/api-client';

/** How a tenant's partner questions are answered (PLN-261012 SG-33). */
export type PartnerLookupMode = 'prefetch' | 'tools';

/** Partner data lookup switch + connection state (PLN-261012 SG-31). */
export interface PartnerDataSettings {
  /** The tenant's own switch (default off). */
  enabled: boolean;
  /** The server-wide env switch; while it is off the tenant switch has no effect. */
  serverEnabled: boolean;
  /** `mock` = built-in sample hotels; `live` = the real partner API. */
  mode: 'mock' | 'live';
  /** Whether a base URL and key are saved. */
  configured: boolean;
  /** Result of the last connection test, or null. */
  connectionStatus: string | null;
  /** The tenant's own lookup-method override; null = follow the server default (SG-33). */
  dataMode: PartnerLookupMode | null;
  /** What actually runs: the override, else the server default; `prefetch` while the kill switch is on. */
  effectiveMode: PartnerLookupMode;
  /** The server default (PARTNER_DATA_MODE). */
  serverMode: PartnerLookupMode;
  /** False when the server-wide kill switch (PARTNER_TOOLS_ENABLED=0) forces the standard lookup. */
  toolsAllowed: boolean;
  /** Whether the AI engine that answers customers can run lookup tools; absent when unknown. */
  toolsSupport?: { supported: boolean; reason: string };
}

/** What the console may change: either field, or both (at least one). */
export interface PartnerDataSettingsPatch {
  enabled?: boolean;
  /** `inherit` clears the override. */
  data_mode?: PartnerLookupMode | 'inherit';
}

export const partnerDataService = {
  settings: () => apiGet<PartnerDataSettings>('/partner-data/settings'),
  saveEnabled: (enabled: boolean) => apiPut<PartnerDataSettings>('/partner-data/settings', { enabled }),
  save: (patch: PartnerDataSettingsPatch) => apiPut<PartnerDataSettings>('/partner-data/settings', patch),
};
