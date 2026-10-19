import { GenericIntegrationProvider, INTEGRATION_FIELDS, INTEGRATION_PROVIDER } from '@sharptalk/types';
import { IntegrationCredential } from './entity/integration-credential.entity';
import { Cafe24CredentialMode, IntegrationSettingsResponse } from './dto/response/tenant.response';

/**
 * Which flow wrote a Cafe24 credential blob (PLN-261019-Cafe24 D1).
 *
 * The OAuth callback stores `{mallId, refreshToken, …}` (camelCase, no access
 * token — Cafe24TokenService mints one on demand); the credential modal stores
 * the `INTEGRATION_FIELDS.cafe24` snake_case keys. The generic probe only
 * understands the second shape, and until this existed it read an OAuth blob as
 * "credentials missing" and flipped the tenant to 'error' (REQ-261019-Cafe24 R1).
 */
export function cafe24CredentialMode(config: Record<string, unknown>): Cafe24CredentialMode | null {
  const has = (k: string) => typeof config[k] === 'string' && (config[k] as string).trim() !== '';
  if (has('mallId') && has('refreshToken')) return 'oauth';
  if (INTEGRATION_FIELDS.cafe24.some((f) => has(f.key))) return 'manual';
  return null;
}

/** Shapes the generic integration settings view. Secret values are never returned. */
export class EcommerceIntegrationMapper {
  static toSettings(
    provider: GenericIntegrationProvider,
    config: Record<string, string>,
    cred: IntegrationCredential | null,
  ): IntegrationSettingsResponse {
    const fields: Record<string, string | null> = {};
    const secrets: Record<string, boolean> = {};
    for (const spec of INTEGRATION_FIELDS[provider]) {
      if (spec.secret) {
        secrets[spec.key] = !!(config[spec.key] && String(config[spec.key]).trim());
      } else {
        fields[spec.key] = config[spec.key] ?? null;
      }
    }
    let mode: Cafe24CredentialMode | null | undefined;
    if (provider === INTEGRATION_PROVIDER.CAFE24) {
      mode = cafe24CredentialMode(config);
      // The OAuth blob keeps the mall under `mallId`; surface it where the console
      // reads every provider's identity, so the card can name the mall.
      if (mode === 'oauth') fields.mall_id = String(config.mallId);
    }
    return {
      provider,
      ...(mode !== undefined ? { mode } : {}),
      fields,
      secrets,
      credential: {
        configured: cred?.secretEnc != null,
        updatedAt: cred?.updatedAt ?? null,
      },
      // Per-tenant connection state — 'connected' only after a real test
      // (FIX-260827); a saved-but-untested credential is 'unknown'.
      integration: {
        status: cred?.status ?? null,
        lastSyncAt: cred?.lastTestedAt ?? null,
        detail: cred?.detail ?? null,
      },
    };
  }
}
