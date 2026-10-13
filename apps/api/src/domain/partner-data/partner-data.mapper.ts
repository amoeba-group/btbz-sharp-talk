import type { PartnerApiMode } from './partner-data.constants';
import type { PartnerDataSettingsResponse } from './dto/response/partner-data.response';

/** Static mapper (code convention §3): entity-ish inputs in, camelCase response out. */
export class PartnerDataMapper {
  static toSettings(input: {
    enabled: boolean;
    serverEnabled: boolean;
    mode: PartnerApiMode;
    configured: boolean;
    connectionStatus: string | null;
  }): PartnerDataSettingsResponse {
    return {
      enabled: input.enabled,
      serverEnabled: input.serverEnabled,
      mode: input.mode,
      configured: input.configured,
      connectionStatus: input.connectionStatus,
    };
  }
}
