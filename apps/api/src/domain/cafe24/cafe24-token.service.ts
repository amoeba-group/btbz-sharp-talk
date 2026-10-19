import { createHash } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { INTEGRATION_PROVIDER } from '@sharptalk/types';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { encryptSecret, decryptSecret } from '../../global/util/crypto.util';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { cafe24ApiHost } from './cafe24-admin.client';
import { logSafe } from './cafe24-mall';

const CAFE24 = INTEGRATION_PROVIDER.CAFE24;
const ACCESS_TTL_MARGIN_MS = 60_000;

/** Encrypted Cafe24 credential payload (stored as JSON in integration_credentials). */
export interface Cafe24Credential {
  mallId: string;
  refreshToken: string;
  scopes?: string[];
  refreshIssuedAt?: number;
}

/**
 * Resolves a tenant's Cafe24 connection (mall + a fresh access token). Access
 * tokens live ~2h and are cached in memory only; the refresh token (14d, rotating)
 * is the persisted secret. Mirrors SharpTalk's Shopify token-refresh design, ported
 * from btbz-shop-pmm's `cafe24-token.service`.
 */
@Injectable()
export class Cafe24TokenService {
  private readonly logger = new Logger(Cafe24TokenService.name);
  /**
   * Access tokens by tenant. `credKey` fingerprints the stored credential the
   * token was minted from: a reconnect through the console rewrites the row,
   * and until that was checked the cache kept serving the token of the OLD
   * grant for up to two hours — so re-authorising a mall whose permissions
   * had shrunk changed nothing visible (staging amoebaorder, 2026-10-19:
   * reconnect 16:52, test still 403 insufficient_scope).
   */
  private readonly accessCache = new Map<number, { token: string; expiresAt: number; credKey: string }>();
  private readonly refreshInFlight = new Map<number, Promise<string | null>>();

  constructor(
    @InjectRepository(IntegrationCredential)
    private readonly credRepo: Repository<IntegrationCredential>,
  ) {}

  static appConfig(): { clientId: string; clientSecret: string } {
    const clientId = process.env.CAFE24_CLIENT_ID ?? '';
    const clientSecret = process.env.CAFE24_CLIENT_SECRET ?? '';
    if (!clientId || !clientSecret) {
      throw new BusinessException(ERROR_CODE.CAFE24_APP_NOT_CONFIGURED, HttpStatus.NOT_IMPLEMENTED);
    }
    return { clientId, clientSecret };
  }

  parseCredential(json: string): Cafe24Credential | null {
    try {
      const p = JSON.parse(json) as Partial<Cafe24Credential>;
      if (!p.mallId || !p.refreshToken) return null;
      return { mallId: p.mallId, refreshToken: p.refreshToken, scopes: p.scopes, refreshIssuedAt: p.refreshIssuedAt };
    } catch {
      return null;
    }
  }

  /**
   * Map a Cafe24 mall id → the tenant that connected it. Used by the @Public
   * customer-auth start endpoint, where the storefront host is the only signal.
   * mall_id lives inside the AES-encrypted credential, so this scans+decrypts Cafe24
   * rows (few per deployment); returns null when no tenant owns the mall.
   */
  async findTenantIdByMallId(mallId: string): Promise<number | null> {
    const owners = await this.findMallOwners(mallId);
    if (owners.length === 1) return owners[0];
    if (owners.length > 1) {
      // Two tenants holding the same mall used to resolve to whichever row the
      // scan reached first — an arbitrary answer that would sign a shopper into
      // the wrong tenant's session. Refuse and say so; sign-in failing loudly
      // beats it succeeding as the wrong merchant (REQ-260819).
      this.logger.error(
        `Cafe24 mall "${logSafe(mallId, 60)}" is claimed by ${owners.length} tenants ` +
          `(${owners.join(', ')}) — refusing to guess. Disconnect all but its real owner.`,
      );
      return null;
    }
    this.logger.warn(`Cafe24 mall "${logSafe(mallId, 60)}" is not connected to any tenant`);
    return null;
  }

  /**
   * Every tenant that currently claims `mallId`.
   *
   * Callers that must tell "nobody owns it" from "several do" need this rather
   * than `findTenantIdByMallId`, which answers null to both — a distinction the
   * install guard got wrong on its first pass: a mall already double-claimed
   * read as free, so a third tenant could have connected it too.
   *
   * mall_id lives inside the AES-encrypted credential, so this scans+decrypts
   * the Cafe24 rows (a handful per deployment).
   */
  async findMallOwners(mallId: string): Promise<number[]> {
    const creds = await this.credRepo.find({ where: { provider: CAFE24 } });
    const owners: number[] = [];
    for (const c of creds) {
      if (!c.secretEnc) continue;
      const parsed = this.parseCredential(decryptSecret(c.secretEnc));
      if (parsed?.mallId === mallId && !owners.includes(c.tenantId)) owners.push(c.tenantId);
    }
    return owners;
  }

  /** Resolve mall + a valid access token for a tenant, or null if not connected. */
  async getConnection(tenantId: number): Promise<{ mallId: string; accessToken: string } | null> {
    const cred = await this.credRepo.findOne({ where: { tenantId, provider: CAFE24 } });
    if (!cred?.secretEnc) return null;
    const parsed = this.parseCredential(decryptSecret(cred.secretEnc));
    if (!parsed) return null;
    const cached = this.accessCache.get(tenantId);
    if (
      cached &&
      cached.expiresAt - Date.now() > ACCESS_TTL_MARGIN_MS &&
      cached.credKey === credentialKey(cred)
    ) {
      return { mallId: parsed.mallId, accessToken: cached.token };
    }
    const token = await this.refresh(tenantId, parsed, cred);
    return token ? { mallId: parsed.mallId, accessToken: token } : null;
  }

  /**
   * Rotate the access token via grant_type=refresh_token. Single-flight per tenant:
   * Cafe24 rotates the refresh token on every use, so a concurrent second refresh
   * with the old token would be rejected.
   */
  private refresh(
    tenantId: number,
    parsed: Cafe24Credential,
    cred: IntegrationCredential,
  ): Promise<string | null> {
    const existing = this.refreshInFlight.get(tenantId);
    if (existing) return existing;
    const run = (async (): Promise<string | null> => {
      try {
        const { clientId, clientSecret } = Cafe24TokenService.appConfig();
        const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        const res = await fetch(`${cafe24ApiHost(parsed.mallId)}/api/v2/oauth/token`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basic}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: parsed.refreshToken,
          }).toString(),
        });
        if (!res.ok) {
          this.logger.warn(`cafe24 token refresh failed for tenant ${tenantId}: ${res.status}`);
          return null;
        }
        const data = (await res.json()) as {
          access_token?: string;
          expires_in?: number | string;
          refresh_token?: string;
          scopes?: string[];
        };
        if (!data.access_token) return null;

        // What the mall grants can shrink without anyone here doing anything —
        // an operator changes the app's permissions, or reinstalls it with
        // fewer. Until this was read, the scopes recorded at connect time were
        // copied forward on every refresh forever, so the stored credential
        // kept claiming a permission the live token no longer had. The only
        // symptom was a 403 at sync time, half an hour later, with a record
        // that flatly contradicted it (staging: amoebaorder listed
        // `mall.read_order` while /orders answered insufficient_scope).
        const grantedScopes = Array.isArray(data.scopes) ? data.scopes : null;
        const lost = grantedScopes
          ? (parsed.scopes ?? []).filter((s) => !grantedScopes.includes(s))
          : [];
        if (lost.length) {
          // Loud, because the sync failure it causes is not self-explanatory:
          // the fix is re-authorising the mall, which no log line said before.
          this.logger.warn(
            `cafe24 tenant ${tenantId} (${parsed.mallId}) no longer grants ` +
              `${lost.join(', ')} — re-authorise the mall to restore it`,
          );
        }

        const rotated = !!data.refresh_token && data.refresh_token !== parsed.refreshToken;
        const scopesChanged =
          !!grantedScopes &&
          JSON.stringify(grantedScopes) !== JSON.stringify(parsed.scopes ?? null);
        // Saved when either changes: a scope change with an unrotated token
        // would otherwise never reach the record.
        if (rotated || scopesChanged) {
          const next: Cafe24Credential = {
            ...parsed,
            ...(rotated
              ? { refreshToken: data.refresh_token as string, refreshIssuedAt: Date.now() }
              : {}),
            ...(grantedScopes ? { scopes: grantedScopes } : {}),
          };
          cred.secretEnc = encryptSecret(JSON.stringify(next));
          await this.credRepo.save(cred);
        }
        const ttlMs = (Number(data.expires_in) || 7200) * 1000;
        // Keyed to the credential as it is NOW (after a rotation save), so the
        // next call reuses this token until the row is rewritten by a reconnect.
        this.accessCache.set(tenantId, {
          token: data.access_token,
          expiresAt: Date.now() + ttlMs,
          credKey: credentialKey(cred),
        });
        return data.access_token;
      } catch (e) {
        this.logger.warn(`cafe24 token refresh error tenant ${tenantId}: ${(e as Error).message}`);
        return null;
      } finally {
        this.refreshInFlight.delete(tenantId);
      }
    })();
    this.refreshInFlight.set(tenantId, run);
    return run;
  }
}

/** Fingerprint of the stored secret — changes whenever the credential row is rewritten. */
function credentialKey(cred: IntegrationCredential): string {
  return createHash('sha256').update(cred.secretEnc ?? Buffer.alloc(0)).digest('hex');
}
