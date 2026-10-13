import { SESSION_IDENTITY } from './enum.types';

/**
 * Who a knowledge answer is being produced for (PLN-261012 SG-10 / SG-06, REQ D-06).
 *
 * Three tiers, ordered by how much of the tenant's knowledge the viewer may be
 * shown. `public` = anyone, including a visitor who never signed in; `partner` =
 * a signed-in partner user whatever the role; `manager` = the hotel's manager (or
 * an internal account). A KB category carries the lowest tier that may read it
 * (`kb_categories.min_audience`, see `kb-access.ts`); only `manager` is a read
 * restriction today, `public` / `partner` keep the `guest_visible` meaning.
 *
 * Dependency-light on purpose: the API (retrieval, answer reuse, scenario buttons)
 * and the console (category select) both decide with THIS file, and the browser
 * bundles deep-import this source (a value import from the package entry fails the
 * build — see language.ts).
 */
export const AUDIENCE = { PUBLIC: 'public', PARTNER: 'partner', MANAGER: 'manager' } as const;
export type Audience = (typeof AUDIENCE)[keyof typeof AUDIENCE];

/**
 * Orders the tiers. `viewer rank >= required rank` is the one comparison anything
 * that stores or checks an audience makes — e.g. an answer generated for rank 2
 * may be replayed only to rank 2 (`answer_reuse.audience_rank`).
 */
export const AUDIENCE_RANK: Readonly<Record<Audience, number>> = {
  [AUDIENCE.PUBLIC]: 0,
  [AUDIENCE.PARTNER]: 1,
  [AUDIENCE.MANAGER]: 2,
};

/** What `audienceOf` reads: the shape of `effectiveIdentity()` (session/identity.util.ts), nothing more. */
export interface AudienceIdentity {
  level?: string | null;
  claims?: { signed?: boolean | null; role?: string | null } | null;
}

/**
 * The tier a session is entitled to RIGHT NOW. Pass the result of
 * `effectiveIdentity(session)`, never the stored session columns: claims older
 * than the max age already read as a guest there (SG-03), and a lapsed manager
 * must not keep reading manager-only knowledge.
 *
 *  - not verified (guest, lapsed claims, unknown)       -> public
 *  - verified with SIGNED claims, role manager/internal -> manager
 *  - any other verified identity                        -> partner
 *
 * Fail-closed: a verified identity with no claims (a v1 identify, a Shopify or
 * Cafe24 login) or with a role we do not recognise is `partner`, never manager;
 * unsigned claims are display-only (their role is not covered by the signature),
 * so they never raise the tier.
 */
export function audienceOf(identity: AudienceIdentity | null | undefined): Audience {
  if (!identity || identity.level !== SESSION_IDENTITY.VERIFIED) return AUDIENCE.PUBLIC;
  const claims = identity.claims;
  if (claims?.signed === true && (claims.role === 'manager' || claims.role === 'internal')) {
    return AUDIENCE.MANAGER;
  }
  return AUDIENCE.PARTNER;
}
