import { KbVideoService } from './kb-video.service';
import { kbVideoPath, parseVideoRef } from './video-ref.util';
import { signKbVideo, verifyKbVideo } from '../../global/util/crypto.util';

/**
 * "Watch video" links (PLN-261006-KB-Video-Links): a signature names exactly
 * one document of one tenant, Notion files are re-signed on demand and cached
 * just short of their expiry, and every failure is a quiet page, not a leak.
 */
describe('KB video links', () => {
  beforeAll(() => {
    process.env.CRED_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  describe('video_ref parsing and signing', () => {
    it('parses https and notion refs, rejects the rest', () => {
      expect(parseVideoRef('https://youtu.be/x')).toEqual({ kind: 'url', url: 'https://youtu.be/x' });
      expect(parseVideoRef('notion:4648FEE0BB548292BC6381250B79B647')).toEqual({
        kind: 'notion',
        blockId: '4648fee0bb548292bc6381250b79b647',
      });
      expect(parseVideoRef('http://insecure.example/v')).toBeNull();
      expect(parseVideoRef('javascript:alert(1)')).toBeNull();
      expect(parseVideoRef(null)).toBeNull();
    });

    it('a signature is bound to tenant and document', () => {
      const sig = signKbVideo(4, 2633);
      expect(verifyKbVideo(4, 2633, sig)).toBe(true);
      expect(verifyKbVideo(4, 2634, sig)).toBe(false);
      expect(verifyKbVideo(5, 2633, sig)).toBe(false);
      expect(verifyKbVideo(4, 2633, '')).toBe(false);
      expect(kbVideoPath(2633, 4, sig)).toBe(`/api/v1/kb-videos/2633?t=4&sig=${sig}`);
    });
  });

  describe('KbVideoService.resolve', () => {
    function build(opts: { videoRef?: string | null; doc?: boolean; token?: string | null; cached?: string | null; notion?: unknown }) {
      const doc = opts.doc === false ? null : { id: 2633, tenantId: 4, active: 1, videoRef: opts.videoRef ?? null };
      const docRepo = { findOne: jest.fn(async () => doc) };
      const store = new Map<string, { v: string; ttl?: number }>();
      if (opts.cached) store.set('kbvideo:4:4648fee0bb548292bc6381250b79b647', { v: opts.cached });
      const redis = {
        get: jest.fn(async (k: string) => store.get(k)?.v ?? null),
        set: jest.fn(async (k: string, v: string, ttl?: number) => void store.set(k, { v, ttl })),
      };
      const notion = {
        videoUrl: jest.fn(async () => {
          if (opts.notion instanceof Error) throw opts.notion;
          return opts.notion ?? null;
        }),
      };
      const creds = { load: jest.fn(async () => (opts.token === undefined ? 'secret_x' : opts.token)) };
      const svc = new KbVideoService(docRepo as never, notion as never, creds as never, redis as never);
      return { svc, notion, redis, store };
    }
    const sig = () => signKbVideo(4, 2633);
    const NOTION = 'notion:4648fee0bb548292bc6381250b79b647';

    it('refuses a bad signature before touching the database', async () => {
      const h = build({ videoRef: NOTION });
      expect(await h.svc.resolve(2633, 4, 'nope')).toEqual({ ok: false, reason: 'bad_signature' });
      expect(await h.svc.resolve(2633, 5, sig())).toEqual({ ok: false, reason: 'bad_signature' });
    });

    it('a missing or video-less document is not found', async () => {
      expect(await build({ doc: false }).svc.resolve(2633, 4, sig())).toMatchObject({ reason: 'not_found' });
      expect(await build({ videoRef: null }).svc.resolve(2633, 4, sig())).toMatchObject({ reason: 'no_video' });
    });

    it('an https video is passed through without Notion', async () => {
      const h = build({ videoRef: 'https://youtu.be/abc' });
      expect(await h.svc.resolve(2633, 4, sig())).toEqual({ ok: true, url: 'https://youtu.be/abc' });
      expect(h.notion.videoUrl).not.toHaveBeenCalled();
    });

    it('a Notion file is fetched fresh and cached short of its expiry', async () => {
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      const h = build({ videoRef: NOTION, notion: { url: 'https://s3/signed', expiresAt } });
      expect(await h.svc.resolve(2633, 4, sig())).toEqual({ ok: true, url: 'https://s3/signed' });
      const ttl = h.store.get('kbvideo:4:4648fee0bb548292bc6381250b79b647')?.ttl ?? 0;
      expect(ttl).toBeGreaterThan(45 * 60);
      expect(ttl).toBeLessThanOrEqual(50 * 60);
    });

    it('a cached URL answers without calling Notion', async () => {
      const h = build({ videoRef: NOTION, cached: 'https://s3/cached' });
      expect(await h.svc.resolve(2633, 4, sig())).toEqual({ ok: true, url: 'https://s3/cached' });
      expect(h.notion.videoUrl).not.toHaveBeenCalled();
    });

    it('no Notion token, a non-video block or a Notion error is "unavailable"', async () => {
      expect(await build({ videoRef: NOTION, token: null }).svc.resolve(2633, 4, sig())).toMatchObject({ reason: 'unavailable' });
      expect(await build({ videoRef: NOTION, notion: null }).svc.resolve(2633, 4, sig())).toMatchObject({ reason: 'unavailable' });
      expect(await build({ videoRef: NOTION, notion: new Error('boom') }).svc.resolve(2633, 4, sig())).toMatchObject({ reason: 'unavailable' });
    });
  });
});
