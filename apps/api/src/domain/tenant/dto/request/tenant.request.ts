import {
  ArrayMaxSize,
  IsBoolean,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  TENANT_PLAN_VALUES,
  WORKFLOW_MODE_VALUES,
  WIDGET_LOGIN_MODE,
  WIDGET_TAB,
  WIDGET_TAB_POSITION,
  WidgetLoginMode,
  WidgetTab,
  WidgetTabPosition,
  LANGUAGE_CODES,
} from '@sharptalk/types';
import { TENANT_SLUG_PATTERN } from '../../../../global/constant/reserved-slug.constant';

/** Request DTOs — snake_case (amoeba_code_convention). */
export class ListTenantsQuery {
  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  size?: string;

  @IsOptional()
  @IsIn(['applied', 'active', 'suspended'])
  status?: string;
}

export class CreateTenantRequest {
  @IsString()
  @MinLength(1)
  shop_domain: string;

  // Login-page path (/<slug>); auto-derived from `name` when omitted.
  @IsOptional()
  @IsString()
  @Matches(TENANT_SLUG_PATTERN)
  slug?: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsString()
  @MinLength(1)
  plan: string;
}

export class UpdateTenantStatusRequest {
  @IsIn(['applied', 'active', 'suspended'])
  status: string;
}

/** Plan change by the platform admin (REQ-260825). Presets recompute instantly. */
export class UpdateTenantPlanRequest {
  @IsIn(TENANT_PLAN_VALUES as unknown as string[])
  plan: string;
}

/** Issue-workflow add-on entitlement (REQ-260825 — menu exposure is separate). */
export class UpdateTenantWorkflowModeRequest {
  @IsIn(WORKFLOW_MODE_VALUES as unknown as string[])
  workflow_mode: string;
}

export class UpsertCredentialRequest {
  @IsString()
  @MinLength(1)
  secret: string;
}

/**
 * Shopify connection settings for the current tenant. `shop_domain` is the shop
 * address; credential fields (optional) are packed into the encrypted `shopify`
 * credential. Sending no credential fields leaves the stored credential untouched.
 */
export class UpdateShopifySettingsRequest {
  @IsString()
  @MinLength(3)
  shop_domain: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  access_token?: string;

  @IsOptional()
  @IsString()
  api_key?: string;

  @IsOptional()
  @IsString()
  api_secret?: string;
}

/**
 * Generic e-commerce integration settings (cafe24 / woocommerce / odoo / haravan).
 * `config` is a provider-specific bag of credential fields (snake_case keys per the
 * shared INTEGRATION_FIELDS schema). Secret fields left empty keep the stored value.
 */
export class UpdateIntegrationRequest {
  @IsObject()
  config: Record<string, string>;
}

/**
 * Tenant privacy-notice settings (PLN-Privacy-Control-Gap Stage 2). Both fields
 * are optional (PATCH semantics); sending null clears the value back to the
 * platform default. Bumping `consent_notice_version` forces widget re-consent.
 */
export class UpdatePrivacyNoticeRequest {
  // Must be an absolute http(s) URL when set; null clears it.
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(512)
  privacy_policy_url?: string | null;

  // Safe charset only (letters/digits . _ -); null falls back to the platform version.
  @IsOptional()
  @IsString()
  @Length(1, 32)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  consent_notice_version?: string | null;
}

/**
 * Widget behavior settings (PLN-Widget-Login-Redirect-Orders): how the widget's
 * "Sign in" opens the storefront login — whole-tab redirect (default) or popup.
 */
export class UpdateStorefrontRequest {
  /** Customer-facing shop origin. Empty clears it (and disables product links). */
  @IsOptional() @IsString() storefront_url?: string | null;
}

/** Knowledge-page options (PLN-260910): the usage-guides section switch. */
export class UpdateKnowledgeSettingsRequest {
  @IsBoolean() usage_guides_enabled: boolean;
}

export class UpdateWidgetSettingsRequest {
  @IsIn(Object.values(WIDGET_LOGIN_MODE))
  login_mode: WidgetLoginMode;

  // Which tabs the widget shows (PLN-260817-Widget-Tab-Config). Optional so a
  // copy-only or login-mode-only save leaves the tab configuration alone; the
  // service normalizes order/duplicates and rejects a set that renders no tabs.
  // `ValidateIf(value !== undefined)` rather than `IsOptional()`: IsOptional
  // skips validation for null as well as undefined, so an explicit `null` would
  // sail past IsIn and reach a NOT NULL column as a 500. Omitted still means
  // "leave it alone"; null is simply not a value these accept.
  @ValidateIf((_o, value) => value !== undefined)
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(Object.values(WIDGET_TAB), { each: true })
  tabs?: WidgetTab[];

  @ValidateIf((_o, value) => value !== undefined)
  @IsIn(Object.values(WIDGET_TAB_POSITION))
  tab_position?: WidgetTabPosition;

  // IANA timezone (e.g. 'Asia/Seoul'); drives the default widget language. Empty
  // string / null clears it. Optional so a login-mode-only update leaves it intact.
  @IsOptional()
  @IsString()
  @Matches(/^$|^[A-Za-z]+\/[A-Za-z_+-]+$/)
  timezone?: string | null;
  // Explicit default widget language; '' or null = follow the timezone.
  @IsOptional()
  @IsIn([...LANGUAGE_CODES, ''])
  default_language?: string | null;

  // Widget copy (PLN-260808-Widget-Greetings). PATCH semantics per field:
  // undefined = keep, ''/null = clear back to the widget default. Flat per-language
  // fields keep validation trivial; the service folds them into the JSON blob.
  @IsOptional() @IsString() @MaxLength(80) display_name?: string | null;
  @IsOptional() @IsString() @MaxLength(500) first_visit_en?: string | null;
  @IsOptional() @IsString() @MaxLength(500) first_visit_es?: string | null;
  @IsOptional() @IsString() @MaxLength(500) first_visit_ko?: string | null;
  @IsOptional() @IsString() @MaxLength(500) first_visit_vi?: string | null;
  @IsOptional() @IsString() @MaxLength(500) first_visit_ja?: string | null;
  @IsOptional() @IsString() @MaxLength(500) first_visit_zh?: string | null;
  @IsOptional() @IsString() @MaxLength(500) login_greeting_en?: string | null;
  @IsOptional() @IsString() @MaxLength(500) login_greeting_es?: string | null;
  @IsOptional() @IsString() @MaxLength(500) login_greeting_ko?: string | null;
  @IsOptional() @IsString() @MaxLength(500) login_greeting_vi?: string | null;
  @IsOptional() @IsString() @MaxLength(500) login_greeting_ja?: string | null;
  @IsOptional() @IsString() @MaxLength(500) login_greeting_zh?: string | null;
}

/**
 * Per-category channel policy (PLN-260817-Widget-Header-Prefs-Cleanup).
 * `{ [category]: channel[] }` — a category left out imposes no ceiling.
 */
export class UpdateNotificationChannelsRequest {
  @IsObject()
  channels: Record<string, string[]>;
}

/**
 * Widget theme (PLN-260818). One colour; the ramp and foregrounds are computed
 * server-side, so there is nothing here for a caller to get inconsistent.
 */
export class UpdateWidgetThemeRequest {
  // Hex only. Anything else is refused rather than normalized into a surprise.
  @IsString()
  @Matches(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
  brand: string;

  @IsOptional()
  @IsIn(['white', 'brand'])
  header_style?: 'white' | 'brand';

  /**
   * Launcher geometry (PLN-260819 S4). Optional: a console that only sends the
   * colour must not reset the launcher, so the service carries the stored value
   * forward when this is absent.
   */
  @IsOptional() @IsObject() launcher?: { position?: string; size?: string; icon?: string };

  /**
   * Design profile (PLN-260910 P2): font, base size, corners, panel size and an
   * uploaded launcher icon. Optional and carried forward when absent, like the
   * launcher. Asset uuids are checked against the tenant's own design files.
   */
  @IsOptional() @IsObject() design?: {
    font?: { preset?: string; asset_uuid?: string | null; base_size?: number } | null;
    radius?: string | null;
    panel?: { width?: number; height?: number } | null;
    launcher_icon_uuid?: string | null;
    /** 'chip' (default) | 'card' — opening scenario menu style (PLN-260916 P4). */
    quick_reply_style?: string | null;
    /** Review chip link, e.g. `{productUrl}#reviews` (PLN-260923 P3); normalized, invalid → default. */
    review_link_template?: string | null;
    /** Raw custom CSS; the service sanitizes it and drops it when the add-on is off (P5). */
    custom_css?: string | null;
  } | null;
}

/** Platform add-on switch for tenant custom widget CSS (PLN-260910 P5). */
export class UpdateTenantCustomCssRequest {
  @IsBoolean() enabled: boolean;
}

/** Custom widget library (PLN-260910 P3). `design` has the same shape as widget-theme.design. */
export class CreateWidgetDesignRequest {
  @IsString() @Length(1, 64) name: string;
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;
  @IsObject() design: NonNullable<UpdateWidgetThemeRequest['design']>;
}

export class UpdateWidgetDesignRequest {
  @IsOptional() @IsString() @Length(1, 64) name?: string;
  @IsOptional() @IsString() @MaxLength(255) note?: string | null;
  @IsOptional() @IsObject() design?: NonNullable<UpdateWidgetThemeRequest['design']>;
}

/** PLN-260819 S1 — replace the embed allowlist wholesale (empty = back to default). */
export class UpdateEmbedOriginsRequest {
  @IsArray()
  @IsString({ each: true })
  @MaxLength(255, { each: true })
  @ArrayMaxSize(50)
  origins: string[];
}
