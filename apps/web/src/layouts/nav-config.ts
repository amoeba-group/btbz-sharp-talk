import {
  LayoutDashboard,
  MessagesSquare,
  SquareKanban,
  History,
  Route,
  ClipboardList,
  BarChart3,
  Bot,
  BookOpen,
  Users,
  ShoppingCart,
  Package,
  Megaphone,
  Star,
  UserCog,
  Settings,
  Building2,
  Cpu,
  ScrollText,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
// Type-only: @sharptalk/types ships CJS whose runtime exports Rollup cannot see.
import type { MenuCode } from '@sharptalk/types';
import type { Capability } from '@/lib/rbac';

export interface NavItem {
  to: string;
  labelKey: string; // i18n key in the `nav` namespace
  icon: LucideIcon;
  /**
   * Catalog code the server judges visibility by (PLN-260812). One code per
   * SCREEN — which is why the issue board, the product list and the privacy
   * notice each have their own even though they used to share a capability
   * with a neighbour and could never be provisioned apart from it.
   */
  code?: MenuCode;
  /** Legacy local gate; used only when the server's menu list is unavailable. */
  capability?: Capability;
  /** Admin nav only: shown to super_admin, hidden from admin-level operators. */
  superAdminOnly?: boolean;
}

export const TENANT_NAV: NavItem[] = [
  { to: '/dashboard', labelKey: 'dashboard', icon: LayoutDashboard, code: 'dashboard', capability: 'dashboard' },
  { to: '/live-chat', labelKey: 'liveChat', icon: MessagesSquare, code: 'live_chat', capability: 'live_chat' },
  // Issue board (P4) — same holders as live chat; non-native tenants get a notice.
  { to: '/issues', labelKey: 'issueBoard', icon: SquareKanban, code: 'issues', capability: 'live_chat' },
  { to: '/history', labelKey: 'history', icon: History, code: 'history', capability: 'history' },
  // Customer journey board (PLN-261006 P3) — same holders as live chat.
  { to: '/journey', labelKey: 'journey', icon: Route, code: 'journey', capability: 'live_chat' },
  // Audit-backed agent activity — same holders as TENANT_AUDIT_READ.
  { to: '/work-log', labelKey: 'workLog', icon: ClipboardList, code: 'work_log', capability: 'work_log' },
  { to: '/statistics', labelKey: 'statistics', icon: BarChart3, code: 'statistics', capability: 'statistics' },
  { to: '/ai-setting', labelKey: 'aiSettings', icon: Bot, code: 'ai_settings', capability: 'ai_settings' },
  { to: '/knowledge', labelKey: 'knowledge', icon: BookOpen, code: 'knowledge', capability: 'knowledge' },
  // The synced catalogue that feeds product knowledge — same group as Knowledge.
  { to: '/products', labelKey: 'products', icon: Package, code: 'products', capability: 'knowledge' },
  { to: '/customers', labelKey: 'customers', icon: Users, code: 'customers', capability: 'customers' },
  { to: '/orders', labelKey: 'orders', icon: ShoppingCart, code: 'orders', capability: 'orders' },
  { to: '/campaigns', labelKey: 'campaigns', icon: Megaphone, code: 'campaigns', capability: 'campaigns' },
  // Review moderation console (D3) — same operations group as the API's MODULE_OPERATIONS gate.
  { to: '/reviews', labelKey: 'reviews', icon: Star, code: 'reviews', capability: 'reviews' },
  { to: '/users', labelKey: 'users', icon: UserCog, code: 'users', capability: 'users' },
  // One entry, seven tabs inside (PLN-260824 D6 revised). Six nav lines all
  // reading "settings" pushed the sidebar past twenty entries; the screens are
  // still separate routes and still provisioned one by one, they are just
  // reached by tab. The consent notice moved in with them — it is a setting.
  { to: '/settings', labelKey: 'settings', icon: Settings, code: 'settings', capability: 'settings' },
];

export const ADMIN_NAV: NavItem[] = [
  { to: '/admin', labelKey: 'overview', icon: ShieldCheck },
  { to: '/admin/tenants', labelKey: 'tenants', icon: Building2 },
  // Platform-admin accounts (REQ-260824) — matches the server's super-only gate.
  { to: '/admin/admins', labelKey: 'admins', icon: UserCog, superAdminOnly: true },
  { to: '/admin/ai-engines', labelKey: 'aiEngines', icon: Cpu },
  { to: '/admin/audit', labelKey: 'audit', icon: ScrollText },
];
