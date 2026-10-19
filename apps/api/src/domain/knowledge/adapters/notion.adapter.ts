import { Injectable, Logger } from '@nestjs/common';
import { KnowledgeSource } from '../entity/knowledge-source.entity';
import {
  SourceAdapter,
  SourceCredentialError,
  SourceFetch,
  SourceItem,
  SourceTargetError,
} from '../source-adapter.interface';
import { envInt, NotionClient, NotionPageRef } from '../notion.client';
import { NotionCredentialService, NOTION_PROVIDER } from '../notion-credential.service';
import { blocksToText } from '../notion-block-text.util';
import { extractNotionId } from '../notion.util';

/**
 * Notion database or page → knowledge (PLN-260821 W1, REQ G4).
 *
 * Flat by design, like the Drive adapter: a database contributes one document
 * per row, a page contributes itself plus its direct children. Recursing the
 * whole subtree would cost a request per block against a ~3 req/s budget and
 * quietly turn one source into hundreds of documents.
 */

/**
 * Pages converted in a single sync.
 *
 * Each page is at least one more API call, so the cap is what keeps a sync
 * bounded in time rather than in the operator's patience. Whatever it cuts is
 * counted and reported — a truncated sync that looks complete is the failure
 * mode worth engineering against.
 */
export const MAX_PAGES_PER_SYNC = envInt('NOTION_MAX_PAGES_PER_SYNC', 200);

const truncate = (value: string, max: number): string =>
  value.length > max ? value.slice(0, max) : value;

/** Notion accepts both id forms; documents and keys use the bare one. */
const bare = (id: string): string => id.replace(/-/g, '');

@Injectable()
export class NotionAdapter implements SourceAdapter {
  readonly type = 'notion';

  /**
   * An empty listing is not proof the source is empty.
   *
   * Disconnecting an integration from a page makes Notion answer exactly as it
   * does for a page with nothing in it. Trusting that would hide every document
   * from this source the first time someone tidies up Connections.
   */
  readonly trustEmptyListing = false;

  /** Checked before a source of this type may be created (G5). */
  readonly credential = { provider: NOTION_PROVIDER, label: 'Notion integration token' };

  private readonly logger = new Logger(NotionAdapter.name);

  constructor(
    private readonly client: NotionClient,
    private readonly credentials: NotionCredentialService,
  ) {}

  validateConfig(config: Record<string, unknown> | null): string | null {
    const raw = typeof config?.targetId === 'string' ? config.targetId.trim() : '';
    if (!raw) return 'A Notion database or page ID is required.';
    if (!extractNotionId(raw)) {
      // Operators paste the share link far more often than the bare id, and the
      // link is accepted — so the message is about what could not be found in
      // it, not about which form to use.
      return 'No Notion ID found in that. Paste the page or database link, or its 32-character ID.';
    }
    return null;
  }

  async fetchAll(tenantId: number, source: KnowledgeSource): Promise<SourceFetch> {
    const configured = String((source.configJson as Record<string, unknown>)?.targetId ?? '').trim();
    const targetId = extractNotionId(configured);
    if (!targetId) throw new SourceTargetError('source has no usable Notion target id');

    const token = await this.credentials.load(tenantId);
    if (!token) throw new SourceCredentialError('no Notion integration token is registered');

    const target = await this.client.retrieveTarget(token, targetId);
    if (target.archived) throw new SourceTargetError(`the Notion target "${target.ref.title}" is in the trash`);

    const listing =
      target.kind === 'database'
        ? await this.client.listDatabasePages(token, targetId)
        : await this.client.listChildPages(token, targetId);
    // A page target is a document in its own right, ahead of its children.
    const refs = target.kind === 'database' ? listing.pages : [target.ref, ...listing.pages];

    let dropped = Math.max(0, refs.length - MAX_PAGES_PER_SYNC);
    const selected = refs.slice(0, MAX_PAGES_PER_SYNC);
    if (dropped || listing.hasMore) {
      this.logger.warn(
        `source ${source.id}: ${refs.length}${listing.hasMore ? '+' : ''} page(s) found, ` +
          `converting ${selected.length} (cap ${MAX_PAGES_PER_SYNC})`,
      );
      // The listing stopped early, so the drop count is a floor, not a total.
      if (listing.hasMore) dropped = Math.max(dropped, 1);
    }

    const items: SourceItem[] = [];
    const skippedTypes: Record<string, number> = {};
    let empty = 0;
    let truncatedPages = 0;

    for (const ref of selected) {
      const page = await this.client.pageBlocks(token, bare(ref.id));
      const flat = blocksToText(page.blocks);
      for (const [type, count] of Object.entries(flat.skipped)) {
        skippedTypes[type] = (skippedTypes[type] ?? 0) + count;
      }
      if (!flat.text.trim()) {
        // An empty page carries nothing to retrieve on, and embedding it would
        // spend a call to make the index worse.
        empty += 1;
        continue;
      }
      // Counted only once the page becomes a document: `truncated` means "this
      // many stored documents hold part of their source", not "this many pages
      // stopped early".
      if (flat.truncated || page.truncated) truncatedPages += 1;
      items.push({
        // Keyed by page id: retitling a page must update its document rather
        // than orphan the old one and create a second alongside it.
        externalKey: `page:${bare(ref.id)}`,
        title: truncate(ref.title || 'Untitled', 255),
        content: flat.text,
        sourceUrl: truncate(ref.url ?? `https://www.notion.so/${bare(ref.id)}`, 512),
        category: truncate(source.name, 64),
      });
    }

    const skippedSummary = Object.entries(skippedTypes)
      .map(([type, count]) => `${type}×${count}`)
      .join(', ');
    if (empty || skippedSummary || truncatedPages) {
      this.logger.log(
        `source ${source.id}: ${items.length} page(s) converted` +
          (empty ? `, ${empty} empty` : '') +
          (truncatedPages ? `, ${truncatedPages} stored incomplete` : '') +
          (skippedSummary ? `, unconverted blocks: ${skippedSummary}` : ''),
      );
    }

    // `dropped` counts only what the cap left out. Empty pages are not
    // withheld work — there was nothing in them to withhold — so folding them
    // in here would make a healthy sync look truncated.
    return { items, dropped, truncated: truncatedPages };
  }
}
