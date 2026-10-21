import { canonicalRegion, provinceKey } from './region';

/**
 * Routing-rule assignee groups (PLN-261019-Routing-Assignee-Groups P1).
 *
 * A rule names its agents two ways: explicit user ids (`assigneeUserIds`) and
 * a group selector — unit ids and/or job-label codes. The group is resolved
 * when the handoff happens, not when the rule is saved, so a new team member
 * is paged without anyone editing the rule. Both the API (at routing time) and
 * the console (for the "right now N agents" preview) run this same function,
 * which is why it lives in the shared types package.
 *
 * Semantics (REQ D2/D3): members are ACTIVE users; when units are chosen the
 * user must belong to one of them, when labels are chosen the user must hold
 * one of them, and choosing both means both (intersection). Ids are compared
 * as strings because bigint PKs arrive as strings from TypeORM.
 *
 * Region match (PLN-261022 stage 1): with `byRegion` the group is "whoever
 * covers the session's place" — a user covers what their unit and their labels
 * are scoped to. A province scope is narrower than a region scope, so a
 * province hit wins; nobody at either level means the rule resolves to nobody
 * and routing moves on to the next rule, exactly like an empty team.
 */


export interface AssigneeGroupSelector {
  unitIds?: ReadonlyArray<number | string>;
  labelCodes?: ReadonlyArray<string>;
  /** Resolve to the users whose unit/label scope covers the session's province or region. */
  byRegion?: boolean;
}

export interface AssigneeCandidate {
  id: number | string;
  status?: string | null;
  unitId?: number | string | null;
  labelCodes?: ReadonlyArray<string> | null;
  /** Regions the user covers — their unit's scope ∪ their labels' scopes. */
  regions?: ReadonlyArray<string> | null;
  /** Provinces the user covers — same union. */
  provinces?: ReadonlyArray<string> | null;
}

/** Where the conversation comes from (the session's signed attributes). */
export interface RegionTarget {
  region?: string | null;
  province?: string | null;
}

/** Which scope level picked the agents — logged and shown in the console preview. */
export type RegionMatch = 'province' | 'region' | 'none';

const ids = (list: ReadonlyArray<number | string> | undefined) =>
  (list ?? []).map((v) => String(v).trim()).filter((v) => v.length > 0 && v !== 'null' && v !== 'NaN');
const codes = (list: ReadonlyArray<string> | undefined) =>
  (list ?? []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);

/** Does the selector ask for anything at all? An empty selector is not a group. */
export function hasAssigneeGroup(sel: AssigneeGroupSelector | null | undefined): boolean {
  return !!sel && (ids(sel.unitIds).length > 0 || codes(sel.labelCodes).length > 0 || sel.byRegion === true);
}

/** Active users passing the unit/label filters (an empty list filters nothing). */
function filterByUnitAndLabel(
  users: ReadonlyArray<AssigneeCandidate>,
  sel: AssigneeGroupSelector,
): AssigneeCandidate[] {
  const unitSet = new Set(ids(sel.unitIds));
  const labelSet = new Set(codes(sel.labelCodes));
  return users
    .filter((u) => (u.status ?? 'active') === 'active')
    .filter((u) => unitSet.size === 0 || (u.unitId != null && unitSet.has(String(u.unitId))))
    .filter((u) => labelSet.size === 0 || (u.labelCodes ?? []).some((c) => labelSet.has(String(c).toLowerCase())));
}

/**
 * Region-matched group: among the users passing the unit/label filters, those
 * whose scope names the session's province; failing that, its region.
 */
export function resolveRegionAssignees(
  users: ReadonlyArray<AssigneeCandidate>,
  sel: AssigneeGroupSelector,
  target: RegionTarget | null | undefined,
): { ids: string[]; match: RegionMatch } {
  const pool = filterByUnitAndLabel(users, sel);
  const province = provinceKey(target?.province);
  if (province) {
    const hit = pool.filter((u) => (u.provinces ?? []).some((p) => provinceKey(p) === province));
    if (hit.length) return { ids: hit.map((u) => String(u.id)), match: 'province' };
  }
  const region = canonicalRegion(target?.region);
  if (region) {
    const hit = pool.filter((u) => (u.regions ?? []).some((r) => canonicalRegion(r) === region));
    if (hit.length) return { ids: hit.map((u) => String(u.id)), match: 'region' };
  }
  return { ids: [], match: 'none' };
}

/**
 * User ids (as strings) the selector resolves to right now. Empty selector → [].
 * A region selector needs the session's place; without one it resolves to nobody.
 */
export function resolveAssigneeGroup(
  users: ReadonlyArray<AssigneeCandidate>,
  sel: AssigneeGroupSelector | null | undefined,
  target?: RegionTarget | null,
): string[] {
  if (!hasAssigneeGroup(sel)) return [];
  if (sel!.byRegion) return resolveRegionAssignees(users, sel!, target).ids;
  return filterByUnitAndLabel(users, sel!).map((u) => String(u.id));
}
