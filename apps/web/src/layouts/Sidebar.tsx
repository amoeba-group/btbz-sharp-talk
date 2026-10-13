import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, Sparkles, UserCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/store/auth-store';
import { tenantLoginPath } from '@/lib/tenant-path';
import { useUiStore } from '@/store/ui-store';
import { authService } from '@/domain/auth/auth.service';
import { Badge } from '@/components/Badge';
import { useMenuAccess } from '@/lib/use-menu-access';
import { TENANT_NAV, ADMIN_NAV, type NavItem } from './nav-config';
import { cn } from '@/lib/cn';

export function Sidebar() {
  const { t } = useTranslation('nav');
  const { t: tUsers } = useTranslation('users');
  const principal = useAuthStore((s) => s.principal);
  const tenantName = useAuthStore((s) => s.tenantName);
  const tenantSlug = useAuthStore((s) => s.tenantSlug);
  const clear = useAuthStore((s) => s.clear);
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const navigate = useNavigate();
  const isAdmin = principal?.actorType === 'admin';

  const { canSeeMenu } = useMenuAccess();
  const items: NavItem[] = isAdmin
    ? ADMIN_NAV.filter((i) => !i.superAdminOnly || principal?.level === 'super_admin')
    : TENANT_NAV.filter((i) => canSeeMenu(i.code, i.capability));

  const logout = () => {
    // Best-effort server-side revocation of the (in-memory) refresh token;
    // local state is cleared regardless.
    const { refreshToken, tenantSlug: slug } = useAuthStore.getState();
    void authService.logout(refreshToken ?? undefined).catch(() => undefined);
    const target = isAdmin ? '/admin/login' : slug ? tenantLoginPath(slug) : '/';
    clear();
    navigate(target);
  };

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-30 flex h-full flex-col border-r border-gray-200 bg-white transition-[width] duration-200',
        collapsed ? 'w-[64px]' : 'w-[240px]',
      )}
    >
      {/* The logo goes somewhere now: it used to be inert, and a logo that does
          nothing when clicked reads as broken. It opens the all-menus overview. */}
      <NavLink
        to={isAdmin ? '/admin/menu' : '/menu'}
        aria-label={t('allMenus')}
        title={t('allMenus')}
        className="flex h-16 items-center gap-2 border-b border-gray-100 px-4 transition-colors hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-500 text-white">
          <Sparkles className="h-5 w-5" />
        </div>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            {isAdmin ? (
              <>
                <p className="truncate text-sm font-semibold text-gray-900">SharpTalk</p>
                <p className="text-xs text-gray-400">{t('platformAdmin')}</p>
              </>
            ) : (
              <>
                {/* Tenant-first: shop name on top, brand underneath, smaller. */}
                <p className="truncate text-sm font-semibold text-gray-900">
                  {tenantName ?? tenantSlug ?? 'SharpTalk'}
                </p>
                <p className="text-xs text-gray-400">SharpTalk</p>
              </>
            )}
          </div>
        )}
      </NavLink>

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item) => {
          const Icon = item.icon;
          const label = t(item.labelKey);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/admin'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary-500/10 text-primary-600'
                    : 'text-gray-600 hover:bg-gray-100',
                  collapsed && 'justify-center px-0',
                )
              }
              title={collapsed ? label : undefined}
            >
              <Icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Signed-in user, pinned to the bottom: identity + My Page + Logout. */}
      <div className="border-t border-gray-100 p-3">
        {!collapsed && (
          <div className="mb-2 px-1 leading-tight">
            <p className="truncate text-xs font-medium text-gray-800">{principal?.email}</p>
            <div className="mt-1">
              <Badge tone={isAdmin ? 'primary' : 'info'}>
                {isAdmin
                  ? 'admin'
                  : principal?.rank
                    ? tUsers(`rankName.${principal.rank}`, { defaultValue: principal.rank })
                    : 'user'}
              </Badge>
            </div>
          </div>
        )}
        <div className={cn('flex gap-1', collapsed && 'flex-col items-center')}>
          <NavLink
            to={isAdmin ? '/admin/my-page' : '/my-page'}
            className={({ isActive }) =>
              cn(
                'flex flex-1 items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-medium transition-colors',
                isActive ? 'bg-primary-500/10 text-primary-600' : 'text-gray-600 hover:bg-gray-100',
                collapsed && 'w-10 flex-none',
              )
            }
            title={t('myPage')}
          >
            <UserCircle className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{t('myPage')}</span>}
          </NavLink>
          <button
            onClick={logout}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-100',
              collapsed && 'w-10 flex-none',
            )}
            title={t('logout')}
          >
            <LogOut className="h-4 w-4 shrink-0" />
            {!collapsed && <span>{t('logout')}</span>}
          </button>
        </div>
      </div>
    </aside>
  );
}
