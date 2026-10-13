import { AUDIENCE, AUDIENCE_RANK, SESSION_IDENTITY, audienceOf } from '@sharptalk/types';
import type { Audience } from '@sharptalk/types';

/**
 * The tier a conversation was held at, from the signed role it was stamped with when it
 * opened (`conversations.actor_role`, PLN-261012 SG-50 stamps; SG-11).
 *
 * The stamp exists only when the claims were signed and in force at that moment, so a
 * non-empty role is a signed role. No stamp (a guest, a v1 identity, a thread from before
 * the stamps) reads as `public`: nothing is known to have been shown at a higher tier, and
 * the guard below must never trigger on a guess.
 */
export function conversationAudience(actorRole: string | null | undefined): Audience {
  if (!actorRole) return AUDIENCE.PUBLIC;
  return audienceOf({ level: SESSION_IDENTITY.VERIFIED, claims: { signed: true, role: actorRole } });
}

/**
 * Were the earlier turns of this conversation produced at a HIGHER tier than the viewer's
 * tier now? (PLN-261012 SG-11.) When true they must not reach the model: it would happily
 * repeat a manager-only answer from the transcript to a viewer whose retrieval just excluded
 * it. Happens when signed claims lapse mid-conversation (the session reads as a guest again)
 * or when a thread outlives the role that opened it.
 *
 * A re-identify under another role never gets here — it forks a new SESSION (SG-02), so a new
 * conversation; this is the guard for the paths that keep the old one.
 */
export function historyExceedsViewer(actorRole: string | null | undefined, viewer: Audience): boolean {
  return AUDIENCE_RANK[conversationAudience(actorRole)] > AUDIENCE_RANK[viewer];
}
