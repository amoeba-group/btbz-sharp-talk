import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  GENERIC_INTEGRATION_PROVIDERS,
  GenericIntegrationProvider,
  INTEGRATION_FIELDS,
  SELF_PLATFORM_PROVIDER,
} from '@sharptalk/types';
import { IntegrationCredential } from './entity/integration-credential.entity';
import { IntegrationService } from '../integration/integration.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { decryptSecret, encryptSecret } from '../../global/util/crypto.util';
import { EcommerceIntegrationMapper } from './ecommerce-integration.mapper';
import { IntegrationSettingsResponse, IntegrationTestResponse } from './dto/response/tenant.response';
import { probeEcommerce } from './ecommerce-probe.util';

/** Stored as the self platform's `detail`: there is no probe, registration is the state. */
const SELF_PLATFORM_DETAIL = 'Registered — self-hosted platform, nothing to probe';

/**
 * Generic per-tenant e-commerce integration settings (cafe24 / woocommerce / odoo /
 * haravan). Credentials are stored as an AES-256-GCM encrypted JSON blob in the
 * shared `integration_credentials` table, keyed by (tenant, provider). Secrets are
 * never returned — only the non-secret fields and "configured" flags. Shopify keeps
 * its own richer flow (TenantService); this covers the four generic providers.
 */
@Injectable()
export class EcommerceIntegrationService {
  constructor(
    @InjectRepository(IntegrationCredential)
    private readonly credRepo: Repository<IntegrationCredential>,
    private readonly integrationService: IntegrationService,
  ) {}

  // Commerce + marketing + helpdesk all share this generic flow (PLN-260808).
  private assertProvider(provider: string): GenericIntegrationProvider {
    if (!(GENERIC_INTEGRATION_PROVIDERS as readonly string[]).includes(provider)) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    return provider as GenericIntegrationProvider;
  }

  private parseConfig(cred: IntegrationCredential | null): Record<string, string> {
    if (!cred?.secretEnc) return {};
    try {
      const parsed = JSON.parse(decryptSecret(cred.secretEnc)) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  async getSettings(tenantId: number, provider: string): Promise<IntegrationSettingsResponse> {
    const p = this.assertProvider(provider);
    const cred = await this.credRepo.findOne({ where: { tenantId, provider: p } });
    return EcommerceIntegrationMapper.toSettings(p, this.parseConfig(cred), cred ?? null);
  }

  /**
   * Merge the incoming config into the stored blob and re-encrypt. Only fields in
   * the provider schema are kept; empty secret fields leave the stored value intact,
   * while non-secret fields are set (or cleared) from the request.
   */
  async save(
    tenantId: number,
    provider: string,
    incoming: Record<string, string>,
  ): Promise<IntegrationSettingsResponse> {
    const p = this.assertProvider(provider);
    let cred = await this.credRepo.findOne({ where: { tenantId, provider: p } });
    const merged = this.parseConfig(cred);

    for (const spec of INTEGRATION_FIELDS[p]) {
      const raw = incoming[spec.key];
      if (raw === undefined) continue;
      const value = String(raw).trim();
      if (spec.secret) {
        if (value) merged[spec.key] = value; // empty → keep existing secret
      } else {
        merged[spec.key] = value; // non-secret: set or clear
      }
    }

    const secretEnc = encryptSecret(JSON.stringify(merged));
    // Saving credentials is NOT a connection — a real test decides that
    // (FIX-260827). Changing the credential also invalidates any prior test.
    // The one exception is the tenant's own platform (PLN-261019 D4): there is
    // no remote end to probe, so registering it IS the connection.
    const self = p === SELF_PLATFORM_PROVIDER;
    const status = self ? 'connected' : 'unknown';
    const detail = self ? SELF_PLATFORM_DETAIL : null;
    const lastTestedAt = self ? new Date() : null;
    if (cred) {
      cred.secretEnc = secretEnc;
      cred.status = status;
      cred.detail = detail;
      cred.lastTestedAt = lastTestedAt;
    } else {
      cred = this.credRepo.create({ tenantId, provider: p, secretEnc, status, detail, lastTestedAt });
    }
    await this.credRepo.save(cred);
    return this.getSettings(tenantId, p);
  }

  /** Live connectivity test; records the outcome in integration_status. */
  async test(tenantId: number, provider: string): Promise<IntegrationTestResponse> {
    const p = this.assertProvider(provider);
    const cred = await this.credRepo.findOne({ where: { tenantId, provider: p } });
    if (p === SELF_PLATFORM_PROVIDER) {
      // Nothing to reach: the console hides the test button, and a direct call
      // must not flip a registered platform to 'error'.
      return { ok: cred != null, detail: cred ? SELF_PLATFORM_DETAIL : 'Not registered' };
    }
    const result = await probeEcommerce(p, this.parseConfig(cred));
    // Record the outcome on THIS tenant's credential — the per-tenant source of
    // truth the tiles/dashboard read (FIX-260827). No global write: that table
    // is provider-keyed and would leak one tenant's result to another.
    if (cred) {
      cred.status = result.ok ? 'connected' : 'error';
      cred.detail = result.detail.slice(0, 255);
      cred.lastTestedAt = new Date();
      await this.credRepo.save(cred);
    }
    return result;
  }
}
