import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KbDocument } from './entity/kb-document.entity';
import { NotionClient } from './notion.client';
import { NotionCredentialService } from './notion-credential.service';
import { parseVideoRef } from './video-ref.util';
import { verifyKbVideo } from '../../global/util/crypto.util';
import { RedisService } from '../../infrastructure/cache/redis.service';

/** Notion signs file URLs for about an hour; stop serving one this long before. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;
/** Ceiling when Notion gives no expiry, and for external URLs. */
const MAX_CACHE_SEC = 50 * 60;

export type KbVideoResolution =
  | { ok: true; url: string }
  | { ok: false; reason: 'bad_signature' | 'not_found' | 'no_video' | 'unavailable' };

/**
 * "Watch video" links (PLN-261006-KB-Video-Links P2).
 *
 * The link in an answer points here, not at the video: a Notion-hosted file's
 * URL expires within the hour, and the answer is reread days later. This
 * checks the signature, finds the document's video and returns a URL that
 * plays right now — Notion's freshly signed one, cached until shortly before
 * it expires so a busy video does not spend the tenant's Notion rate limit.
 */
@Injectable()
export class KbVideoService {
  private readonly logger = new Logger(KbVideoService.name);

  constructor(
    @InjectRepository(KbDocument) private readonly docRepo: Repository<KbDocument>,
    private readonly notion: NotionClient,
    private readonly notionCredentials: NotionCredentialService,
    private readonly redis: RedisService,
  ) {}

  async resolve(docId: number, tenantId: number, signature: string): Promise<KbVideoResolution> {
    if (!Number.isFinite(docId) || !Number.isFinite(tenantId) || !verifyKbVideo(tenantId, docId, signature)) {
      this.logger.warn(`kb video refused: bad signature doc=${docId} tenant=${tenantId}`);
      return { ok: false, reason: 'bad_signature' };
    }
    const doc = await this.docRepo.findOne({ where: { id: docId, tenantId, active: 1 } });
    if (!doc) return { ok: false, reason: 'not_found' };
    const ref = parseVideoRef(doc.videoRef);
    if (!ref) return { ok: false, reason: 'no_video' };
    if (ref.kind === 'url') return { ok: true, url: ref.url };

    const cacheKey = `kbvideo:${tenantId}:${ref.blockId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return { ok: true, url: cached };

    const token = await this.notionCredentials.load(tenantId);
    if (!token) {
      this.logger.warn(`kb video unavailable: no notion token (tenant ${tenantId}, doc ${docId})`);
      return { ok: false, reason: 'unavailable' };
    }
    try {
      const found = await this.notion.videoUrl(token, ref.blockId);
      if (!found) {
        this.logger.warn(`kb video unavailable: block ${ref.blockId} is not a video (doc ${docId})`);
        return { ok: false, reason: 'unavailable' };
      }
      const ttlSec = found.expiresAt
        ? Math.floor((found.expiresAt.getTime() - Date.now() - EXPIRY_MARGIN_MS) / 1000)
        : MAX_CACHE_SEC;
      if (ttlSec > 0) await this.redis.set(cacheKey, found.url, Math.min(ttlSec, MAX_CACHE_SEC));
      return { ok: true, url: found.url };
    } catch (e) {
      this.logger.warn(`kb video unavailable: notion ${(e as Error).message} (doc ${docId})`);
      return { ok: false, reason: 'unavailable' };
    }
  }
}
