import { ALL_MENU_CODES, JOB_LABEL, JobLabel, MENU, MenuCode, USER_RANK, UserRank } from '@sharptalk/types';
import {
  DEFAULT_ROLE_MENUS,
  resolveEffectiveMenus,
  resolveProvidedMenus,
  RoleMenuRow,
} from './menu-access';

const ALL = [...ALL_MENU_CODES];
const RANKS: UserRank[] = [USER_RANK.MASTER, USER_RANK.DIRECTOR, USER_RANK.MANAGER, USER_RANK.STAFF];
const LABEL_SETS: JobLabel[][] = [
  [],
  [JOB_LABEL.CONSULT],
  [JOB_LABEL.OPERATIONS],
  [JOB_LABEL.ACCOUNTING],
  [JOB_LABEL.CONSULT, JOB_LABEL.OPERATIONS],
  [JOB_LABEL.CONSULT, JOB_LABEL.ACCOUNTING],
  [JOB_LABEL.OPERATIONS, JOB_LABEL.ACCOUNTING],
  [JOB_LABEL.CONSULT, JOB_LABEL.OPERATIONS, JOB_LABEL.ACCOUNTING],
];

// ---------------------------------------------------------------------------
// Reference implementation: the console's ORIGINAL menu visibility rule, copied
// verbatim from apps/web/src/lib/rbac.ts + layouts/nav-config.ts as they stood
// before PLN-260812. Everything below asserts the new server-side resolution is
// identical to it when no tenant has configured anything — the regression gate
// for stage S1.
// ---------------------------------------------------------------------------
const LEGACY_LABEL_CAPS: Record<string, string[]> = {
  consult: ['live_chat', 'history'],
  operations: ['orders', 'customers', 'campaigns', 'reviews', 'knowledge'],
  accounting: ['affiliates'],
};

const LEGACY_RANK_EXTRA: Record<UserRank, string[]> = {
  master: [
    'dashboard', 'live_chat', 'history', 'orders', 'customers', 'campaigns', 'reviews',
    'knowledge', 'affiliates', 'ai_settings', 'users', 'settings', 'work_log', 'statistics',
  ],
  director: [
    'dashboard', 'live_chat', 'history', 'orders', 'customers', 'campaigns', 'reviews',
    'knowledge', 'affiliates', 'ai_settings', 'settings', 'work_log', 'statistics',
  ],
  manager: ['dashboard', 'ai_settings', 'statistics'],
  staff: ['dashboard'],
};

/** nav-config.ts: which capability each menu item was gated behind. */
const LEGACY_MENU_CAP: Record<MenuCode, string> = {
  dashboard: 'dashboard',
  live_chat: 'live_chat',
  issues: 'live_chat',
  history: 'history',
  // Journey board (PLN-261006): a live-chat screen, same holders as the issue board.
  journey: 'live_chat',
  work_log: 'work_log',
  statistics: 'statistics',
  ai_settings: 'ai_settings',
  knowledge: 'knowledge',
  products: 'knowledge',
  customers: 'customers',
  orders: 'orders',
  campaigns: 'campaigns',
  reviews: 'reviews',
  users: 'users',
  settings: 'settings',
  // The six settings screens inherit the capability the single screen had, so
  // this fixture keeps asserting the same thing it always did: nobody gains or
  // loses reach because the page was split (PLN-260824 B).
  settings_basic: 'settings',
  settings_widget: 'settings',
  settings_platforms: 'settings',
  settings_marketing: 'settings',
  settings_messengers: 'settings',
  settings_etc: 'settings',
  privacy_notice: 'settings',
};

function legacyCapabilities(rank: UserRank, labels: JobLabel[]): Set<string> {
  const caps = new Set<string>();
  caps.add('dashboard');
  if (rank === 'master') {
    LEGACY_RANK_EXTRA.master.forEach((c) => caps.add(c));
    return caps;
  }
  LEGACY_RANK_EXTRA[rank].forEach((c) => caps.add(c));
  for (const label of labels) {
    const granted = LEGACY_LABEL_CAPS[label];
    if (!granted) continue;
    for (const cap of granted) {
      if (rank === 'staff' && !['live_chat', 'orders'].includes(cap)) continue;
      caps.add(cap);
    }
  }
  return caps;
}

function legacyMenus(rank: UserRank, labels: JobLabel[]): MenuCode[] {
  const caps = legacyCapabilities(rank, labels);
  return ALL.filter((code) => caps.has(LEGACY_MENU_CAP[code]));
}

describe('resolveProvidedMenus', () => {
  it('provisions everything for a tenant with no plan (existing tenants)', () => {
    expect(resolveProvidedMenus(null)).toEqual(ALL);
    expect(resolveProvidedMenus(undefined)).toEqual(ALL);
  });

  it('provisions everything for a plan the preset map does not know', () => {
    expect(resolveProvidedMenus('legacy-pilot')).toEqual(ALL);
  });

  it('applies the plan preset', () => {
    const starter = resolveProvidedMenus('starter');
    expect(starter).toContain(MENU.LIVE_CHAT);
    expect(starter).not.toContain(MENU.STATISTICS);
    expect(starter).not.toContain(MENU.ISSUES);
    expect(resolveProvidedMenus('enterprise')).toEqual(ALL);
  });

  it('lets a per-tenant override add and remove against the preset', () => {
    const menus = resolveProvidedMenus('starter', [
      { menuCode: MENU.ISSUES, provided: true },
      { menuCode: MENU.ORDERS, provided: false },
    ]);
    expect(menus).toContain(MENU.ISSUES);
    expect(menus).not.toContain(MENU.ORDERS);
  });

  it('returns menus in catalog order regardless of override order', () => {
    const menus = resolveProvidedMenus('starter', [{ menuCode: MENU.ISSUES, provided: true }]);
    expect(menus).toEqual(ALL.filter((c) => menus.includes(c)));
  });
});

describe('resolveEffectiveMenus — no tenant configuration (regression gate)', () => {
  for (const rank of RANKS) {
    for (const labels of LABEL_SETS) {
      it(`matches the legacy console rule for ${rank} [${labels.join(',') || 'no labels'}]`, () => {
        expect(resolveEffectiveMenus({ provided: ALL, rank, labels })).toEqual(
          legacyMenus(rank, labels),
        );
      });
    }
  }
});

describe('resolveEffectiveMenus — provisioning ceiling', () => {
  it('hides menus the tenant is not provisioned for, master included', () => {
    const provided = resolveProvidedMenus('starter');
    const menus = resolveEffectiveMenus({ provided, rank: USER_RANK.MASTER, labels: [] });
    expect(menus).not.toContain(MENU.STATISTICS);
    expect(menus).toEqual(provided);
  });

  it('cannot be re-opened by a per-user allow exception', () => {
    const menus = resolveEffectiveMenus({
      provided: resolveProvidedMenus('starter'),
      rank: USER_RANK.MANAGER,
      labels: [],
      userRows: [{ menuCode: MENU.STATISTICS, allowed: true }],
    });
    expect(menus).not.toContain(MENU.STATISTICS);
  });
});

describe('resolveEffectiveMenus — tenant layers', () => {
  it('lets the rank matrix deny a menu the rank had by default', () => {
    const roleRows: RoleMenuRow[] = [
      { rank: USER_RANK.DIRECTOR, menuCode: MENU.SETTINGS, allowed: false },
    ];
    const menus = resolveEffectiveMenus({ provided: ALL, rank: USER_RANK.DIRECTOR, labels: [], roleRows });
    expect(menus).not.toContain(MENU.SETTINGS);
  });

  it('lets the rank matrix grant a menu the rank never had', () => {
    const roleRows: RoleMenuRow[] = [
      { rank: USER_RANK.MANAGER, menuCode: MENU.WORK_LOG, allowed: true },
    ];
    const menus = resolveEffectiveMenus({ provided: ALL, rank: USER_RANK.MANAGER, labels: [], roleRows });
    expect(menus).toContain(MENU.WORK_LOG);
  });

  it('still requires the job label for a label-gated menu granted by the matrix', () => {
    const roleRows: RoleMenuRow[] = [
      { rank: USER_RANK.STAFF, menuCode: MENU.HISTORY, allowed: true },
    ];
    const base = { provided: ALL, rank: USER_RANK.STAFF, roleRows } as const;
    expect(resolveEffectiveMenus({ ...base, labels: [] })).not.toContain(MENU.HISTORY);
    expect(resolveEffectiveMenus({ ...base, labels: [JOB_LABEL.CONSULT] })).toContain(MENU.HISTORY);
  });

  it('per-user allow beats both the rank matrix and the label gate', () => {
    const menus = resolveEffectiveMenus({
      provided: ALL,
      rank: USER_RANK.STAFF,
      labels: [],
      roleRows: [{ rank: USER_RANK.STAFF, menuCode: MENU.HISTORY, allowed: false }],
      userRows: [{ menuCode: MENU.HISTORY, allowed: true }],
    });
    expect(menus).toContain(MENU.HISTORY);
  });

  it('per-user deny beats a rank matrix grant', () => {
    const menus = resolveEffectiveMenus({
      provided: ALL,
      rank: USER_RANK.DIRECTOR,
      labels: [],
      userRows: [{ menuCode: MENU.STATISTICS, allowed: false }],
    });
    expect(menus).not.toContain(MENU.STATISTICS);
  });

  it('leaves master untouched by tenant-side rows (no self-lockout)', () => {
    const menus = resolveEffectiveMenus({
      provided: ALL,
      rank: USER_RANK.MASTER,
      labels: [],
      roleRows: ALL.map((menuCode) => ({ rank: USER_RANK.MASTER, menuCode, allowed: false })),
      userRows: [
        { menuCode: MENU.SETTINGS, allowed: false },
        { menuCode: MENU.USERS, allowed: false },
      ],
    });
    expect(menus).toEqual(ALL);
  });

  it('ignores rows belonging to another rank', () => {
    const menus = resolveEffectiveMenus({
      provided: ALL,
      rank: USER_RANK.DIRECTOR,
      labels: [],
      roleRows: [{ rank: USER_RANK.STAFF, menuCode: MENU.SETTINGS, allowed: false }],
    });
    expect(menus).toContain(MENU.SETTINGS);
  });
});

describe('DEFAULT_ROLE_MENUS', () => {
  it('keeps user management master-only, as the console always did', () => {
    expect(DEFAULT_ROLE_MENUS.master).toContain(MENU.USERS);
    expect(DEFAULT_ROLE_MENUS.director).not.toContain(MENU.USERS);
    expect(DEFAULT_ROLE_MENUS.manager).not.toContain(MENU.USERS);
    expect(DEFAULT_ROLE_MENUS.staff).not.toContain(MENU.USERS);
  });
});

describe('sales_admin label (PLN-261007)', () => {
  const provided = resolveProvidedMenus(null);
  const menusFor = (rank: UserRank, labels: JobLabel[]) =>
    resolveEffectiveMenus({ provided, rank, labels });

  it('opens the consult screens plus customers and orders for staff', () => {
    const menus = menusFor(USER_RANK.STAFF, [JOB_LABEL.SALES_ADMIN]);
    expect(menus).toEqual(expect.arrayContaining([MENU.LIVE_CHAT, MENU.ISSUES, MENU.JOURNEY, MENU.ORDERS]));
    // Staff never reached customers before; the rank matrix still says no.
    expect(menus).not.toContain(MENU.CUSTOMERS);
  });

  it('opens customers and orders for a manager without widening to campaigns/knowledge', () => {
    const menus = menusFor(USER_RANK.MANAGER, [JOB_LABEL.SALES_ADMIN]);
    expect(menus).toEqual(expect.arrayContaining([MENU.LIVE_CHAT, MENU.HISTORY, MENU.CUSTOMERS, MENU.ORDERS]));
    expect(menus).not.toContain(MENU.CAMPAIGNS);
    expect(menus).not.toContain(MENU.KNOWLEDGE);
    expect(menus).not.toContain(MENU.REVIEWS);
  });

  it('is a superset of consult for a manager', () => {
    const consult = menusFor(USER_RANK.MANAGER, [JOB_LABEL.CONSULT]);
    const sales = menusFor(USER_RANK.MANAGER, [JOB_LABEL.SALES_ADMIN]);
    for (const m of consult) expect(sales).toContain(m);
  });
});

