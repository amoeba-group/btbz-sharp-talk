import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { INTEGRATION_PROVIDER } from '@sharptalk/types';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { decryptSecret } from '../../global/util/crypto.util';
import type { PartnerCredentials, PartnerCredentialSource } from './http-go2joy.client';

/** How long a decrypted credential stays in memory. Saving a new key takes effect within this. */
const CREDENTIAL_TTL_MS = 60_000;

/**
 * Reads a tenant's partner-API connection (`base_url`, `api_key`, optional
 * `signing_secret`) from `integration_credentials` — the same AES-256-GCM store
 * and the same console flow as every other generic integration (save/test go
 * through EcommerceIntegrationService; this is the read side for the live
 * client). Secrets are never logged and never leave this process.
 */
@Injectable()
export class PartnerCredentialService implements PartnerCredentialSource {
  private readonly logger = new Logger(PartnerCredentialService.name);
  private readonly cache = new Map<number, { at: number; value: PartnerCredentials | null }>();

  constructor(
    @InjectRepository(IntegrationCredential)
    private readonly credRepo: Repository<IntegrationCredential>,
  ) {}

  async get(tenantId: number): Promise<PartnerCredentials | null> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < CREDENTIAL_TTL_MS) return hit.value;
    const value = await this.load(tenantId);
    this.cache.set(tenantId, { at: Date.now(), value });
    return value;
  }

  /** Test hook / future "saved" event: forget what is cached for a tenant. */
  invalidate(tenantId: number): void {
    this.cache.delete(tenantId);
  }

  private async load(tenantId: number): Promise<PartnerCredentials | null> {
    const cred = await this.credRepo.findOne({
      where: { tenantId, provider: INTEGRATION_PROVIDER.GO2JOY_PARTNER_API },
    });
    if (!cred?.secretEnc) return null;
    try {
      const parsed = JSON.parse(decryptSecret(cred.secretEnc)) as Record<string, unknown>;
      const baseUrl = typeof parsed.base_url === 'string' ? parsed.base_url.trim() : '';
      const apiKey = typeof parsed.api_key === 'string' ? parsed.api_key.trim() : '';
      const signingSecret = typeof parsed.signing_secret === 'string' ? parsed.signing_secret.trim() : '';
      if (!baseUrl || !apiKey) return null;
      return { baseUrl, apiKey, ...(signingSecret ? { signingSecret } : {}) };
    } catch {
      // Never include the error text: it could echo ciphertext. A bad blob reads as "not configured".
      this.logger.warn(`partner credential for tenant ${tenantId} could not be decoded`);
      return null;
    }
  }
}
