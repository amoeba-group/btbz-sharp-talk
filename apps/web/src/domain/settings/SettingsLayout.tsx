import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { MenuCode } from '@sharptalk/types';
import { PageHeader } from '@/components/PageHeader';
import { useMenuAccess } from '@/lib/use-menu-access';
import { cn } from '@/lib/cn';

interface Tab {
  to: string;
  labelKey: string;
  /**
   * The catalog code that decides whether this tenant has the screen at all.
   *
   * Tabs are presentation; provisioning is not. Splitting settings into screens
   * made "widget settings but not stored credentials" expressible, and folding
   * them into one page must not quietly take that back — so each tab is still
   * judged by its own code, and a hidden one leaves no tab behind.
   */
  code: MenuCode;
}

const TABS: Tab[] = [
  { to: '/settings/basic', labelKey: 'settingsBasic', code: 'settings_basic' },
  // Split out of the basic tab (PLN-261024 D1): same provisioning code, so
  // whoever had basic settings keeps the handoff settings with no new grant.
  { to: '/settings/handoff', labelKey: 'settingsHandoff', code: 'settings_basic' },
  { to: '/settings/widget', labelKey: 'settingsWidget', code: 'settings_widget' },
  { to: '/settings/platforms', labelKey: 'settingsPlatforms', code: 'settings_platforms' },
  { to: '/settings/marketing', labelKey: 'settingsMarketing', code: 'settings_marketing' },
  { to: '/settings/messengers', labelKey: 'settingsMessengers', code: 'settings_messengers' },
  { to: '/settings/etc', labelKey: 'settingsEtc', code: 'settings_etc' },
  // Consent notice moved in here from its own nav entry: it is a setting, and
  // it was the odd one out sitting beside twenty screens of daily work.
  { to: '/settings/privacy', labelKey: 'privacyNotice', code: 'privacy_notice' },
];

/**
 * One "Settings" entry in the left nav, eight tabs inside it.
 *
 * Six separate nav lines said "settings" and pushed the sidebar to twenty-one
 * entries. The screens stay separate routes — deep links, the back button and
 * per-screen provisioning all keep working — but they are reached by tab.
 */
export function SettingsLayout() {
  const { t } = useTranslation('nav');
  const { t: ts } = useTranslation('settings');
  const { canSeeMenu } = useMenuAccess();

  const tabs = TABS.filter((tab) => canSeeMenu(tab.code, 'settings'));

  return (
    <div className="space-y-6">
      <PageHeader title={ts('title')} subtitle={ts('subtitle')} />

      <div className="overflow-x-auto border-b border-gray-200">
        <nav className="flex min-w-max gap-1" aria-label={ts('title')}>
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                cn(
                  'whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-primary-500 text-primary-600'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700',
                )
              }
            >
              {t(tab.labelKey)}
            </NavLink>
          ))}
        </nav>
      </div>

      <Outlet />
    </div>
  );
}
