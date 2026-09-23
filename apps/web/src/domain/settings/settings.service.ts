import { apiDelete, apiGet, apiGetBlob, apiPatch, apiPost, apiPut, apiUpload } from '@/lib/api-client';
import type {
  WidgetHeaderStyle,
  WidgetLauncher,
  WidgetLoginMode,
  WidgetTab,
  WidgetTabPosition,
  WidgetTheme,
  WidgetDesign,
} from '@sharptalk/types';

export interface CredentialStatus {
  provider: string;
  configured: boolean;
  lastUpdatedAt?: string;
  maskedKey?: string;
}

export interface UpdateCredentialBody {
  apiKey?: string;
  secret?: string;
  [k: string]: unknown;
}

export interface ShopifySettings {
  shopDomain: string;
  name: string | null;
  status: string;
  credential: { configured: boolean; updatedAt: string | null };
  integration: { status: string | null; lastSyncAt: string | null; detail: string | null };
}

export interface SaveShopifyBody {
  shop_domain: string;
  name?: string;
  access_token?: string;
  api_key?: string;
  api_secret?: string;
}

export interface ShopifyTestResult {
  ok: boolean;
  detail: string;
}

export interface ShopifySyncResult {
  ok: boolean;
  synced: number;
  detail: string;
}

export interface ShopifyWebhookRegisterResult {
  ok: boolean;
  registered: number;
  existing: number;
  failed: number;
  detail: string;
}

/** Generic e-commerce integration settings (cafe24 / woocommerce / odoo / haravan). */
export interface IntegrationSettings {
  provider: string;
  fields: Record<string, string | null>;
  secrets: Record<string, boolean>;
  credential: { configured: boolean; updatedAt: string | null };
  integration: { status: string | null; lastSyncAt: string | null; detail: string | null };
}

export interface IntegrationTestResult {
  ok: boolean;
  detail: string;
}

/** Widget behavior settings (sign-in mode) — tenant-scoped. */
/** Customer-facing shop origin; null means product links stay off. */
/** Knowledge-page options (PLN-260910): the usage-guides section switch. */
export interface KnowledgeSettings {
  usageGuidesEnabled: boolean;
}

/** Tenant asset store (PLN-260910 P1). */
export interface TenantAsset {
  id: string;
  uuid: string;
  area: string;
  kind: 'font' | 'icon' | 'image' | 'doc' | string;
  filename: string;
  label: string | null;
  mime: string;
  ext: string;
  size: number;
  width: number | null;
  height: number | null;
  version: number;
  public: boolean;
  url: string;
  createdAt: string;
}

export interface TenantAssetList {
  items: TenantAsset[];
  usage: { area: string; used: number; quota: number };
}

export interface Storefront {
  storefrontUrl: string | null;
}

export interface WidgetSettings {
  loginMode: WidgetLoginMode;
  /** Effective tab set — already resolved to the built-in default when unset. */
  tabs: WidgetTab[];
  tabPosition: WidgetTabPosition;
  timezone: string | null;
  /** Explicit default widget language (code) or null = follow the timezone. */
  defaultLanguage: string | null;
  displayName: string | null;
  firstVisit: Record<string, string>;
  loginGreeting: Record<string, string>;
  displayNameFallback: string | null;
}

/** Console-side draft of the widget copy fields (PLN-260808-Widget-Greetings). */
export interface WidgetCopyDraft {
  displayName: string;
  firstVisit: Record<string, string>;
  loginGreeting: Record<string, string>;
}

/** Tenant delivery policy — a ceiling on what the shop sends, per category. */
export interface NotificationChannels {
  channels: Record<string, string[]>;
  categories: string[];
  channelKeys: string[];
}

/** Widget brand theme. One colour; the ramp is derived, never stored. */
/** Console-side draft of the design profile (PLN-260910 P2); snake-cased on the wire. */
export interface WidgetDesignDraft {
  fontPreset: string;
  fontAssetUuid?: string | null;
  baseSize: number;
  radius: string;
  panelWidth: number;
  panelHeight: number;
  launcherIconUuid?: string | null;
  /** 'chip' | 'card' — opening scenario menu style (PLN-260916 P4). */
  quickReplyStyle?: 'chip' | 'card';
  /** Review chip link template, e.g. `{productUrl}#reviews` (PLN-260923 P3). Empty = product page. */
  reviewLinkTemplate?: string | null;
  /** Raw custom CSS as typed; the API sanitizes and may drop parts (P5). */
  customCss?: string | null;
}

/** Custom widget library (PLN-260910 P3). */
export interface WidgetDesignItem {
  id: string;
  name: string;
  design: WidgetDesign;
  status: 'ready' | 'archived' | string;
  note: string | null;
  active: boolean;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WidgetDesignRevision {
  id: string;
  revisionNo: number;
  name: string;
  note: string | null;
  design: WidgetDesign;
  actorUserId: string | null;
  createdAt: string;
}

export interface WidgetDesignList {
  activeId: string | null;
  items: WidgetDesignItem[];
}

/** Draft → the snake-cased `design` payload both the theme PATCH and the library accept. */
export function designToWire(design: WidgetDesignDraft) {
  return {
    font: { preset: design.fontPreset, asset_uuid: design.fontAssetUuid ?? null, base_size: design.baseSize },
    radius: design.radius,
    panel: { width: design.panelWidth, height: design.panelHeight },
    launcher_icon_uuid: design.launcherIconUuid ?? null,
    quick_reply_style: design.quickReplyStyle ?? 'chip',
    review_link_template: design.reviewLinkTemplate?.trim() || null,
    custom_css: design.customCss ?? null,
  };
}

export interface SnapshotDiff {
  createdAt: string;
  fields: Array<{ field: string; current: unknown; snapshot: unknown; changed: boolean }>;
  designs: Array<{ name: string; action: 'create' | 'update'; active: boolean }>;
}

export interface WidgetThemeSettings {
  /** The stored theme, or null when the tenant has never set one. */
  theme: WidgetTheme | null;
  defaultBrand: string;
  /** Needed to build the public logo URL; same key the widget uses. */
  shopDomain: string | null;
  /** Platform add-on: may the design editor offer custom CSS (P5). */
  customCssEnabled?: boolean;
}

/** Embed allowlist + whether a signing secret exists (PLN-260819). */
export interface EmbedSettings {
  /** What is stored; null when never configured. */
  origins: string[] | null;
  /** What the gate actually compares against — the storefront, when unset. */
  effectiveOrigins: string[];
  secretConfigured: boolean;
  shopDomain: string | null;
}

export const settingsService = {
  credentials: () => apiGet<CredentialStatus[]>('/tenants/me/credentials'),
  embedSettings: () => apiGet<EmbedSettings>('/tenants/embed-settings'),
  saveEmbedOrigins: (origins: string[]) =>
    apiPatch<EmbedSettings>('/tenants/embed-origins', { origins }),
  rotateEmbedSecret: () => apiPost<{ secret: string }>('/tenants/embed-secret/rotate', {}),
  widgetSettings: () => apiGet<WidgetSettings>('/tenants/widget-settings'),
  storefront: () => apiGet<Storefront>('/tenants/storefront'),
  notificationChannels: () => apiGet<NotificationChannels>('/tenants/notification-channels'),
  widgetTheme: () => apiGet<WidgetThemeSettings>('/tenants/widget-theme'),
  saveWidgetTheme: (
    brand: string,
    headerStyle: WidgetHeaderStyle,
    launcher?: WidgetLauncher,
    design?: WidgetDesignDraft | null,
  ) =>
    apiPatch<WidgetThemeSettings>('/tenants/widget-theme', {
      brand,
      header_style: headerStyle,
      ...(launcher ? { launcher } : {}),
      // undefined = keep what is stored; null = clear; object = replace (P2).
      ...(design !== undefined
        ? {
            design: design
              ? {
                  font: { preset: design.fontPreset, asset_uuid: design.fontAssetUuid ?? null, base_size: design.baseSize },
                  radius: design.radius,
                  panel: { width: design.panelWidth, height: design.panelHeight },
                  launcher_icon_uuid: design.launcherIconUuid ?? null,
                }
              : null,
          }
        : {}),
    }),
  // The logo has its own routes: it is a file, and folding it into the theme
  // PATCH would make every colour change a multipart upload.
  uploadWidgetLogo: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiUpload<WidgetThemeSettings>('/tenants/widget-theme/logo', form);
  },
  deleteWidgetLogo: () => apiDelete<WidgetThemeSettings>('/tenants/widget-theme/logo'),
  saveNotificationChannels: (channels: Record<string, string[]>) =>
    apiPatch<NotificationChannels>('/tenants/notification-channels', { channels }),
  updateStorefront: (storefrontUrl: string) =>
    apiPatch<Storefront>('/tenants/storefront', { storefront_url: storefrontUrl }),
  assets: (area = 'design', kind?: string) =>
    apiGet<TenantAssetList>('/tenant-assets', { area, ...(kind ? { kind } : {}) }),
  uploadAsset: (file: File, kind: string, label?: string) => {
    const form = new FormData();
    form.append('file', file);
    form.append('area', 'design');
    form.append('kind', kind);
    if (label) form.append('label', label);
    return apiUpload<TenantAsset>('/tenant-assets', form);
  },
  deleteAsset: (uuid: string) => apiDelete<{ deleted: true }>(`/tenant-assets/${uuid}`),
  sanitizeCustomCss: (css: string) => apiPost<{ css: string; dropped: string[] }>('/tenants/widget-theme/sanitize-css', { css }),
  widgetDesigns: () => apiGet<WidgetDesignList>('/widget-designs'),
  createWidgetDesign: (name: string, design: WidgetDesignDraft, note?: string) =>
    apiPost<WidgetDesignItem>('/widget-designs', { name, note: note ?? null, design: designToWire(design) }),
  updateWidgetDesign: (id: string, body: { name?: string; note?: string | null; design?: WidgetDesignDraft }) =>
    apiPatch<WidgetDesignItem>(`/widget-designs/${id}`, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.design ? { design: designToWire(body.design) } : {}),
    }),
  applyWidgetDesign: (id: string) => apiPost<WidgetDesignItem>(`/widget-designs/${id}/apply`, {}),
  revertWidgetDesign: () => apiPost<{ activeId: null }>('/widget-designs/revert', {}),
  duplicateWidgetDesign: (id: string) => apiPost<WidgetDesignItem>(`/widget-designs/${id}/duplicate`, {}),
  archiveWidgetDesign: (id: string) => apiPost<WidgetDesignItem>(`/widget-designs/${id}/archive`, {}),
  restoreWidgetDesign: (id: string) => apiPost<WidgetDesignItem>(`/widget-designs/${id}/restore`, {}),
  deleteWidgetDesign: (id: string) => apiDelete<{ deleted: true }>(`/widget-designs/${id}`),
  widgetDesignRevisions: (id: string) => apiGet<WidgetDesignRevision[]>(`/widget-designs/${id}/revisions`),
  restoreWidgetDesignRevision: (id: string, revisionId: string) =>
    apiPost<WidgetDesignItem>(`/widget-designs/${id}/revisions/${revisionId}/restore`, {}),
  widgetDesignPreviewToken: (id: string) =>
    apiPost<{ token: string; expiresAt: number }>(`/widget-designs/${id}/preview-token`, {}),
  exportWidgetDesign: (id: string) => apiGetBlob(`/widget-designs/${id}/export`),
  importWidgetDesign: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiUpload<WidgetDesignItem>('/widget-designs/import', form);
  },
  // ---- Settings snapshots (PLN-260910 P4 D-8) ----
  settingsSnapshots: () => apiGet<TenantAsset[]>('/settings-snapshots'),
  createSettingsSnapshot: (label?: string) => apiPost<TenantAsset>('/settings-snapshots', { label }),
  settingsSnapshotDiff: (uuid: string) => apiGet<SnapshotDiff>(`/settings-snapshots/${uuid}/diff`),
  restoreSettingsSnapshot: (uuid: string) => apiPost<{ restored: true }>(`/settings-snapshots/${uuid}/restore`, {}),
  deleteSettingsSnapshot: (uuid: string) => apiDelete<{ deleted: true }>(`/settings-snapshots/${uuid}`),
  knowledgeSettings: () => apiGet<KnowledgeSettings>('/tenants/knowledge-settings'),
  updateKnowledgeSettings: (usageGuidesEnabled: boolean) =>
    apiPatch<KnowledgeSettings>('/tenants/knowledge-settings', {
      usage_guides_enabled: usageGuidesEnabled,
    }),
  saveWidgetSettings: (
    loginMode: WidgetLoginMode,
    timezone?: string | null,
    copy?: WidgetCopyDraft,
    tabs?: WidgetTab[],
    tabPosition?: WidgetTabPosition,
    defaultLanguage?: string | null,
  ) =>
    apiPatch<WidgetSettings>('/tenants/widget-settings', {
      login_mode: loginMode,
      ...(defaultLanguage !== undefined ? { default_language: defaultLanguage } : {}),
      ...(tabs !== undefined ? { tabs } : {}),
      ...(tabPosition !== undefined ? { tab_position: tabPosition } : {}),
      ...(timezone !== undefined ? { timezone } : {}),
      ...(copy
        ? {
            display_name: copy.displayName,
            first_visit_en: copy.firstVisit.EN ?? '',
            first_visit_es: copy.firstVisit.ES ?? '',
            first_visit_ko: copy.firstVisit.KO ?? '',
            login_greeting_en: copy.loginGreeting.EN ?? '',
            login_greeting_es: copy.loginGreeting.ES ?? '',
            login_greeting_ko: copy.loginGreeting.KO ?? '',
          }
        : {}),
    }),
  updateCredential: (provider: string, body: UpdateCredentialBody) =>
    apiPut<CredentialStatus>(`/tenants/me/credentials/${provider}`, body),
  shopify: () => apiGet<ShopifySettings>('/tenants/me/shopify'),
  saveShopify: (body: SaveShopifyBody) => apiPut<ShopifySettings>('/tenants/me/shopify', body),
  testShopify: () => apiPost<ShopifyTestResult>('/tenants/me/shopify/test'),
  syncShopify: () => apiPost<ShopifySyncResult>('/tenants/me/shopify/sync'),
  registerShopifyWebhooks: () =>
    apiPost<ShopifyWebhookRegisterResult>('/tenants/me/shopify/register-webhooks'),
  integration: (provider: string) =>
    apiGet<IntegrationSettings>(`/tenants/me/integrations/${provider}`),
  saveIntegration: (provider: string, config: Record<string, string>) =>
    apiPut<IntegrationSettings>(`/tenants/me/integrations/${provider}`, { config }),
  testIntegration: (provider: string) =>
    apiPost<IntegrationTestResult>(`/tenants/me/integrations/${provider}/test`),
  // Odoo catalogue → products_cache (REQ-260826, products-only). Same result
  // shape as the Cafe24 product sync.
  // Generic e-commerce catalogue / order pull for providers that support it
  // (odoo/woocommerce/haravan). Same result shapes as the Cafe24 syncs (REQ-260826).
  syncEcommerceProducts: (provider: string) =>
    apiPost<Cafe24ProductSyncResult>(`/tenants/me/${provider}/products/sync`),
  syncEcommerceOrders: (provider: string) =>
    apiPost<Cafe24SyncResult>(`/tenants/me/${provider}/sync`),
  // Cafe24 OAuth (PLN-260807 P-A1): begin the flow (returns the authorize URL the
  // browser navigates to) and run an on-demand order sync.
  aiEngines: () => apiGet<TenantAiEngineList>('/tenants/me/ai-engines'),
  aiUsage: (from: string, to: string, groupBy: UsageGroupBy) =>
    apiGet<UsageSummary>('/tenants/me/ai-engines/usage', { from, to, group_by: groupBy }),
  createAiEngine: (body: SaveTenantEngineBody) =>
    apiPost<TenantAiEngine>('/tenants/me/ai-engines', body),
  updateAiEngine: (id: string, body: Partial<SaveTenantEngineBody>) =>
    apiPatch<TenantAiEngine>(`/tenants/me/ai-engines/${id}`, body),
  setAiEngineDefault: (id: string) =>
    apiPut<TenantAiEngine>(`/tenants/me/ai-engines/${id}/default`, {}),
  testAiEngine: (id: string) =>
    apiPost<EngineTestResult>(`/tenants/me/ai-engines/${id}/test`, {}),
  deleteAiEngine: (id: string) =>
    apiDelete<{ removed: boolean; usedBy: string[] }>(`/tenants/me/ai-engines/${id}`),
  connectCafe24: (mallId: string) =>
    apiPost<{ authorizeUrl: string }>('/tenants/me/cafe24/connect', { mall_id: mallId }),
  syncCafe24: () => apiPost<Cafe24SyncResult>('/tenants/me/cafe24/sync'),
  // Catalogue pull (PLN-260808-Cafe24-Product-Knowledge). Fills products_cache;
  // turning those rows into knowledge stays a separate, previewed step.
  syncCafe24Products: () =>
    apiPost<Cafe24ProductSyncResult>('/tenants/me/cafe24/products/sync'),
};

export interface Cafe24SyncResult {
  ok: boolean;
  synced: number;
  detail: string;
}

export interface Cafe24ProductSyncResult extends Cafe24SyncResult {
  archived: number;
}

/** One of the tenant's AI engines, or a read-only platform one (PLN-260824). */
export interface TenantAiEngine {
  id: string;
  name: string;
  provider: string;
  model: string;
  endpoint: string | null;
  status: string;
  isDefault: boolean;
  /** Whether a key is stored — the key itself never leaves the server. */
  hasApiKey: boolean;
  platform: boolean;
}

export interface TenantAiEngineList {
  providers: string[];
  own: TenantAiEngine[];
  platform: TenantAiEngine[];
}

/** Why a connection test failed; the fixes differ per reason. */
export interface EngineTestResult {
  ok: boolean;
  reason: 'ok' | 'auth' | 'model' | 'rate_limit' | 'unreachable';
  detail: string | null;
  elapsedMs: number;
}

export interface SaveTenantEngineBody {
  name: string;
  provider: string;
  model: string;
  endpoint?: string;
  /** Omit to keep the stored key. */
  api_key?: string;
}

/** One row of the usage table (PLN-260824 A). */
export interface UsageBucket {
  key: string;
  label: string;
  owner: string | null;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  stubCalls: number;
  failures: number;
}

export interface UsageSummary {
  /** First day with recorded usage; null when nothing has been metered yet. */
  since: string | null;
  buckets: UsageBucket[];
  totals: { calls: number; tokensIn: number; tokensOut: number; stubCalls: number; failures: number };
}

export type UsageGroupBy = 'feature' | 'function' | 'engine' | 'owner';
