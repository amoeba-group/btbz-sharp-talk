import { JOB_LABEL, JobLabel } from '../common/enum.types';

/**
 * Console menu catalog — PLN-260812-Menu-Provisioning-Access.
 *
 * The tenant console's left nav used to exist only as a hard-coded array in
 * `apps/web/src/layouts/nav-config.ts`, which meant the server had no notion of
 * a "menu" at all: hiding an item was decoration a URL could walk straight past.
 * This catalog is the single source of truth both sides judge against.
 *
 * A menu code is one SCREEN, not one capability. The old nav gated several
 * screens behind a shared capability (`live_chat` covered both live chat and
 * the issue board), so those screens could never be provisioned apart.
 */
export const MENU = {
  DASHBOARD: 'dashboard',
  LIVE_CHAT: 'live_chat',
  ISSUES: 'issues',
  HISTORY: 'history',
  /** Customer journey board (PLN-261006 P3). */
  JOURNEY: 'journey',
  WORK_LOG: 'work_log',
  STATISTICS: 'statistics',
  AI_SETTINGS: 'ai_settings',
  KNOWLEDGE: 'knowledge',
  PRODUCTS: 'products',
  CUSTOMERS: 'customers',
  ORDERS: 'orders',
  CAMPAIGNS: 'campaigns',
  REVIEWS: 'reviews',
  USERS: 'users',
  /**
   * The settings landing page. Kept after the split into six screens because
   * plan presets and stored per-tenant overrides reference it, and because the
   * left nav needs something to hang the group on. It now redirects to
   * `settings_basic` rather than rendering everything itself.
   */
  SETTINGS: 'settings',
  // Six screens, six codes — the catalog's rule is one code per SCREEN, and a
  // tenant that should see widget settings but not integration credentials was
  // previously impossible to express (PLN-260824 B).
  SETTINGS_BASIC: 'settings_basic',
  SETTINGS_WIDGET: 'settings_widget',
  SETTINGS_PLATFORMS: 'settings_platforms',
  SETTINGS_MARKETING: 'settings_marketing',
  SETTINGS_MESSENGERS: 'settings_messengers',
  SETTINGS_ETC: 'settings_etc',
  PRIVACY_NOTICE: 'privacy_notice',
} as const;
export type MenuCode = (typeof MENU)[keyof typeof MENU];

export interface MenuCatalogEntry {
  code: MenuCode;
  /** Console route the menu opens. */
  path: string;
  /** i18n key in the web app's `nav` namespace — menu names are already translated there. */
  labelKey: string;
  /**
   * Job label the screen has always required. Kept as a separate axis from the
   * rank matrix so a tenant editing the matrix does not silently widen who can
   * see consult-only or operations-only screens.
   */
  requiredLabel?: JobLabel;
}

export const MENU_CATALOG: readonly MenuCatalogEntry[] = [
  { code: MENU.DASHBOARD, path: '/dashboard', labelKey: 'dashboard' },
  { code: MENU.LIVE_CHAT, path: '/live-chat', labelKey: 'liveChat', requiredLabel: JOB_LABEL.CONSULT },
  { code: MENU.ISSUES, path: '/issues', labelKey: 'issueBoard', requiredLabel: JOB_LABEL.CONSULT },
  { code: MENU.HISTORY, path: '/history', labelKey: 'history', requiredLabel: JOB_LABEL.CONSULT },
  { code: MENU.JOURNEY, path: '/journey', labelKey: 'journey', requiredLabel: JOB_LABEL.CONSULT },
  { code: MENU.WORK_LOG, path: '/work-log', labelKey: 'workLog' },
  { code: MENU.STATISTICS, path: '/statistics', labelKey: 'statistics' },
  { code: MENU.AI_SETTINGS, path: '/ai-setting', labelKey: 'aiSettings' },
  { code: MENU.KNOWLEDGE, path: '/knowledge', labelKey: 'knowledge', requiredLabel: JOB_LABEL.OPERATIONS },
  { code: MENU.PRODUCTS, path: '/products', labelKey: 'products', requiredLabel: JOB_LABEL.OPERATIONS },
  { code: MENU.CUSTOMERS, path: '/customers', labelKey: 'customers', requiredLabel: JOB_LABEL.OPERATIONS },
  { code: MENU.ORDERS, path: '/orders', labelKey: 'orders', requiredLabel: JOB_LABEL.OPERATIONS },
  { code: MENU.CAMPAIGNS, path: '/campaigns', labelKey: 'campaigns', requiredLabel: JOB_LABEL.OPERATIONS },
  { code: MENU.REVIEWS, path: '/reviews', labelKey: 'reviews', requiredLabel: JOB_LABEL.OPERATIONS },
  { code: MENU.USERS, path: '/users', labelKey: 'users' },
  { code: MENU.SETTINGS, path: '/settings', labelKey: 'settings' },
  { code: MENU.SETTINGS_BASIC, path: '/settings/basic', labelKey: 'settingsBasic' },
  { code: MENU.SETTINGS_WIDGET, path: '/settings/widget', labelKey: 'settingsWidget' },
  { code: MENU.SETTINGS_PLATFORMS, path: '/settings/platforms', labelKey: 'settingsPlatforms' },
  { code: MENU.SETTINGS_MARKETING, path: '/settings/marketing', labelKey: 'settingsMarketing' },
  { code: MENU.SETTINGS_MESSENGERS, path: '/settings/messengers', labelKey: 'settingsMessengers' },
  { code: MENU.SETTINGS_ETC, path: '/settings/etc', labelKey: 'settingsEtc' },
  { code: MENU.PRIVACY_NOTICE, path: '/privacy-notice', labelKey: 'privacyNotice' },
] as const;

export const ALL_MENU_CODES: readonly MenuCode[] = MENU_CATALOG.map((m) => m.code);

export function isMenuCode(value: string): value is MenuCode {
  return (ALL_MENU_CODES as readonly string[]).includes(value);
}

/**
 * Tenant plans the platform admin can assign (REQ-260825). `custom` means
 * "no preset" — it is deliberately absent from PLAN_MENUS, so it falls into
 * the provision-everything branch (ivyusa's historical value).
 */
export const TENANT_PLAN = {
  STARTER: 'starter',
  GROWTH: 'growth',
  ENTERPRISE: 'enterprise',
  CUSTOM: 'custom',
} as const;
export type TenantPlan = (typeof TENANT_PLAN)[keyof typeof TENANT_PLAN];
export const TENANT_PLAN_VALUES: readonly TenantPlan[] = Object.values(TENANT_PLAN);

/**
 * Issue-workflow entitlement per tenant (REQ-260807 §11.1, server-judged):
 * menu provisioning only controls navigation — THIS decides whether the issue
 * board actually works ('native'), hands off externally ('bridge'), or stays
 * a plain chat list ('base').
 */
export const WORKFLOW_MODE = { BASE: 'base', BRIDGE: 'bridge', NATIVE: 'native' } as const;
export type WorkflowMode = (typeof WORKFLOW_MODE)[keyof typeof WORKFLOW_MODE];
export const WORKFLOW_MODE_VALUES: readonly WorkflowMode[] = Object.values(WORKFLOW_MODE);

/**
 * Plan presets — which menus a plan includes before any per-tenant override.
 *
 * A plan the map does not know (including `null`, which most existing tenants
 * carry) provisions EVERYTHING. Defaulting to "nothing" would have silently
 * emptied every live console the moment this shipped.
 */
/**
 * The six settings screens, kept together so a plan that grants settings grants
 * all of them. Splitting a plan across them is a sales decision nobody has
 * made; encoding one here by accident would quietly take screens away from
 * tenants that have them today.
 */
export const SETTINGS_MENUS: readonly MenuCode[] = [
  MENU.SETTINGS_BASIC,
  MENU.SETTINGS_WIDGET,
  MENU.SETTINGS_PLATFORMS,
  MENU.SETTINGS_MARKETING,
  MENU.SETTINGS_MESSENGERS,
  MENU.SETTINGS_ETC,
];

export const PLAN_MENUS: Record<string, readonly MenuCode[]> = {
  starter: [
    MENU.DASHBOARD,
    MENU.LIVE_CHAT,
    MENU.HISTORY,
    MENU.KNOWLEDGE,
    MENU.CUSTOMERS,
    MENU.ORDERS,
    MENU.USERS,
    MENU.SETTINGS,
    ...SETTINGS_MENUS,
    MENU.PRIVACY_NOTICE,
  ],
  growth: [
    MENU.DASHBOARD,
    MENU.LIVE_CHAT,
    MENU.HISTORY,
    MENU.JOURNEY,
    MENU.WORK_LOG,
    MENU.STATISTICS,
    MENU.AI_SETTINGS,
    MENU.KNOWLEDGE,
    MENU.PRODUCTS,
    MENU.CUSTOMERS,
    MENU.ORDERS,
    MENU.CAMPAIGNS,
    MENU.REVIEWS,
    MENU.USERS,
    MENU.SETTINGS,
    ...SETTINGS_MENUS,
    MENU.PRIVACY_NOTICE,
  ],
  enterprise: ALL_MENU_CODES,
};

/** Platform-admin override of a plan preset, per tenant per menu. */
export const MENU_PROVISION_MODE = { PLAN: 'plan', ON: 'on', OFF: 'off' } as const;
export type MenuProvisionMode = (typeof MENU_PROVISION_MODE)[keyof typeof MENU_PROVISION_MODE];

/** Tenant override of the rank matrix, per user per menu. */
export const MENU_ACCESS_MODE = { DEFAULT: 'default', ALLOW: 'allow', DENY: 'deny' } as const;
export type MenuAccessMode = (typeof MENU_ACCESS_MODE)[keyof typeof MENU_ACCESS_MODE];
