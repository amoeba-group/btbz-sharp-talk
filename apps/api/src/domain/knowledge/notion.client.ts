import { Injectable, Logger } from '@nestjs/common';
import { MAX_BLOCK_DEPTH, NotionBlock } from './notion-block-text.util';
import { dashedNotionId } from './notion.util';

/**
 * Minimal Notion read client (PLN-260821 W1, REQ G1).
 *
 * No SDK, for the same reason the Drive client has none: this is a handful of
 * GETs with a bearer token, and the dependency would be larger than the code.
 *
 * Read-only by construction — nothing here issues a write; an internal
 * integration's own capabilities in Notion are the second line of defence.
 */
const NOTION_API = 'https://api.notion.com/v1';

/**
 * Pinned deliberately (C1). Notion rejects a request with no version header,
 * and an unpinned one would let a future version change the block payloads
 * under a connector nobody is watching.
 */
export const NOTION_VERSION = '2022-06-28';

/**
 * Notion's published budget is an average of ~3 requests per second. A page is
 * one request per 100 blocks plus one per nested block, so a sync of any size
 * will hit that ceiling; pacing here beats discovering it as 429s mid-run.
 */
const MIN_INTERVAL_MS = 350;

/** How many rows to list before giving up on an exact count (see listing cap). */
export const LIST_CEILING = 1000;

/**
 * Positive-integer env override, else the shipped default (REQ-260828 C4).
 * Read at module load — a cap change is a deploy-time decision, not a
 * per-request one. Kit lesson D-1: operational constants must be
 * env-overridable or the only fix for a mis-sized cap is a release.
 */
export function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isInteger(raw) && raw > 0 ? raw : fallback;
}

/**
 * Requests one page's blocks may cost.
 *
 * Depth alone does not bound this: every block with children costs a request,
 * so a page of 500 toggles is 500 requests — three minutes at the pace below,
 * for one document. The character cap cannot help, because it applies after
 * everything has been fetched. Stopping early and saying so beats a sync that
 * runs for hours.
 */
export const MAX_REQUESTS_PER_PAGE = envInt('NOTION_MAX_REQUESTS_PER_PAGE', 30);

/** A request that never settles would hold a sync open indefinitely. */
const REQUEST_TIMEOUT_MS = 30_000;

/** Notion may ask for a long wait; past this it is better to fail the run. */
const MAX_RETRY_AFTER_MS = 30_000;

export interface NotionPageRef {
  id: string;
  title: string;
  url: string | null;
}

export interface NotionListing {
  pages: NotionPageRef[];
  /** True when the ceiling stopped the listing, so `pages` is a floor. */
  hasMore: boolean;
}

/** The token itself was refused — wrong, revoked, or from another workspace. */
export class NotionAuthError extends Error {}

/** Anything else Notion refused; `code` carries Notion's own error code. */
export class NotionRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Notion's answer for "no such object" and "you cannot see this object". */
export const NOT_FOUND_CODE = 'object_not_found';

const titleOf = (object: Record<string, unknown>): string => {
  // A database carries its title at the top level; a page carries it in
  // whichever property is of type `title` (usually but not always "Name").
  const direct = object.title;
  if (Array.isArray(direct)) return plain(direct);
  const properties = (object.properties ?? {}) as Record<string, unknown>;
  for (const value of Object.values(properties)) {
    const prop = value as { type?: string; title?: unknown };
    if (prop?.type === 'title' && Array.isArray(prop.title)) return plain(prop.title);
  }
  return '';
};

const plain = (runs: unknown[]): string =>
  runs
    .map((run) => {
      const p = (run as { plain_text?: unknown })?.plain_text;
      return typeof p === 'string' ? p : '';
    })
    .join('');

const toRef = (object: Record<string, unknown>): NotionPageRef => ({
  id: String(object.id ?? ''),
  title: titleOf(object) || 'Untitled',
  url: typeof object.url === 'string' ? object.url : null,
});

@Injectable()
export class NotionClient {
  private readonly logger = new Logger(NotionClient.name);
  /** Serialises requests so the throttle holds across concurrent callers. */
  private gate: Promise<void> = Promise.resolve();
  private nextAllowedAt = 0;

  /** Overridable in tests so pacing can be asserted without real waiting. */
  protected now(): number {
    return Date.now();
  }

  protected async wait(ms: number): Promise<void> {
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * A playable URL for one video (or file) block (PLN-261006-KB-Video-Links).
   * Notion-hosted files come back as signed URLs with an expiry — the caller
   * caches until shortly before it. External videos never expire.
   */
  async videoUrl(token: string, blockId: string): Promise<{ url: string; expiresAt: Date | null } | null> {
    const block = await this.request<Record<string, unknown>>(token, `/blocks/${blockId}`);
    const type = typeof block.type === 'string' ? block.type : '';
    if (type !== 'video' && type !== 'file') return null;
    const body = block[type] as
      | { type?: string; external?: { url?: string }; file?: { url?: string; expiry_time?: string } }
      | undefined;
    if (body?.type === 'external' && body.external?.url) return { url: body.external.url, expiresAt: null };
    if (body?.type === 'file' && body.file?.url) {
      const exp = body.file.expiry_time ? new Date(body.file.expiry_time) : null;
      return { url: body.file.url, expiresAt: exp && !Number.isNaN(exp.getTime()) ? exp : null };
    }
    return null;
  }

  /** Token check. Cheap, and the only call that works with nothing shared. */
  async me(token: string): Promise<{ name: string }> {
    const bot = await this.request<Record<string, unknown>>(token, '/users/me');
    const owner = (bot.bot ?? {}) as { workspace_name?: unknown };
    const name =
      (typeof owner.workspace_name === 'string' && owner.workspace_name) ||
      (typeof bot.name === 'string' && bot.name) ||
      'the workspace';
    return { name };
  }

  /**
   * Work out whether an id names a database or a page.
   *
   * Notion has no "what is this" endpoint, so we ask the database endpoint
   * first and fall through on a 404. Operators paste both kinds and cannot
   * reasonably be asked to know which one they have.
   */
  async retrieveTarget(
    token: string,
    id32: string,
  ): Promise<{ kind: 'database' | 'page'; ref: NotionPageRef; archived: boolean }> {
    const id = dashedNotionId(id32);
    try {
      const db = await this.request<Record<string, unknown>>(token, `/databases/${id}`);
      return { kind: 'database', ref: toRef(db), archived: db.archived === true };
    } catch (e) {
      if (!(e instanceof NotionRequestError)) throw e;
      // 404 covers the unshared/nonexistent case. A page that IS shared
      // answers the database probe with 400 validation_error
      // "…is a page, not a database…" instead — real-workspace behavior the
      // mocked tests never exercised; without this the fallback never ran for
      // any shared page (FIX-260828, found on go2joy's first live sync).
      const notADatabase = e.status === 400 && /is a page, not a database/i.test(e.message);
      if (e.status !== 404 && !notADatabase) throw e;
    }
    const page = await this.request<Record<string, unknown>>(token, `/pages/${id}`);
    return { kind: 'page', ref: toRef(page), archived: page.archived === true };
  }

  /** Every row of a database, one document each. Archived rows are excluded (C3). */
  async listDatabasePages(token: string, id32: string, ceiling = LIST_CEILING): Promise<NotionListing> {
    const id = dashedNotionId(id32);
    const pages: NotionPageRef[] = [];
    let cursor: string | undefined;
    do {
      const body: Record<string, unknown> = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const json = await this.request<{
        results?: Record<string, unknown>[];
        next_cursor?: string | null;
        has_more?: boolean;
      }>(token, `/databases/${id}/query`, { method: 'POST', body });
      for (const row of json.results ?? []) {
        if (row.archived === true) continue;
        pages.push(toRef(row));
      }
      cursor = json.has_more ? (json.next_cursor ?? undefined) : undefined;
      if (pages.length >= ceiling) return { pages, hasMore: !!cursor };
    } while (cursor);
    return { pages, hasMore: false };
  }

  /**
   * Direct child pages of a page — one level, matching the Drive adapter's
   * "files in this folder" rather than a whole subtree.
   */
  async listChildPages(token: string, id32: string, ceiling = LIST_CEILING): Promise<NotionListing> {
    const pages: NotionPageRef[] = [];
    let cursor: string | undefined;
    do {
      const json = await this.childrenPage(token, dashedNotionId(id32), cursor);
      for (const block of json.results ?? []) {
        if (block.type !== 'child_page' || block.archived === true) continue;
        const child = (block.child_page ?? {}) as { title?: unknown };
        const childId = String(block.id ?? '').replace(/-/g, '');
        pages.push({
          id: childId,
          title: (typeof child.title === 'string' && child.title) || 'Untitled',
          url: `https://www.notion.so/${childId}`,
        });
      }
      cursor = json.has_more ? (json.next_cursor ?? undefined) : undefined;
      if (pages.length >= ceiling) return { pages, hasMore: !!cursor };
    } while (cursor);
    return { pages, hasMore: false };
  }

  /**
   * A page's blocks, with nested children resolved up to `maxDepth`.
   *
   * `truncated` says the request budget ran out before the page did, so the
   * caller can report an incomplete document rather than pass a partial one
   * off as whole.
   */
  async pageBlocks(
    token: string,
    id32: string,
    maxDepth = MAX_BLOCK_DEPTH,
  ): Promise<{ blocks: NotionBlock[]; truncated: boolean }> {
    // Spending the last request is not the same as running out: a page that
    // finished on its final allowance is complete, and flagging it would put a
    // false warning on a whole document.
    const budget = { left: MAX_REQUESTS_PER_PAGE, hitLimit: false };
    const blocks = await this.blocksOf(token, dashedNotionId(id32), 1, maxDepth, budget);
    if (budget.hitLimit) {
      this.logger.warn(`notion page ${id32} exceeded ${MAX_REQUESTS_PER_PAGE} requests; stopped early`);
    }
    return { blocks, truncated: budget.hitLimit };
  }

  private async blocksOf(
    token: string,
    id: string,
    depth: number,
    maxDepth: number,
    budget: { left: number; hitLimit: boolean },
  ): Promise<NotionBlock[]> {
    const blocks: NotionBlock[] = [];
    let cursor: string | undefined;
    do {
      if (budget.left <= 0) {
        // Another cursor page was waiting and we cannot pay for it.
        budget.hitLimit = true;
        return blocks;
      }
      budget.left -= 1;
      const json = await this.childrenPage(token, id, cursor);
      for (const raw of json.results ?? []) {
        const block = raw as NotionBlock;
        if (block.has_children && depth < maxDepth) {
          if (budget.left > 0) {
            block.children = await this.blocksOf(
              token,
              String(block.id ?? ''),
              depth + 1,
              maxDepth,
              budget,
            );
          } else {
            // Children we were meant to expand and did not.
            budget.hitLimit = true;
          }
        }
        blocks.push(block);
      }
      cursor = json.has_more ? (json.next_cursor ?? undefined) : undefined;
    } while (cursor);
    return blocks;
  }

  private childrenPage(
    token: string,
    id: string,
    cursor?: string,
  ): Promise<{
    results?: Record<string, unknown>[];
    next_cursor?: string | null;
    has_more?: boolean;
  }> {
    const params = new URLSearchParams({ page_size: '100' });
    if (cursor) params.set('start_cursor', cursor);
    return this.request(token, `/blocks/${id}/children?${params.toString()}`);
  }

  /**
   * One paced request, with a single retry when Notion asks us to slow down.
   *
   * Retrying once and no more is the point: a 429 that survives its own
   * `Retry-After` is a signal to stop, not to keep pushing a shared budget the
   * tenant's other integrations are also spending.
   */
  private async request<T>(
    token: string,
    path: string,
    init: { method?: string; body?: unknown } = {},
    retried = false,
  ): Promise<T> {
    await this.pace();
    const res = await fetch(`${NOTION_API}${path}`, {
      method: init.method ?? 'GET',
      // A request that never settles would hold the whole sync open.
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });

    if (res.status === 429 && !retried) {
      // Honour the header, but not without limit: a long Retry-After would
      // park the sync for hours, which is worse than failing it now.
      const asked = (Number(res.headers?.get?.('Retry-After') ?? '') || 1) * 1000;
      const after = Math.min(asked, MAX_RETRY_AFTER_MS);
      this.logger.warn(`notion rate limited on ${path}; retrying in ${after}ms`);
      await this.wait(after);
      return this.request<T>(token, path, init, true);
    }
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      let code = '';
      let message = raw.slice(0, 200);
      try {
        const parsed = JSON.parse(raw) as { code?: string; message?: string };
        code = parsed.code ?? '';
        // Notion's own wording is more specific than anything we would invent.
        if (parsed.message) message = parsed.message.slice(0, 200);
      } catch {
        /* not JSON — keep the raw prefix */
      }
      if (res.status === 401) throw new NotionAuthError(message || 'the token was rejected');
      throw new NotionRequestError(message || `request failed (${res.status})`, res.status, code);
    }
    return (await res.json()) as T;
  }

  /** Hold each request at least MIN_INTERVAL_MS after the previous one. */
  private pace(): Promise<void> {
    const turn = this.gate.then(async () => {
      const now = this.now();
      const delay = Math.max(0, this.nextAllowedAt - now);
      if (delay > 0) await this.wait(delay);
      this.nextAllowedAt = Math.max(now, this.nextAllowedAt) + MIN_INTERVAL_MS;
    });
    // Failures must not wedge the queue for every later request.
    this.gate = turn.catch(() => undefined);
    return turn;
  }
}
