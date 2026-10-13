/**
 * Queue counters and waiting-time wording for the console's live-chat list (PLN-261012 SG-66).
 *
 * Pure and dependency-free on purpose: the console deep-imports this source file (a value import
 * of the package entry point fails the browser build — see language.ts), and keeping the logic out
 * of the React component is what lets it be unit-tested without a browser.
 */

/** Mirrors the API's `GET /agent/sessions/counts` (dates arrive as ISO strings). */
export interface QueueCountsView {
  total: number;
  /** Per team the customer picked; `id` null = no team (guests, tenants that do not ask). */
  teams: Array<{ id: string | null; count: number }>;
  regions: { north: number; south: number; none: number; unmapped: number };
  /** WAITING conversations nobody holds. */
  unclaimed: number;
  oldestUnclaimedAt: string | null;
  /** The caller's own `users.region`; null = nationwide or none. */
  myRegion: string | null;
}

/**
 * A waiting conversation turns amber after this many minutes. It matches the server default of
 * ALERT_UNCLAIMED_MINUTES (5), the point where the unclaimed re-alert fires.
 */
export const QUEUE_WARN_AFTER_MIN = 5;

function toMs(value: string | Date | null | undefined): number | null {
  if (value == null || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * How long a conversation has been waiting, as `m:ss` (`mm:ss` once past ten minutes, `h:mm:ss`
 * from an hour) — "07:42" in the wireframe. Empty for a missing or unreadable start, and never
 * negative: a clock a little behind the server's reads as "00:00", not "-0:03".
 */
export function formatWait(since: string | Date | null | undefined, nowMs: number): string {
  const start = toMs(since);
  if (start == null) return '';
  const total = Math.max(0, Math.floor((nowMs - start) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Has it waited at least `afterMin` minutes? False without a readable start. */
export function isOverdue(
  since: string | Date | null | undefined,
  nowMs: number,
  afterMin: number = QUEUE_WARN_AFTER_MIN,
): boolean {
  const start = toMs(since);
  return start != null && nowMs - start >= afterMin * 60_000;
}

/** The age shown on a queue row: only for a WAITING conversation that has a start time. */
export function waitingSince(row: { status?: string | null; escalatedAt?: string | null }): string | null {
  return row.status === 'waiting' && toMs(row.escalatedAt) != null ? (row.escalatedAt as string) : null;
}

export interface TeamChip {
  /** `all` or a team option id. */
  id: string;
  count: number;
  active: boolean;
}

/**
 * The chips above the queue: "All teams 14 · CS 9 · Business 5". The first is always "all" and
 * carries the total; then one per team with at least one conversation (and the active one even
 * at zero, so a filter never points at a chip that is not there). Conversations with no team count
 * in the total only.
 */
export function teamChips(counts: QueueCountsView | undefined, active: string): TeamChip[] {
  const chips: TeamChip[] = [{ id: 'all', count: counts?.total ?? 0, active: active === 'all' }];
  const seen = new Set<string>();
  for (const t of counts?.teams ?? []) {
    if (t.id == null) continue;
    seen.add(t.id);
    chips.push({ id: t.id, count: t.count, active: active === t.id });
  }
  if (active !== 'all' && !seen.has(active)) chips.push({ id: active, count: 0, active: true });
  return chips;
}

export type RegionOptionKey = 'all' | 'mine' | 'north' | 'south' | 'none' | 'unmapped';

export interface RegionOption {
  key: RegionOptionKey;
  /** Conversations in the current scope for this choice; null where it is not a single count. */
  count: number | null;
}

/**
 * The region filter's choices with their counts. "My region" appears only for someone who has one
 * (nationwide staff have nothing to default to); "Unlisted province" only when there is one in the
 * queue — or it is the current choice, so the select never shows a value it cannot list.
 */
export function regionOptions(counts: QueueCountsView | undefined, current: string): RegionOption[] {
  const r = counts?.regions;
  const out: RegionOption[] = [{ key: 'all', count: counts?.total ?? null }];
  if (counts?.myRegion === 'north' || counts?.myRegion === 'south') {
    out.push({ key: 'mine', count: r ? r[counts.myRegion] : null });
  } else if (current === 'mine') {
    out.push({ key: 'mine', count: null });
  }
  out.push({ key: 'north', count: r?.north ?? null }, { key: 'south', count: r?.south ?? null });
  out.push({ key: 'none', count: r?.none ?? null });
  if ((r?.unmapped ?? 0) > 0 || current === 'unmapped') out.push({ key: 'unmapped', count: r?.unmapped ?? 0 });
  return out;
}

/** What the region filter starts on: "my region" when the user has one, else everything. */
export function defaultRegionFilter(counts: QueueCountsView | undefined): 'mine' | 'all' {
  return counts?.myRegion === 'north' || counts?.myRegion === 'south' ? 'mine' : 'all';
}

/** "{{count}} unclaimed · oldest {{time}}" inputs, or null when nothing waits unclaimed. */
export function unclaimedSummary(
  counts: QueueCountsView | undefined,
  nowMs: number,
): { count: number; oldest: string; overdue: boolean } | null {
  if (!counts || counts.unclaimed <= 0) return null;
  return {
    count: counts.unclaimed,
    oldest: formatWait(counts.oldestUnclaimedAt, nowMs),
    overdue: isOverdue(counts.oldestUnclaimedAt, nowMs),
  };
}
