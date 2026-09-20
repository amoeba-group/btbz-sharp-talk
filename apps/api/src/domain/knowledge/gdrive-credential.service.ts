import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { INTEGRATION_PROVIDER } from '@sharptalk/types';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IntegrationCredential } from '../tenant/entity/integration-credential.entity';
import { decryptSecret, encryptSecret } from '../../global/util/crypto.util';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { AuditService } from '../audit/audit.service';
import { GdriveClient } from './gdrive.client';
import { maskPii } from '../../global/util/pii.util';
import {
  GoogleServiceAccount,
  InvalidServiceAccountError,
  deserializeServiceAccount,
  parseServiceAccount,
  serializeServiceAccount,
} from './gdrive-credential.util';

export const GDRIVE_PROVIDER = INTEGRATION_PROVIDER.GOOGLE_DRIVE;
const PROVIDER = GDRIVE_PROVIDER;

/**
 * Stores and reads the Drive service-account key (PLN-260815 G1).
 *
 * The key is written once by an operator and read on every sync, so the two
 * paths live together: whatever `save` accepts, `load` must be able to use.
 */
@Injectable()
export class GdriveCredentialService {
  private readonly logger = new Logger(GdriveCredentialService.name);

  constructor(
    @InjectRepository(IntegrationCredential)
    private readonly credRepo: Repository<IntegrationCredential>,
    private readonly client: GdriveClient,
    private readonly audit: AuditService,
  ) {}

  /** Accepts the JSON Google hands out; keeps only what signing needs. */
  async save(tenantId: number, rawJson: string, actorUserId?: number): Promise<{ clientEmail: string }> {
    let sa: GoogleServiceAccount;
    try {
      sa = parseServiceAccount(rawJson);
    } catch (e) {
      if (e instanceof InvalidServiceAccountError) {
        // The reason reaches the operator: "invalid" alone means pasting the
        // same wrong file again.
        this.logger.warn(`google_drive credential rejected for tenant ${tenantId}: ${e.message}`);
        throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST, {
          key_json: [e.message],
        });
      }
      throw e;
    }

    const existing = await this.credRepo.findOne({ where: { tenantId, provider: PROVIDER } });
    const row = existing ?? this.credRepo.create({ tenantId, provider: PROVIDER });
    row.secretEnc = encryptSecret(serializeServiceAccount(sa));
    row.status = 'connected';
    await this.credRepo.save(row);
    // The address is not secret and is exactly what the operator must share the
    // folder with, so it is the one field worth echoing back.
    this.logger.log(`google_drive credential stored for tenant ${tenantId} (${sa.clientEmail})`);
    // Same privileged action as the Notion token; the key itself is not logged.
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId: actorUserId ?? 0,
      action: 'knowledge.gdrive_credential.save',
      target: `tenant:${tenantId}`,
      // Masked like every other audit row: the entity's contract is that
      // metadata never holds a raw address, and "this one is not secret" is
      // the argument that erodes the rule (FIX-260920).
      metadata: { provider: PROVIDER, clientEmail: maskPii(sa.clientEmail), replaced: !!existing },
    });
    return { clientEmail: sa.clientEmail };
  }

  async load(tenantId: number): Promise<GoogleServiceAccount | null> {
    const row = await this.credRepo.findOne({ where: { tenantId, provider: PROVIDER } });
    if (!row?.secretEnc) return null;
    try {
      return deserializeServiceAccount(decryptSecret(row.secretEnc));
    } catch (e) {
      this.logger.warn(`google_drive credential unreadable for tenant ${tenantId}: ${(e as Error).message}`);
      return null;
    }
  }

  /** What the console shows: connected or not, and the address to share with. */
  async status(tenantId: number): Promise<{ connected: boolean; clientEmail: string | null }> {
    const sa = await this.load(tenantId);
    return { connected: !!sa, clientEmail: sa?.clientEmail ?? null };
  }

  async remove(tenantId: number, actorUserId?: number): Promise<void> {
    await this.credRepo.delete({ tenantId, provider: PROVIDER });
    this.logger.log(`google_drive credential removed for tenant ${tenantId}`);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId: actorUserId ?? 0,
      action: 'knowledge.gdrive_credential.remove',
      target: `tenant:${tenantId}`,
      metadata: { provider: PROVIDER },
    });
  }

  /**
   * Check the key, and the folder when one is given.
   *
   * Worth its own action because the two ways this fails — a key Google rejects
   * and a folder nobody shared — are invisible until a sync runs, and they look
   * identical in the result ("0 files").
   */
  async test(tenantId: number, folderId?: string): Promise<{ ok: boolean; message: string; files?: number }> {
    const sa = await this.load(tenantId);
    if (!sa) return { ok: false, message: 'No service account key is registered.' };
    let token: string;
    try {
      token = await this.client.getAccessToken(sa);
    } catch (e) {
      return { ok: false, message: `Google rejected the key: ${(e as Error).message}` };
    }
    if (!folderId) return { ok: true, message: `Key accepted for ${sa.clientEmail}.` };
    try {
      const files = await this.client.listFolder(token, folderId);
      const usable = files.filter((f) => GdriveClient.isSupported(f.mimeType)).length;
      if (files.length === 0) {
        return {
          ok: false,
          // Google answers "no files" for a folder that was never shared, so the
          // likeliest cause goes in the message rather than a bare zero.
          message: `No files visible. Share the folder with ${sa.clientEmail} as a viewer, and check the folder ID.`,
          files: 0,
        };
      }
      return { ok: true, message: `${usable} of ${files.length} file(s) can be imported.`, files: usable };
    } catch (e) {
      return { ok: false, message: `Could not read the folder: ${(e as Error).message}` };
    }
  }
}
