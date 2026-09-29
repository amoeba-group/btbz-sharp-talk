import { useTranslation } from 'react-i18next';
import { WidgetThemeCard, WidgetTabsCard, WidgetBehaviorCard, InstallGuideCard } from './SettingsPage';
import { EmbedCard } from './EmbedCard';
import { WidgetAccessCard } from './WidgetAccessCard';
import { DesignAssetsCard } from './DesignAssetsCard';
import { WidgetDesignsCard } from './WidgetDesignsCard';

/** Tenant settings — widget (PLN-260824 B). Composition only; every card moved here unchanged. */
export function SettingsWidgetPage() {
  const { t } = useTranslation('settings');

  return (
    <div className="space-y-6">
      {/* The tab already names the section; this says what it is for. */}
      <p className="text-sm text-gray-500">{t('groups.widget.subtitle')}</p>
      <WidgetThemeCard />
      {/* Custom widget library — named designs, one in use; none = the basic widget above (PLN-260910 P3). */}
      <WidgetDesignsCard />
      {/* The tenant's own design files — what the design profile (P2) points at (PLN-260910). */}
      <DesignAssetsCard />
      <WidgetTabsCard />
      <WidgetBehaviorCard />
      {/* Where the widget may be embedded, and how a host proves its visitor
          (PLN-260819). Sits next to the install guide because it is the same job. */}
      <EmbedCard />
      {/* Who may SEE the widget while it is being tested (PLN-260929). Next to
          the embed card because both answer "where does this widget appear" —
          that one for installs, this one for a limited rollout. */}
      <WidgetAccessCard />
      <InstallGuideCard />
    </div>
  );
}
