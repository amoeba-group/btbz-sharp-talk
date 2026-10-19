/**
 * Web-side mirror of the e-commerce provider credential schema.
 *
 * The canonical source is `INTEGRATION_FIELDS` / `ECOMMERCE_PROVIDERS` /
 * `EcommerceProvider` / `IntegrationFieldSpec` in `packages/types`. The web app
 * does NOT depend on `@sharptalk/types` (it isn't in apps/web/package.json, so a clean
 * build never builds that package) and it builds to CommonJS which Vite can't read
 * runtime values from anyway — so both the types and the constants are re-declared
 * here to keep the web build self-contained.
 *
 * KEEP IN SYNC with packages/types/src/common/enum.types.ts.
 */
export type EcommerceProvider = 'cafe24' | 'woocommerce' | 'odoo' | 'haravan';
/** Marketing platforms + helpdesks on the same generic flow (PLN-260808). */
export type MarketingProvider = 'klaviyo' | 'yotpo';
export type HelpdeskProvider = 'gorgias';
/** The tenant's own platform (PLN-261019 D4): registered, never probed or synced. */
export type SelfPlatformProvider = 'self';
export type GenericIntegrationProvider =
  | EcommerceProvider
  | MarketingProvider
  | HelpdeskProvider
  | SelfPlatformProvider;

export interface IntegrationFieldSpec {
  key: string;
  secret: boolean;
  required: boolean;
}
export const ECOMMERCE_PROVIDERS: EcommerceProvider[] = [
  'cafe24',
  'woocommerce',
  'odoo',
  'haravan',
];
export const MARKETING_PROVIDERS: MarketingProvider[] = ['klaviyo', 'yotpo'];
export const HELPDESK_PROVIDERS: HelpdeskProvider[] = ['gorgias'];
export const SELF_PLATFORM_PROVIDER: SelfPlatformProvider = 'self';
/** Every platform the "Add a platform" row offers, in display order (PLN-261019 D3). */
export const PLATFORM_CHOICES = ['shopify', ...ECOMMERCE_PROVIDERS, SELF_PLATFORM_PROVIDER] as const;
export type PlatformChoice = (typeof PLATFORM_CHOICES)[number];

export const INTEGRATION_FIELDS: Record<GenericIntegrationProvider, IntegrationFieldSpec[]> = {
  cafe24: [
    { key: 'mall_id', secret: false, required: true },
    { key: 'client_id', secret: true, required: false },
    { key: 'client_secret', secret: true, required: false },
    { key: 'access_token', secret: true, required: true },
  ],
  woocommerce: [
    { key: 'store_url', secret: false, required: true },
    { key: 'consumer_key', secret: true, required: true },
    { key: 'consumer_secret', secret: true, required: true },
  ],
  odoo: [
    { key: 'url', secret: false, required: true },
    { key: 'db', secret: false, required: true },
    { key: 'username', secret: false, required: true },
    { key: 'api_key', secret: true, required: true },
  ],
  haravan: [
    { key: 'shop_domain', secret: false, required: true },
    { key: 'access_token', secret: true, required: true },
  ],
  klaviyo: [{ key: 'api_key', secret: true, required: true }],
  yotpo: [
    { key: 'app_key', secret: false, required: true },
    { key: 'secret_key', secret: true, required: true },
  ],
  gorgias: [
    { key: 'subdomain', secret: false, required: true },
    { key: 'email', secret: false, required: true },
    { key: 'api_key', secret: true, required: true },
    { key: 'webhook_secret', secret: true, required: false },
  ],
  self: [
    { key: 'platform_name', secret: false, required: true },
    { key: 'description', secret: false, required: false },
  ],
};

export function isShopifyDomain(domain?: string | null): boolean {
  return /\.myshopify\.com\/?$/i.test((domain ?? '').trim());
}
