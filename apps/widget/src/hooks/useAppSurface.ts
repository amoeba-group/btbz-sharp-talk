import { useEffect } from 'react';
import { useWidgetStore } from '../store/widgetStore';
import { apiOrigin } from '../lib/api-client';
import { isAppMode } from '../lib/host-bridge';
import { applyTheme } from '../lib/theme';
import { getShopDomain } from './useSession';
import {
  normalizeMobileAppConfig,
  type MobileAppConfig,
} from '../../../../packages/types/src/common/mobile-app-config';

/**
 * The host APP's own look (PLN-261015 S9): inside a host app the widget reads
 * the tenant's app-surface settings (font, text size, menu style, header, brand)
 * and puts them over the web theme. The merge itself lives in the store; this
 * fetches the settings once per open and re-paints.
 *
 * Fail-open on purpose: no settings, a failed request or an old API simply
 * leaves the web theme in place — the chat must never wait on this.
 */
export function useAppSurface(): void {
  const setAppConfig = useWidgetStore((s) => s.setAppConfig);
  const appConfig = useWidgetStore((s) => s.appConfig);
  const theme = useWidgetStore((s) => s.widgetTheme);

  useEffect(() => {
    if (!isAppMode()) return;
    const shop = getShopDomain() ?? '';
    let cancelled = false;
    fetch(`${apiOrigin()}/public/widget/app-config?shop=${encodeURIComponent(shop)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled) return;
        const cfg: MobileAppConfig | null = normalizeMobileAppConfig(body?.data?.config ?? null);
        setAppConfig(cfg);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setAppConfig]);

  // The store already holds the merged theme; paint it. Session/ensure paints the
  // raw web theme first, so this runs again once the app settings have landed.
  useEffect(() => {
    if (isAppMode() && appConfig) applyTheme(theme);
  }, [appConfig, theme]);
}
