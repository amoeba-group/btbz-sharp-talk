import { IntegrationProvider } from '@sharptalk/types';
import { KnowledgeSource } from './entity/knowledge-source.entity';

/**
 * One piece of source content, normalised for the ingestion pipeline.
 *
 * Adapters produce these and nothing else — upserting, embedding, history and
 * hiding removed items all live in the pipeline, so a new source type is one
 * `fetchAll` away rather than a reimplementation of the whole flow.
 */
export interface SourceItem {
  /**
   * Stable identity within the source. The pipeline upserts on it, so it must
   * survive a title change — a board post's id, not its heading.
   */
  externalKey: string;
  title: string;
  content: string;
  sourceUrl: string | null;
  category: string | null;
}

/**
 * What an adapter returns when a plain list is not the whole story.
 *
 * Added for Notion (PLN-260821), whose per-sync page cap can leave work
 * undone: a truncated run that reports the same shape as a complete one is
 * indistinguishable from success, which is how silent data loss starts.
 * Adapters with nothing extra to say keep returning an array.
 */
export interface SourceFetch {
  items: SourceItem[];
  /** Items the source held that this run deliberately did not convert. */
  dropped?: number;
  /**
   * Items converted, but not in full — a page cut at the character cap or at
   * the per-page request budget. They are in the corpus; part of them is not.
   */
  truncated?: number;
}

export interface SourceAdapter {
  readonly type: string;

  /**
   * A credential that must already exist before a source of this type can be
   * created, as `{ provider }` in `integration_credentials` plus the name to
   * put in front of the operator.
   *
   * Declared by the adapter rather than branched on by the service: the check
   * is the same for every credentialled source, and the first version of it was
   * a hardcoded `type === 'gdrive'` that a second such source would have had to
   * copy (REQ-260821 G5).
   */
  readonly credential?: { provider: IntegrationProvider; label: string };

  /**
   * Whether an empty listing proves the source is empty.
   *
   * True for a source we query directly (an empty board really has no posts).
   * False for anything behind someone else's API, where "no items" is also what
   * revoked access looks like — treating that as authoritative would hide every
   * document from the source the first time a permission lapses. Defaults to
   * true so an internal adapter need not think about it.
   */
  readonly trustEmptyListing?: boolean;

  /**
   * Check a source's configuration before it is saved. Returns a human-readable
   * reason when invalid, or null when it is usable.
   *
   * Validating up front matters because the alternative — accepting anything
   * and discovering it at sync time — is how the three source types ended up
   * registrable but non-functional in the first place.
   */
  validateConfig(config: Record<string, unknown> | null): string | null;

  /**
   * Every item the source currently holds. Deliberately a full listing rather
   * than a delta: the pipeline already compares against what it stored last
   * time, and "what exists now" is the only question an adapter can answer
   * without keeping its own bookkeeping.
   */
  fetchAll(tenantId: number, source: KnowledgeSource): Promise<SourceItem[] | SourceFetch>;
}

/**
 * Failures an adapter raises that the operator can act on, as classes rather
 * than message text so the service can map them to an error code without
 * matching wording (PLN-261019). Everything else an adapter throws is treated
 * as the provider's fault (its own error classes) or ours (a plain Error).
 */

/** The configured target cannot be used: missing, malformed, trashed, not shared. */
export class SourceTargetError extends Error {}

/** No credential is registered for this source type, or it cannot be used. */
export class SourceCredentialError extends Error {}
