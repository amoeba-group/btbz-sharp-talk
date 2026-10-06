import {
  ALL_MENU_CODES,
  MENU,
  MENU_CATALOG,
  MenuCode,
  PLAN_MENUS,
  USER_RANK,
  UserRank,
  JobLabel,
} from '@sharptalk/types';

/**
 * Menu access resolution — PLN-260812-Menu-Provisioning-Access.
 *
 * Two layers, judged server-side:
 *   ① platform admin provisions menus per tenant (the ceiling),
 *   ② the tenant master decides who inside the tenant reaches them.
 *
 * Both `DEFAULT_ROLE_MENUS` and `RANK_LABEL_EXEMPT_MENUS` below are a
 * decomposition of the console's pre-existing visibility rule
 * (`apps/web/src/lib/rbac.ts` `capabilitiesFor`), which was a UNION of a
 * rank grant and a label grant. Splitting it into "may this rank reach the
 * screen at all" × "does the screen still need the label" is what lets a tenant
 * edit the first half without accidentally widening the second.
 * `menu-access.spec.ts` asserts the decomposition reproduces the old rule
 * exactly for every rank × label combination — that equality IS the
 * no-regression guarantee for stage S1.
 */

/** Rank baseline: which menus the rank may reach when nothing is configured. */
export const DEFAULT_ROLE_MENUS: Record<UserRank, readonly MenuCode[]> = {
  [USER_RANK.MASTER]: ALL_MENU_CODES,
  // Everything but user management (that stayed master-only).
  [USER_RANK.DIRECTOR]: ALL_MENU_CODES.filter((c) => c !== MENU.USERS),
  // Rank-granted three, plus the label-gated screens their labels can open.
  [USER_RANK.MANAGER]: [
    MENU.DASHBOARD,
    MENU.AI_SETTINGS,
    MENU.STATISTICS,
    MENU.LIVE_CHAT,
    MENU.ISSUES,
    MENU.HISTORY,
    MENU.JOURNEY,
    MENU.KNOWLEDGE,
    MENU.PRODUCTS,
    MENU.CUSTOMERS,
    MENU.ORDERS,
    MENU.CAMPAIGNS,
    MENU.REVIEWS,
  ],
  // Staff only ever handled: chat and orders, and only with the matching label.
  [USER_RANK.STAFF]: [MENU.DASHBOARD, MENU.LIVE_CHAT, MENU.ISSUES, MENU.JOURNEY, MENU.ORDERS],
};

/**
 * Menus a rank sees WITHOUT holding the job label, because the rank itself
 * granted them before this feature existed. Dropping this would hide live chat
 * and orders from every director who happens to carry no label — a regression
 * disguised as a tightening.
 */
export const RANK_LABEL_EXEMPT_MENUS: Record<UserRank, readonly MenuCode[]> = {
  [USER_RANK.MASTER]: ALL_MENU_CODES,
  [USER_RANK.DIRECTOR]: ALL_MENU_CODES.filter((c) => c !== MENU.USERS),
  [USER_RANK.MANAGER]: [MENU.DASHBOARD, MENU.AI_SETTINGS, MENU.STATISTICS],
  [USER_RANK.STAFF]: [MENU.DASHBOARD],
};

const REQUIRED_LABEL = new Map<MenuCode, JobLabel>(
  MENU_CATALOG.filter((m) => m.requiredLabel).map((m) => [m.code, m.requiredLabel as JobLabel]),
);

/** Platform-admin override row (`tenant_menus`). */
export interface TenantMenuOverride {
  menuCode: MenuCode;
  provided: boolean;
}

/** Tenant rank-matrix row (`tenant_role_menus`). */
export interface RoleMenuRow {
  rank: UserRank;
  menuCode: MenuCode;
  allowed: boolean;
}

/** Tenant per-user exception row (`tenant_user_menus`). */
export interface UserMenuRow {
  menuCode: MenuCode;
  allowed: boolean;
}

/**
 * Menus the tenant is entitled to: the plan preset, with per-tenant overrides
 * applied. An unknown or null plan provisions everything (see PLAN_MENUS).
 */
export function resolveProvidedMenus(
  plan: string | null | undefined,
  overrides: readonly TenantMenuOverride[] = [],
): MenuCode[] {
  const preset = (plan && PLAN_MENUS[plan]) || ALL_MENU_CODES;
  const provided = new Set<MenuCode>(preset);
  for (const o of overrides) {
    if (o.provided) provided.add(o.menuCode);
    else provided.delete(o.menuCode);
  }
  // Keep catalog order so callers can render without re-sorting.
  return ALL_MENU_CODES.filter((c) => provided.has(c));
}

/** Rank row lookup with the code default when the tenant has not saved one. */
export function roleAllows(rank: UserRank, menu: MenuCode, roleRows: readonly RoleMenuRow[] = []): boolean {
  const row = roleRows.find((r) => r.rank === rank && r.menuCode === menu);
  if (row) return row.allowed;
  return DEFAULT_ROLE_MENUS[rank]?.includes(menu) ?? false;
}

/** Whether the job-label gate on a screen is satisfied (or waived by rank). */
export function labelAllows(rank: UserRank, menu: MenuCode, labels: readonly JobLabel[]): boolean {
  const required = REQUIRED_LABEL.get(menu);
  if (!required) return true;
  if (RANK_LABEL_EXEMPT_MENUS[rank]?.includes(menu)) return true;
  return labels.includes(required);
}

export interface EffectiveMenuInput {
  /** Output of resolveProvidedMenus — the tenant ceiling. */
  provided: readonly MenuCode[];
  rank: UserRank;
  labels: readonly JobLabel[];
  roleRows?: readonly RoleMenuRow[];
  userRows?: readonly UserMenuRow[];
}

/**
 * Menus this user actually sees.
 *
 * Precedence: provisioning > master > per-user exception > rank matrix ∧ label.
 * Master is deliberately exempt from the tenant-side layers — a tenant that
 * could revoke its own master's settings and user-management screens would have
 * no way back in.
 */
export function resolveEffectiveMenus(input: EffectiveMenuInput): MenuCode[] {
  const { provided, rank, labels, roleRows = [], userRows = [] } = input;
  const providedSet = new Set(provided);

  return ALL_MENU_CODES.filter((menu) => {
    if (!providedSet.has(menu)) return false;
    if (rank === USER_RANK.MASTER) return true;

    const override = userRows.find((r) => r.menuCode === menu);
    if (override) return override.allowed;

    return roleAllows(rank, menu, roleRows) && labelAllows(rank, menu, labels);
  });
}
