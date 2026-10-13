import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { INTEGRATION_PROVIDER } from '@sharptalk/types';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { AuditService } from '../audit/audit.service';
import { PartnerDataMapper } from './partner-data.mapper';
import type { PartnerDataSettingsResponse } from './dto/response/partner-data.response';
import { PartnerFlagService } from './partner-flag.service';

/**
 * The tenant's "Partner data lookup" switch (PLN-261012 SG-31) — console read
 * and write. Turning a data feed on for a tenant is a privileged action, so it
 * is audited; the credentials themselves go through the generic integration flow
 * (`go2joy_partner_api`).
 */
@Injectable()
export class PartnerSettingsService {
  constructor(
    private readonly flags: PartnerFlagService,
    private readonly audit: AuditService,
    @InjectRepository(IntegrationCredential)
    private readonly credRepo: Repository<IntegrationCredential>,
  ) {}

  async get(tenantId: number): Promise<PartnerDataSettingsResponse> {
    const [enabled, cred] = await Promise.all([
      this.flags.tenantFlag(tenantId),
      this.credRepo.findOne({ where: { tenantId, provider: INTEGRATION_PROVIDER.GO2JOY_PARTNER_API } }),
    ]);
    return PartnerDataMapper.toSettings({
      enabled,
      serverEnabled: this.flags.serverEnabled(),
      mode: this.flags.mode(),
      configured: cred?.secretEnc != null,
      connectionStatus: cred?.status ?? null,
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
}
