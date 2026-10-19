import { useIntegration, useShopifySettings } from './settings.hooks';
import {
  ECOMMERCE_PROVIDERS,
  PLATFORM_CHOICES,
  SELF_PLATFORM_PROVIDER,
  isShopifyDomain,
  type PlatformChoice,
} from './integration-providers';
import type { IntegrationSettings } from './settings.service';

/** One platform as the platforms tab sees it — connected or merely offered (PLN-261019 D3). */
export interface PlatformConnection {
  provider: PlatformChoice;
  /** A credential row exists → it is shown as a card, not an "add" button. */
  configured: boolean;
  /** 'connected' | 'error' | 'unknown' | null (per-tenant; null = no row). */
  status: string | null;
  lastCheckedAt: string | null;
  detail: string | null;
  /** Store domain / mall id / platform name — whatever identifies this connection. */
  identity: string | null;
}

/** The first non-secret field with a value: mall id, store URL, platform name… */
function identityOf(data: IntegrationSettings | undefined): string | null {
  if (!data) return null;
  for (const v of Object.values(data.fields)) if (v && v.trim()) return v.trim();
  return null;
}

function fromIntegration(
  provider: PlatformChoice,
  data: IntegrationSettings | undefined,
): PlatformConnection {
  return {
    provider,
    configured: Boolean(data?.credential.configured),
    status: data?.integration.status ?? null,
    lastCheckedAt: data?.integration.lastSyncAt ?? null,
    detail: data?.integration.detail ?? null,
    identity: identityOf(data),
  };
}

/**
 * Every platform the tab offers, in display order, with this tenant's state.
 * Shopify keeps its own endpoint; the rest share the generic one. Hooks are
 * called unconditionally for a fixed list, so the order never changes.
 */
export function usePlatformConnections(): { connections: PlatformConnection[]; loading: boolean } {
  const shopify = useShopifySettings();
  const cafe24 = useIntegration(ECOMMERCE_PROVIDERS[0]);
  const woocommerce = useIntegration(ECOMMERCE_PROVIDERS[1]);
  const odoo = useIntegration(ECOMMERCE_PROVIDERS[2]);
  const haravan = useIntegration(ECOMMERCE_PROVIDERS[3]);
  const self = useIntegration(SELF_PLATFORM_PROVIDER);

  const generic: Record<string, typeof cafe24> = {
    [ECOMMERCE_PROVIDERS[0]]: cafe24,
    [ECOMMERCE_PROVIDERS[1]]: woocommerce,
    [ECOMMERCE_PROVIDERS[2]]: odoo,
    [ECOMMERCE_PROVIDERS[3]]: haravan,
    [SELF_PLATFORM_PROVIDER]: self,
  };

  const connections = PLATFORM_CHOICES.map((provider): PlatformConnection => {
    if (provider === 'shopify') {
      const d = shopify.data;
      return {
        provider,
        configured: Boolean(d?.credential.configured),
        status: d?.integration?.status ?? null,
        lastCheckedAt: d?.integration?.lastSyncAt ?? null,
        detail: d?.integration?.detail ?? null,
        // `shop_domain` doubles as the tenant's store domain for ANY platform;
        // only a real *.myshopify.com host identifies a Shopify store.
        identity: isShopifyDomain(d?.shopDomain) ? (d?.shopDomain ?? null) : null,
      };
    }
    return fromIntegration(provider, generic[provider].data);
  });

  const loading =
    shopify.isLoading || Object.values(generic).some((q) => q.isLoading);
  return { connections, loading };
}
