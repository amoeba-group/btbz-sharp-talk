import { Tenant } from './entity/tenant.entity';
import { WidgetDesignRow } from './entity/widget-design.entity';
import { IntegrationCredential } from './entity/integration-credential.entity';
import { IntegrationStatusEntity } from '../integration/entity/integration-status.entity';
import {
  EXTERNAL_CHANNELS,
  LANGUAGES,
  isWithinWindow,
  privacyProfileCopy,
  resolvePrivacyProfile,
  normalizeWidgetTheme,
  NOTIFICATION_CATEGORY,
  WIDGET_LOGIN_MODE,
  WIDGET_TAB_POSITION,
  WIDGET_TABS_DEFAULT,
  normalizeWidgetTabs,
  DEFAULT_BRAND,
} from '@sharptalk/types';
import {
  CredentialResponse,
  PrivacyNoticeResponse,
  PublicTenantResponse,
  ShopifySettingsResponse,
  TenantResponse,
  StorefrontResponse,
  KnowledgeSettingsResponse,
  NotificationChannelsResponse,
  WidgetThemeResponse,
  WidgetSettingsResponse,
} from './dto/response/tenant.response';
import { defaultOrigins } from '../embed/embed-origin.util';

/** Entity -> response mapping. Keeps secrets out of API payloads. */
/** The built-in brand colour — what an unthemed widget renders (index.css). */
// DEFAULT_BRAND now lives with the theme contract in @sharptalk/types, so the console
// preview, the API and the widget cannot disagree about the unthemed palette.

export class TenantMapper {
  static toTenant(t: Tenant, userCount?: number, assetBytes?: number): TenantResponse {
    return {
      id: t.id,
      uuid: t.uuid,
      shopDomain: t.shopDomain,
      slug: t.slug,
      name: t.name,
      status: t.status,
      plan: t.plan,
      workflowMode: t.workflowMode,
      customCssEnabled: Number(t.customCssEnabled) === 1,
      ...(userCount !== undefined ? { userCount } : {}),
      ...(assetBytes !== undefined ? { assetBytes } : {}),
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    };
  }

  static toTenantList(tenants: Tenant[], counts?: Map<number, number>, usage?: Map<number, number>): TenantResponse[] {
    return tenants.map((t) =>
      this.toTenant(
        t,
        counts?.get(Number(t.id)) ?? (counts ? 0 : undefined),
        usage ? usage.get(Number(t.id)) ?? 0 : undefined,
      ),
    );
  }

  /** Unauthenticated login-page view — never add fields beyond display-safe ones. */
  static toPublicTenant(t: Tenant): PublicTenantResponse {
    return { slug: t.slug, name: t.name, status: t.status };
  }

  /** Tenant privacy-notice settings (stored values; null = platform default). */
  static toPrivacyNotice(t: Tenant): PrivacyNoticeResponse {
    const effectiveProfile = resolvePrivacyProfile(
      t.privacyProfile,
      Number(t.commerceEnabled ?? 1) !== 0,
    );
    // The profile's own text travels with the settings so the console can show
    // it as the placeholder in every language — an operator must be able to see
    // what they are overriding before they decide to override it.
    const profileCopy = Object.fromEntries(
      LANGUAGES.map((l) => [l.session, privacyProfileCopy(effectiveProfile, l.session)]),
    );
    return {
      privacyPolicyUrl: t.privacyPolicyUrl,
      consentNoticeVersion: t.consentNoticeVersion,
      privacyProfile: t.privacyProfile ?? null,
      effectiveProfile,
      privacyNoticeCopy: (t.privacyNoticeCopy ?? null) as Record<string, Record<string, string>> | null,
      profileCopy: profileCopy as Record<string, Record<string, string>>,
    };
  }

  /** Widget behavior settings; anything but an explicit 'popup' reads as redirect. */
  static toStorefront(t: Tenant): StorefrontResponse {
    return { storefrontUrl: t.storefrontUrl };
  }

  static toWidgetDesign(d: WidgetDesignRow, activeId: number | null) {
    return {
      id: String(d.id),
      name: d.name,
      design: d.designJson,
      status: d.status,
      note: d.note ?? null,
      active: activeId != null && Number(activeId) === Number(d.id),
      appliedAt: d.appliedAt ?? null,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }

  static toKnowledgeSettings(t: Tenant): KnowledgeSettingsResponse {
    return { usageGuidesEnabled: Number(t.usageGuidesEnabled) === 1 };
  }

  static toWidgetSettings(t: Tenant): WidgetSettingsResponse {
    return {
      loginMode:
        t.widgetLoginMode === WIDGET_LOGIN_MODE.POPUP
          ? WIDGET_LOGIN_MODE.POPUP
          : WIDGET_LOGIN_MODE.REDIRECT,
      // Resolve the default here so the console never has to know what it is.
      tabs: normalizeWidgetTabs(t.widgetTabs) ?? [...WIDGET_TABS_DEFAULT],
      tabPosition:
        t.widgetTabPosition === WIDGET_TAB_POSITION.BOTTOM
          ? WIDGET_TAB_POSITION.BOTTOM
          : WIDGET_TAB_POSITION.TOP,
      commerceEnabled: Number(t.commerceEnabled ?? 1) !== 0,
      timezone: t.timezone ?? null,
      defaultLanguage: t.defaultLanguage ?? null,
      displayName: t.widgetCopy?.displayName ?? null,
      firstVisit: t.widgetCopy?.firstVisit ?? {},
      loginGreeting: t.widgetCopy?.loginGreeting ?? {},
      displayNameFallback: t.name ?? null,
    };
  }

  /** Delivery policy + the axes the console renders. */
  static toNotificationChannels(t: Tenant): NotificationChannelsResponse {
    return {
      channels: t.notificationChannels ?? {},
      categories: Object.values(NOTIFICATION_CATEGORY).filter((c) => c !== 'all'),
      channelKeys: [...EXTERNAL_CHANNELS],
    };
  }

  /**
   * The restriction as the console edits it. The invite key itself is NOT sent
   * back here — only whether one exists; the key travels once, in the response
   * to the rotate call, like the embed secret.
   */
  static toWidgetAccess(tenant: Tenant) {
    const access = tenant.widgetAccess ?? null;
    return {
      enabled: access?.enabled ?? false,
      startsAt: access?.startsAt ?? null,
      endsAt: access?.endsAt ?? null,
      ips: access?.ips ?? [],
      urls: access?.urls ?? [],
      keyConfigured: !!tenant.widgetAccessKey,
      /** Whether the window is open right now — drives the console badge. */
      activeNow: access?.enabled ? isWithinWindow(access, new Date()) : false,
      shopDomain: tenant.shopDomain ?? null,
    };
  }

  static toWidgetTheme(t: Tenant): WidgetThemeResponse {
    return {
      theme: normalizeWidgetTheme(t.widgetTheme),
      defaultBrand: DEFAULT_BRAND,
      // Whether the design editor may offer custom CSS (platform add-on, P5).
      customCssEnabled: Number(t.customCssEnabled) === 1,
      // The console builds the public logo URL from this; it is the same key the
      // widget sends, so both fetch the identical asset.
      shopDomain: t.shopDomain ?? null,
    };
  }

  /**
   * Embed settings for the console (PLN-260819). `origins` is what is STORED —
   * null when never configured — and `effectiveOrigins` is what the gate will
   * actually compare against, so the screen can say which one is in force
   * instead of showing an empty box that silently means "storefront only".
   */
  static toEmbedSettings(t: Tenant): {
    origins: string[] | null;
    effectiveOrigins: string[];
    secretConfigured: boolean;
    shopDomain: string | null;
  } {
    return {
      origins: t.embedOrigins ?? null,
      effectiveOrigins: t.embedOrigins?.length ? t.embedOrigins : defaultOrigins(t),
      secretConfigured: !!t.embedSecret,
      shopDomain: t.shopDomain ?? null,
    };
  }

  static toCredential(c: IntegrationCredential): CredentialResponse {
    return {
      provider: c.provider,
      status: c.status,
      configured: c.secretEnc != null,
      updatedAt: c.updatedAt ?? null,
      lastTestedAt: c.lastTestedAt ?? null,
      detail: c.detail ?? null,
    };
  }

  static toCredentialList(creds: IntegrationCredential[]): CredentialResponse[] {
    return creds.map((c) => this.toCredential(c));
  }

  static toShopifySettings(
    tenant: Tenant,
    cred: IntegrationCredential | null,
    status: IntegrationStatusEntity | null,
  ): ShopifySettingsResponse {
    return {
      shopDomain: tenant.shopDomain,
      name: tenant.name,
      status: tenant.status,
      credential: {
        configured: cred?.secretEnc != null,
        updatedAt: cred?.updatedAt ?? null,
      },
      integration: {
        status: status?.status ?? null,
        lastSyncAt: status?.lastSyncAt ?? null,
        detail: status?.detail ?? null,
      },
    };
  }
}
