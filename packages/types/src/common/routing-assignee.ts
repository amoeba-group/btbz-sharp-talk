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
 */
export interface AssigneeGroupSelector {
  unitIds?: ReadonlyArray<number | string>;
  labelCodes?: ReadonlyArray<string>;
}

export interface AssigneeCandidate {
  id: number | string;
  status?: string | null;
  unitId?: number | string | null;
  labelCodes?: ReadonlyArray<string> | null;
}

const ids = (list: ReadonlyArray<number | string> | undefined) =>
  (list ?? []).map((v) => String(v).trim()).filter((v) => v.length > 0 && v !== 'null' && v !== 'NaN');
const codes = (list: ReadonlyArray<string> | undefined) =>
  (list ?? []).map((v) => String(v).trim().toLowerCase()).filter(Boolean);

/** Does the selector ask for anything at all? An empty selector is not a group. */
export function hasAssigneeGroup(sel: AssigneeGroupSelector | null | undefined): boolean {
  return !!sel && (ids(sel.unitIds).length > 0 || codes(sel.labelCodes).length > 0);
}

/** User ids (as strings) the selector resolves to right now. Empty selector → []. */
export function resolveAssigneeGroup(
  users: ReadonlyArray<AssigneeCandidate>,
  sel: AssigneeGroupSelector | null | undefined,
): string[] {
  if (!hasAssigneeGroup(sel)) return [];
  const unitSet = new Set(ids(sel!.unitIds));
  const labelSet = new Set(codes(sel!.labelCodes));
  return users
    .filter((u) => (u.status ?? 'active') === 'active')
    .filter((u) => unitSet.size === 0 || (u.unitId != null && unitSet.has(String(u.unitId))))
    .filter((u) => labelSet.size === 0 || (u.labelCodes ?? []).some((c) => labelSet.has(String(c).toLowerCase())))
    .map((u) => String(u.id));
}
