import { useQueries } from '@tanstack/react-query';
import { useShopifySettings } from './settings.hooks';
import { useTenantKey } from '@/lib/use-tenant-key';
import { settingsService, type Cafe24CredentialMode, type IntegrationSettings } from './settings.service';
import { isShopifyDomain, type PlatformChoice } from './integration-providers';

/** One platform as a settings tab sees it — connected or merely offered (PLN-261019 D3). */
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
  /** Non-secret fields as stored (store URL, subdomain…) — what the site link is built from. */
  fields: Record<string, string | null>;
  /** Cafe24 only: 'oauth' (connected through the Cafe24 modal) or 'manual' (typed token). */
  mode: Cafe24CredentialMode | null;
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
    fields: data?.fields ?? {},
    mode: data?.mode ?? null,
  };
}

/**
 * The given platforms, in the given order, with this tenant's state. Shopify
 * keeps its own endpoint; every other provider shares the generic one. The
 * query keys match `useIntegration` / `useShopifySettings`, so a save or test
 * in a dialog refreshes the cards through the same cache.
 */
export function usePlatformConnections(choices: readonly PlatformChoice[]): {
  connections: PlatformConnection[];
  loading: boolean;
} {
  const tenantKey = useTenantKey();
  const wantsShopify = choices.includes('shopify');
  const shopify = useShopifySettings(wantsShopify);
  const generic = choices.filter((p): p is Exclude<PlatformChoice, 'shopify'> => p !== 'shopify');
  const results = useQueries({
    queries: generic.map((provider) => ({
      queryKey: ['integration', provider, tenantKey],
      queryFn: () => settingsService.integration(provider),
    })),
  });
  const byProvider = new Map(generic.map((p, i) => [p, results[i]]));

  const connections = choices.map((provider): PlatformConnection => {
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
        fields: { shop_domain: d?.shopDomain ?? null },
        mode: null,
      };
    }
    return fromIntegration(provider, byProvider.get(provider)?.data);
  });

  const loading = (wantsShopify && shopify.isLoading) || results.some((q) => q.isLoading);
  return { connections, loading };
}
