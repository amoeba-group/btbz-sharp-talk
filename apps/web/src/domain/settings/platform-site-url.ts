import type { PlatformConnection } from './platform-connections.hooks';
import { isShopifyDomain } from './integration-providers';

/**
 * Where "open site" on a connected-platform card goes (PLN-261019-Cafe24 D5):
 * the platform's admin console, built from the non-secret fields the tenant
 * stored. Returns null when the value it needs is missing — the button is then
 * hidden rather than pointing somewhere guessed. Pure, so it is unit-testable.
 */
export function platformSiteUrl(
  connection: Pick<PlatformConnection, 'provider' | 'fields'>,
  storefrontUrl: string | null,
): string | null {
  const f = connection.fields;
  const val = (k: string) => (f[k] ?? '').trim();
  switch (connection.provider) {
    case 'shopify': {
      // admin.shopify.com/store/{handle} — only a real *.myshopify.com host has a handle.
      const domain = val('shop_domain');
      if (!isShopifyDomain(domain)) return null;
      const handle = domain.replace(/^https?:\/\//i, '').replace(/\.myshopify\.com\/?$/i, '');
      return handle ? `https://admin.shopify.com/store/${encodeURIComponent(handle)}` : null;
    }
    case 'cafe24': {
      // Cafe24's admin login takes the mall id as a query param and pre-fills it.
      const mall = val('mall_id').replace(/\.cafe24(api)?\.com.*$/i, '');
      return mall ? `https://eclogin.cafe24.com/Shop/?mall_id=${encodeURIComponent(mall)}` : null;
    }
    case 'woocommerce': {
      const base = httpsBase(val('store_url'));
      return base ? `${base}/wp-admin/` : null;
    }
    case 'odoo': {
      const base = httpsBase(val('url'));
      return base ? `${base}/web` : null;
    }
    case 'haravan': {
      const host = val('shop_domain').replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
      return host ? `https://${host}/admin` : null;
    }
    case 'klaviyo':
      return 'https://www.klaviyo.com/dashboard';
    case 'yotpo':
      return 'https://my.yotpo.com/';
    case 'gorgias': {
      const sub = val('subdomain').replace(/^https?:\/\//i, '').replace(/\.gorgias\.com.*$/i, '').replace(/\/.*$/, '');
      return sub ? `https://${encodeURIComponent(sub)}.gorgias.com/app` : null;
    }
    case 'self':
      return httpsBase(storefrontUrl ?? '');
    default:
      return null;
  }
}

/** `https://host[/path]` without a trailing slash; a bare host gets https://. Empty → null. */
function httpsBase(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return withScheme.replace(/\/+$/, '');
  } catch {
    return null;
  }
}
