import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { INTEGRATION_PROVIDER } from '@sharptalk/types';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { IntegrationTestResponse } from '../tenant/dto/response/tenant.response';
import { Cafe24TokenService } from './cafe24-token.service';
import { Cafe24AdminClient } from './cafe24-admin.client';

const CAFE24 = INTEGRATION_PROVIDER.CAFE24;
/** The store resource is one small call; longer than this means Cafe24 is not answering. */
const PROBE_TIMEOUT_MS = 6_000;

/**
 * Connection test for an OAuth-connected Cafe24 mall (PLN-261019-Cafe24 D2).
 *
 * The generic probe in TenantModule reads a manually entered access token, which
 * an OAuth credential never holds — so it reported every OAuth mall as broken.
 * This test goes the way the syncs do: mint an access token from the stored
 * refresh token (rotating it, single-flight), read `/admin/store`, and record
 * the outcome on THIS tenant's credential row — the per-tenant state the cards
 * and dashboard show (FIX-260827). It lives in the Cafe24 module because
 * Cafe24Module already imports TenantModule; the reverse would be a cycle.
 */
@Injectable()
export class Cafe24ConnectionTestService {
  private readonly logger = new Logger(Cafe24ConnectionTestService.name);

  constructor(
    @InjectRepository(IntegrationCredential)
    private readonly credRepo: Repository<IntegrationCredential>,
    private readonly tokenService: Cafe24TokenService,
    private readonly client: Cafe24AdminClient,
  ) {}

  async testConnection(tenantId: number): Promise<IntegrationTestResponse> {
    const cred = await this.credRepo.findOne({ where: { tenantId, provider: CAFE24 } });
    if (!cred?.secretEnc) {
      // Nothing to test and nothing to mark: the card does not exist yet.
      return { ok: false, detail: 'Cafe24 store is not connected — connect the mall first' };
    }

    const result = await this.probe(tenantId);
    cred.status = result.ok ? 'connected' : 'error';
    cred.detail = result.detail.slice(0, 255);
    cred.lastTestedAt = new Date();
    await this.credRepo.save(cred);
    return result;
  }

  private async probe(tenantId: number): Promise<IntegrationTestResponse> {
    let conn: { mallId: string; accessToken: string } | null;
    try {
      conn = await this.tokenService.getConnection(tenantId);
    } catch (e) {
      // appConfig() throws when the app keys are absent — a deployment gap, not
      // the mall's fault, but still "cannot reach Cafe24 from here".
      return { ok: false, detail: `Cafe24 app is not configured on this server: ${(e as Error).message}` };
    }
    if (!conn) {
      return {
        ok: false,
        detail: 'Cafe24 token refresh failed — the refresh token expired or was revoked; reconnect the mall',
      };
    }
    try {
      const store = await withTimeout(this.client.getStore(conn.mallId, conn.accessToken), PROBE_TIMEOUT_MS);
      const name = store?.shop_name?.trim();
      return { ok: true, detail: name ? `Connected: ${name} (${conn.mallId})` : `Connected: ${conn.mallId}` };
    } catch (e) {
      const msg = (e as Error).message || 'unknown error';
      this.logger.warn(`cafe24 connection test tenant ${tenantId} (${conn.mallId}): ${msg}`);
      return { ok: false, detail: `Cafe24 store request failed (${conn.mallId}): ${msg}` };
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}
