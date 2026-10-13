import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AI_FUNCTION, INTEGRATION_PROVIDER } from '@sharptalk/types';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { AuditService } from '../audit/audit.service';
import { AiGatewayService } from '../../infrastructure/external/ai/ai-gateway.service';
import { PartnerDataMapper } from './partner-data.mapper';
import type { PartnerDataSettingsResponse } from './dto/response/partner-data.response';
import type { PartnerDataModeInput } from './dto/request/partner-data.request';
import { PARTNER_DATA_MODE } from './partner-data.constants';
import { PartnerFlagService, partnerEnvMode, partnerToolsAllowed } from './partner-flag.service';

/**
 * The tenant's "Partner data lookup" switch (PLN-261012 SG-31) — console read
 * and write. Turning a data feed on for a tenant is a privileged action, so it
 * is audited; the credentials themselves go through the generic integration flow
 * (`go2joy_partner_api`).
 *
 * Since SG-33 it also carries how the tenant's partner questions are answered
 * (`prefetch` or model-driven `tools`). Changing that is audited too: it decides
 * whether a model chooses lookups, which is exactly the kind of switch an operator
 * must be able to find in the audit trail.
 */
@Injectable()
export class PartnerSettingsService {
  private readonly logger = new Logger(PartnerSettingsService.name);

  constructor(
    private readonly flags: PartnerFlagService,
    private readonly audit: AuditService,
    @InjectRepository(IntegrationCredential)
    private readonly credRepo: Repository<IntegrationCredential>,
    // Appended and optional so positional test doubles that predate SG-33 stay valid.
    @Optional() private readonly gateway?: AiGatewayService,
  ) {}

  async get(tenantId: number): Promise<PartnerDataSettingsResponse> {
    const [enabled, cred, dataMode, toolsSupport] = await Promise.all([
      this.flags.tenantFlag(tenantId),
      this.credRepo.findOne({ where: { tenantId, provider: INTEGRATION_PROVIDER.GO2JOY_PARTNER_API } }),
      this.flags.tenantMode(tenantId),
      this.toolsSupport(tenantId),
    ]);
    const toolsAllowed = partnerToolsAllowed();
    return PartnerDataMapper.toSettings({
      enabled,
      serverEnabled: this.flags.serverEnabled(),
      mode: this.flags.mode(),
      configured: cred?.secretEnc != null,
      connectionStatus: cred?.status ?? null,
      dataMode,
      effectiveMode: toolsAllowed ? (dataMode ?? partnerEnvMode()) : PARTNER_DATA_MODE.PREFETCH,
      serverMode: partnerEnvMode(),
      toolsAllowed,
      toolsSupport,
    });
  }

  async setEnabled(tenantId: number, userId: number, enabled: boolean): Promise<PartnerDataSettingsResponse> {
    await this.flags.setTenantFlag(tenantId, enabled);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId: userId,
      action: enabled ? 'partner_data.enabled' : 'partner_data.disabled',
      target: `tenant:${tenantId}`,
      metadata: { mode: this.flags.mode(), serverEnabled: this.flags.serverEnabled() },
    });
    return this.get(tenantId);
  }

  /** Set the lookup mode override (`inherit` clears it). Audited, with the previous value. */
  async setDataMode(tenantId: number, userId: number, input: PartnerDataModeInput): Promise<PartnerDataSettingsResponse> {
    const next = input === 'inherit' ? null : input;
    const previous = await this.flags.tenantMode(tenantId);
    await this.flags.setTenantMode(tenantId, next);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId: userId,
      action: 'partner_data.mode_changed',
      target: `tenant:${tenantId}`,
      metadata: { from: previous, to: next, serverMode: partnerEnvMode(), toolsAllowed: partnerToolsAllowed() },
    });
    return this.get(tenantId);
  }

  /** Can the engine that answers this tenant's customers run lookup tools? Omitted when unknowable. */
  private async toolsSupport(tenantId: number): Promise<{ supported: boolean; reason: string } | undefined> {
    if (!this.gateway) return undefined;
    try {
      const s = await this.gateway.toolSupport(tenantId, AI_FUNCTION.RAG);
      return { supported: s.supported, reason: s.reason };
    } catch (e) {
      this.logger.warn(`tool support unreadable for tenant ${tenantId}: ${(e as Error).message}`);
      return undefined;
    }
  }
}
