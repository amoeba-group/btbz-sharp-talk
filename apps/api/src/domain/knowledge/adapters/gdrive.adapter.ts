import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeSource } from '../entity/knowledge-source.entity';
import {
  SourceAdapter,
  SourceCredentialError,
  SourceItem,
  SourceTargetError,
} from '../source-adapter.interface';
import { GdriveClient } from '../gdrive.client';
import { GDRIVE_PROVIDER, GdriveCredentialService } from '../gdrive-credential.service';

/**
 * Google Drive folder → knowledge (PLN-260815 S2/G3).
 *
 * Only lists and reads: the scope is `drive.readonly`, so nothing here can
 * change a tenant's documents.
 */
@Injectable()
export class GdriveAdapter implements SourceAdapter {
  readonly type = 'gdrive';

  /**
   * An empty listing is not proof the folder is empty.
   *
   * Drive answers "no files" for a folder whose sharing was revoked exactly as
   * it does for one that really is empty. Letting the pipeline treat that as
   * authoritative would hide every document from this source the first time a
   * permission lapses (PLN-260815 §6).
   */
  readonly trustEmptyListing = false;

  /** Checked before a Drive source can be created (REQ-260821 G5). */
  readonly credential = { provider: GDRIVE_PROVIDER, label: 'Google service account key' };

  private readonly logger = new Logger(GdriveAdapter.name);

  constructor(
    private readonly client: GdriveClient,
    private readonly credentials: GdriveCredentialService,
  ) {}

  validateConfig(config: Record<string, unknown> | null): string | null {
    const folderId = typeof config?.folderId === 'string' ? config.folderId.trim() : '';
    if (!folderId) return 'A Drive folder ID is required.';
    // Operators paste the whole URL more often than the id; say which part.
    if (/^https?:\/\//i.test(folderId)) {
      return 'Enter only the folder ID — the last part of the folder URL.';
    }
    if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId)) return 'That does not look like a Drive folder ID.';
    return null;
  }

  async fetchAll(tenantId: number, source: KnowledgeSource): Promise<SourceItem[]> {
    const folderId = String((source.configJson as Record<string, unknown>)?.folderId ?? '').trim();
    if (!folderId) throw new SourceTargetError('source has no folderId configured');

    const sa = await this.credentials.load(tenantId);
    if (!sa) throw new SourceCredentialError('no Google service account key is registered');

    const token = await this.client.getAccessToken(sa);
    const files = await this.client.listFolder(token, folderId);

    const items: SourceItem[] = [];
    let skipped = 0;
    for (const file of files) {
      if (!GdriveClient.isSupported(file.mimeType)) {
        skipped += 1;
        continue;
      }
      const content = await this.client.readFile(token, file);
      // An empty document carries nothing to retrieve on, and embedding it
      // would spend a call to make the index worse.
      if (!content || !content.trim()) {
        skipped += 1;
        continue;
      }
      items.push({
        // Keyed by file id: renaming a doc must update it, not orphan the old
        // document and create a second one alongside.
        externalKey: `file:${file.id}`,
        title: file.name,
        content,
        sourceUrl: `https://drive.google.com/file/d/${file.id}/view`,
        category: source.name,
      });
    }
    if (skipped) {
      this.logger.log(`source ${source.id}: skipped ${skipped} of ${files.length} file(s) as unsupported or empty`);
    }
    return items;
  }
}
