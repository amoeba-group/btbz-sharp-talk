import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { KbDocument } from './entity/kb-document.entity';
import { NOT_FOUND_CODE, NotionClient, NotionRequestError } from './notion.client';
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
  | { ok: false; reason: 'bad_signature' | 'not_found' | 'no_video' | 'broken' | 'unavailable' };

/** One document whose video no longer resolves (FIX-261023). */
export interface KbVideoRefProblem {
  docId: number;
  externalKey: string | null;
  videoRef: string;
  reason: 'broken' | 'unavailable';
  detail: string;
}

/**
 * Notion answers "no such block" both when it was deleted and when the
 * integration cannot see it — and a page moved or duplicated into another
 * workspace gets new block ids, so the stored ref dies for good (FIX-261023).
 * That is a data problem to re-point, not an outage to wait out.
 */
const isGone = (e: unknown): boolean =>
  e instanceof NotionRequestError && (e.code === NOT_FOUND_CODE || e.status === 404);

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
      if (isGone(e)) {
        this.logger.error(
          `kb video ref broken: block ${ref.blockId} not found or not shared (tenant ${tenantId}, doc ${docId}) — re-point video_ref (npm run kb:video-check)`,
        );
        return { ok: false, reason: 'broken' };
      }
      this.logger.warn(`kb video unavailable: notion ${(e as Error).message} (doc ${docId})`);
      return { ok: false, reason: 'unavailable' };
    }
  }

  /**
   * Check every active document's video against its source (FIX-261023) —
   * after a Notion token swap or a re-share the refs can all die at once while
   * nothing else looks wrong. Bypasses the cache on purpose; one Notion call
   * per distinct block, paced by the client.
   */
  async checkRefs(tenantId?: number): Promise<{ checked: number; problems: KbVideoRefProblem[] }> {
    const docs = await this.docRepo.find({
      where: { active: 1, videoRef: Not(IsNull()), ...(tenantId ? { tenantId } : {}) },
      select: ['id', 'tenantId', 'externalKey', 'videoRef'],
      order: { tenantId: 'ASC', id: 'ASC' },
    });
    const problems: KbVideoRefProblem[] = [];
    const verdicts = new Map<string, { reason: KbVideoRefProblem['reason']; detail: string } | null>();
    const tokens = new Map<number, string | null>();
    for (const doc of docs) {
      const ref = parseVideoRef(doc.videoRef);
      if (!ref || ref.kind === 'url') continue; // external links are not ours to probe
      const tenant = doc.tenantId;
      if (tenant == null) continue; // platform rows have no Notion token to probe with
      const key = `${tenant}:${ref.blockId}`;
      if (!verdicts.has(key)) {
        if (!tokens.has(tenant)) tokens.set(tenant, await this.notionCredentials.load(tenant));
        const token = tokens.get(tenant);
        let verdict: { reason: KbVideoRefProblem['reason']; detail: string } | null = null;
        if (!token) verdict = { reason: 'unavailable', detail: 'no Notion token' };
        else {
          try {
            if (!(await this.notion.videoUrl(token, ref.blockId))) verdict = { reason: 'broken', detail: 'block is not a video' };
          } catch (e) {
            verdict = { reason: isGone(e) ? 'broken' : 'unavailable', detail: (e as Error).message.slice(0, 120) };
          }
        }
        verdicts.set(key, verdict);
      }
      const verdict = verdicts.get(key);
      if (verdict) problems.push({ docId: Number(doc.id), externalKey: doc.externalKey, videoRef: doc.videoRef as string, ...verdict });
    }
    return { checked: docs.length, problems };
  }
}
