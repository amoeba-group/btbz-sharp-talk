import type { PartnerApiMode, PartnerDataMode } from './partner-data.constants';
import type { PartnerDataSettingsResponse } from './dto/response/partner-data.response';

/** Static mapper (code convention §3): entity-ish inputs in, camelCase response out. */
export class PartnerDataMapper {
  static toSettings(input: {
    enabled: boolean;
    serverEnabled: boolean;
    mode: PartnerApiMode;
    configured: boolean;
    connectionStatus: string | null;
    dataMode: PartnerDataMode | null;
    effectiveMode: PartnerDataMode;
    serverMode: PartnerDataMode;
    toolsAllowed: boolean;
    toolsSupport?: { supported: boolean; reason: string };
  }): PartnerDataSettingsResponse {
    return {
      enabled: input.enabled,
      serverEnabled: input.serverEnabled,
      mode: input.mode,
      configured: input.configured,
      connectionStatus: input.connectionStatus,
      dataMode: input.dataMode,
      effectiveMode: input.effectiveMode,
      serverMode: input.serverMode,
      toolsAllowed: input.toolsAllowed,
      ...(input.toolsSupport ? { toolsSupport: input.toolsSupport } : {}),
    };
  }
}
