/**
 * Agent presence (PLN-261012 SG-60, REQ-261012 D-09).
 *
 * `agent_profiles.status = 'online'` is a switch the agent flips, and nothing ever
 * flipped it back, so "online" lasted forever. Presence is therefore the switch AND
 * a recent heartbeat: the console's 10 s alert poll stamps `last_seen`, and routing
 * only trusts an agent whose stamp is within a TTL. No stamp = never seen = absent.
 */

/** Routing counts an agent as present for this long after their last poll. */
export const DEFAULT_PRESENCE_TTL_SEC = 90;

/**
 * The heartbeat write is skipped when the stored stamp is younger than this, so a
 * console polling every 10 s writes about every third poll instead of every one.
 * It must stay well below the TTL.
 */
export const PRESENCE_TOUCH_THROTTLE_SEC = 20;

/** Profile status written by the "On duty" toggle. */
export const PROFILE_STATUS_ONLINE = 'online';

/** `AGENT_PRESENCE_TTL_SEC`: a positive number of seconds, else the default. */
export function presenceTtlSec(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw.trim()) : typeof raw === 'number' ? raw : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_PRESENCE_TTL_SEC;
}

interface PresenceInput {
  status?: string | null;
  lastSeen?: Date | string | null;
}

/**
 * Is this agent available for routing right now? True only for an on-duty profile
 * whose last poll was at most `ttlSec` ago (the boundary itself still counts).
 * A missing profile, a missing stamp or an unreadable date is "not present".
 */
export function isPresent(
  profile: PresenceInput | null | undefined,
  nowMs: number,
  ttlSec: number,
): boolean {
  if (!profile || profile.status !== PROFILE_STATUS_ONLINE || !profile.lastSeen) return false;
  const seenMs = new Date(profile.lastSeen).getTime();
  if (Number.isNaN(seenMs)) return false;
  return nowMs - seenMs <= ttlSec * 1000;
}
