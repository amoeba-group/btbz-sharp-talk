import { WidgetLoginMode, WidgetTab, WidgetTabPosition, WidgetTheme } from '@sharptalk/types';

/** Response DTOs — camelCase. `uuid` is the external tenant identifier. */
export interface TenantResponse {
  customCssEnabled?: boolean;
  id: number;
  uuid: string;
  shopDomain: string;
  slug: string;
  name: string | null;
  status: string;
  plan: string | null;
  /** Issue-workflow add-on entitlement: base/bridge/native (REQ-260825). */
  workflowMode: string;
  userCount?: number;
  /** Bytes in the tenant asset store (design + settings) — admin list (PLN-260910 D-11). */
  assetBytes?: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Display-safe subset served to the unauthenticated per-tenant login page. */
export interface PublicTenantResponse {
  slug: string;
  name: string | null;
  status: string;
}

/** Credential status only — secret material is NEVER exposed. */
export interface CredentialResponse {
  provider: string;
  status: string;
  configured: boolean;
  updatedAt: Date | null;
  lastTestedAt: Date | null;
  detail: string | null;
}

/** Shopify connection settings view — secrets are never exposed (only flags). */
export interface ShopifySettingsResponse {
  shopDomain: string;
  name: string | null;
  status: string;
  credential: {
    configured: boolean;
    updatedAt: Date | null;
  };
  integration: {
    status: string | null;
    lastSyncAt: Date | null;
    detail: string | null;
  };
}

/** Result of a Shopify Admin API connectivity test. */
export interface ShopifyTestResponse {
  ok: boolean;
  detail: string;
}

/**
 * Tenant privacy-notice settings (PLN-Privacy-Control-Gap Stage 2). Stored
 * values as configured — null means "unset, platform default applies".
 */
export interface PrivacyNoticeResponse {
  privacyPolicyUrl: string | null;
  consentNoticeVersion: string | null;
  /** Stored choice; null = inferred from commerceEnabled (PLN-261001). */
  privacyProfile: string | null;
  /** The profile actually in force right now — what the console previews. */
  effectiveProfile: string;
  /** Per-language line rewrites, exactly as stored. */
  privacyNoticeCopy: Record<string, Record<string, string>> | null;
  /** The profile's own wording, per language — the console shows it as the placeholder. */
  profileCopy: Record<string, Record<string, string>>;
}

/** Widget behavior settings (PLN-Widget-Login-Redirect-Orders). */
/** Customer-facing shop origin; null disables product links in the widget. */
export interface StorefrontResponse {
  storefrontUrl: string | null;
}

export interface KnowledgeSettingsResponse {
  usageGuidesEnabled: boolean;
}

export interface WidgetSettingsResponse {
  loginMode: WidgetLoginMode;
  /**
   * Effective tab set — the stored value, or the built-in default when the
   * tenant never configured one. Resolved server-side so the console renders
   * checkboxes from one source of truth instead of re-deriving the default.
   */
  tabs: WidgetTab[];
  tabPosition: WidgetTabPosition;
  /** Store features (order sign-in gate, commerce chips) — PLN-261001. */
  commerceEnabled: boolean;
  timezone: string | null;
  /** Explicit default widget language (code) or null = follow the timezone. */
  defaultLanguage: string | null;
  /** Stored (raw) widget copy — null/missing = widget default; console shows the tenant name as placeholder. */
  displayName: string | null;
  firstVisit: Record<string, string>;
  loginGreeting: Record<string, string>;
  /** Fallback used when displayName is unset (the tenant's name). */
  displayNameFallback: string | null;
}

/**
 * Generic e-commerce integration settings view. `fields` holds the non-secret
 * credential values (echoed back); `secrets` maps each secret field key to whether
 * it is currently stored (the value itself is never returned).
 */
export interface IntegrationSettingsResponse {
  provider: string;
  fields: Record<string, string | null>;
  secrets: Record<string, boolean>;
  credential: {
    configured: boolean;
    updatedAt: Date | null;
  };
  integration: {
    status: string | null;
    lastSyncAt: Date | null;
    detail: string | null;
  };
}

/** Result of a generic e-commerce integration connectivity test. */
export interface IntegrationTestResponse {
  ok: boolean;
  detail: string;
}

/** Tenant delivery policy for the console's Notification channels card. */
export interface NotificationChannelsResponse {
  /** Effective policy; `{}` when the tenant never configured one. */
  channels: Record<string, string[]>;
  /** Categories the console renders rows for. */
  categories: string[];
  /** External channels it renders columns for (in-app is always on). */
  channelKeys: string[];
}

/** Widget theme for the console card. `theme` is null when never configured. */
export interface WidgetThemeResponse {
  customCssEnabled?: boolean;
  theme: WidgetTheme | null;
  /** The palette shown when nothing is configured, so the console can preview it. */
  defaultBrand: string;
  shopDomain: string | null;
}
