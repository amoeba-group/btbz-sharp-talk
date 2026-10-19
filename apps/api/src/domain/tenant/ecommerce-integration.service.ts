import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  GENERIC_INTEGRATION_PROVIDERS,
  GenericIntegrationProvider,
  INTEGRATION_FIELDS,
  INTEGRATION_PROVIDER,
  SELF_PLATFORM_PROVIDER,
} from '@sharptalk/types';
import { IntegrationCredential } from './entity/integration-credential.entity';
import { IntegrationService } from '../integration/integration.service';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { decryptSecret, encryptSecret } from '../../global/util/crypto.util';
import { EcommerceIntegrationMapper, cafe24CredentialMode } from './ecommerce-integration.mapper';
import { IntegrationSettingsResponse, IntegrationTestResponse } from './dto/response/tenant.response';
import { probeEcommerce } from './ecommerce-probe.util';

/** Stored as the self platform's `detail`: there is no probe, registration is the state. */
const SELF_PLATFORM_DETAIL = 'Registered — self-hosted platform, nothing to probe';
/** Returned (never stored) when the generic probe meets an OAuth-connected Cafe24 mall. */
const CAFE24_OAUTH_TEST_HINT =
  "Connected through Cafe24 OAuth — use the Cafe24 card's connection test";
/** Keys only the OAuth callback writes; a manual token save replaces them (D1 "수동 전환"). */
const CAFE24_OAUTH_KEYS = ['mallId', 'refreshToken', 'scopes', 'refreshIssuedAt'] as const;

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
    // An operator who types a Cafe24 access token over an OAuth connection is
    // switching to manual mode: drop the OAuth keys rather than keep a blob that
    // answers to both flows (PLN-261019-Cafe24 D1).
    if (
      p === INTEGRATION_PROVIDER.CAFE24 &&
      cafe24CredentialMode(merged) === 'oauth' &&
      String(incoming.access_token ?? '').trim()
    ) {
      for (const k of CAFE24_OAUTH_KEYS) delete merged[k];
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
    const config = this.parseConfig(cred);
    if (p === INTEGRATION_PROVIDER.CAFE24 && cafe24CredentialMode(config) === 'oauth') {
      // The probe reads `mall_id`/`access_token`, which an OAuth blob does not
      // hold. Reporting that as a failed test overwrote a working connection
      // with 'error' (REQ-261019-Cafe24 R1); the OAuth test lives in the Cafe24
      // module (POST /tenants/me/cafe24/test), so point there and leave the
      // recorded state alone.
      return { ok: false, skipped: true, detail: CAFE24_OAUTH_TEST_HINT };
    }
    const result = await probeEcommerce(p, config);
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
