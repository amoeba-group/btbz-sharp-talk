import { AUDIENCE, AUDIENCE_RANK } from '@sharptalk/types';
import type { Audience } from '@sharptalk/types';

/**
 * Server side of the KB access tiers (PLN-261012 SG-10). The tiers themselves
 * (`Audience`, `audienceOf`, `kbAccessOf`) live in `@sharptalk/types`; this file
 * holds what only the API needs: the MySQL spelling of the "manager-only"
 * exclusion and the "does this tenant use tiers at all" test.
 *
 * Standalone on purpose (no service imports): rag, answer-reuse, knowledge and
 * agent all import it, and a constant exported from a service file has already
 * crashed boot through a circular import in this repo.
 */

/** Does a caller of this audience have to be kept out of manager-only categories? */
export function audienceNeedsManagerExclusion(audience: Audience | null | undefined): boolean {
  return !!audience && AUDIENCE_RANK[audience] < AUDIENCE_RANK[AUDIENCE.MANAGER];
}

/**
 * The predicate that keeps manager-only documents out of an answer, for
 * `RagService.baseQuery` (alias `kb` = kb_documents).
 *
 * Phrased as "NOT in the manager-only set", the polarity of the per-agent scope,
 * so a tenant that never configured a tier matches an empty set. It deliberately
 * has NO `origin <> 'catalog'` clause (unlike the agent scope): a category that
 * flips origin must not silently shed a restriction — a security restriction
 * fails closed.
 */
export const MANAGER_ONLY_EXCLUSION_SQL = `(kb.category IS NULL OR NOT EXISTS
           (SELECT 1 FROM kb_categories a
             WHERE a.tenant_id = :audienceTenantId
               AND a.doc_group = kb.doc_group
               AND a.name = kb.category
               AND a.min_audience = '${AUDIENCE.MANAGER}'))`;

/** Minimal shape of the category repository the tier test needs (a `Repository<KbCategory>` satisfies it). */
export interface ManagerTierCounter {
  count(options: { where: { tenantId: number; minAudience: string } }): Promise<number>;
}

/**
 * Does the tenant have at least one manager-only category? Deliberately uncached:
 * a minute of staleness is a minute of answering a manager-only topic to a
 * receptionist after an operator has just said not to, and the read is one indexed
 * count on a table that peaks in the dozens.
 */
export async function tenantHasManagerTier(repo: ManagerTierCounter, tenantId: number): Promise<boolean> {
  return (await repo.count({ where: { tenantId, minAudience: AUDIENCE.MANAGER } })) > 0;
}
