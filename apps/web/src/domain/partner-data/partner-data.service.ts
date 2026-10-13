import { apiGet, apiPut } from '@/lib/api-client';

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
}

export const partnerDataService = {
  settings: () => apiGet<PartnerDataSettings>('/partner-data/settings'),
  saveEnabled: (enabled: boolean) => apiPut<PartnerDataSettings>('/partner-data/settings', { enabled }),
};
