import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';
import { bigintTransformer } from '../../../global/util/transformers';
import { decryptSecret, encryptSecret } from '../../../global/util/crypto.util';
import type { WidgetAccess, WidgetTheme } from '@sharptalk/types';

/**
 * The embed secret is a credential, so it never sits in the database as text.
 * Same AES-256-GCM helper the messenger channel credentials use; the property
 * stays a plain string everywhere above this line.
 */
const secretTransformer = {
  to: (value: string | null): Buffer | null => (value ? encryptSecret(value) : null),
  from: (value: Buffer | null): string | null =>
    value && value.length ? decryptSecret(value) : null,
};

/** Shape of the `widget_copy` JSON column; keyed by session language (EN/ES/KO/VI/JA/ZH). */
export interface TenantWidgetCopy {
  displayName?: string | null;
  firstVisit?: Record<string, string>;
  loginGreeting?: Record<string, string>;
}

/** tenants — a tenant = a Shopify shop (FR-051). */
@Entity('tenants')
@Unique('uk_tenant_shop', ['shopDomain'])
@Unique('uk_tenant_slug', ['slug'])
@Unique('uk_tenant_uuid', ['uuid'])
export class Tenant {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: number;

  // External identifier: admin API/console reference tenants by UUID so the
  // sequential PK never leaks outside the service (PK stays bigint for FKs).
  @Column({ type: 'char', length: 36 })
  uuid: string;

  @Column({ name: 'shop_domain', type: 'varchar', length: 255 })
  shopDomain: string;

  // URL-safe unique handle; the tenant login page lives at /<slug>.
  @Column({ type: 'varchar', length: 64 })
  slug: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string; // applied/active/suspended

  @Column({ type: 'varchar', length: 32, nullable: true })
  plan: string | null;

  /** Tenant's public privacy-policy page shown in the widget consent banner. */
  @Column({ name: 'privacy_policy_url', type: 'varchar', length: 512, nullable: true })
  privacyPolicyUrl: string | null;

  /**
   * Customer-facing shop origin (e.g. `https://ivyusa.com`).
   *
   * Not `shopDomain`: that holds the Shopify admin domain
   * (`ambshop-dev.myshopify.com`), which shoppers never see, and the second
   * tenant is on cafe24 rather than Shopify.
   *
   * Null until an operator sets it, and that is the safe state: without a known
   * origin there is no way to tell a tenant's own product URL from an arbitrary
   * link that arrived in an uploaded CSV, so product citations render without
   * links rather than pointing customers anywhere.
   */
  @Column({ name: 'storefront_url', type: 'varchar', length: 255, nullable: true })
  storefrontUrl: string | null;

  /**
   * Tenant override of the consent-notice version; null falls back to the
   * platform-wide CONSENT_NOTICE_VERSION. Bumping it forces re-consent
   * (PLN-Privacy-Control-Gap Stage 2).
   */
  @Column({ name: 'consent_notice_version', type: 'varchar', length: 32, nullable: true })
  consentNoticeVersion: string | null;

  /** Widget "Sign in" behavior: 'redirect' (whole-tab, default) or 'popup'. */
  @Column({ name: 'widget_login_mode', type: 'varchar', length: 16, default: 'redirect' })
  widgetLoginMode: string;

  /**
   * Tenant-configurable widget copy (PLN-260808-Widget-Greetings): display name,
   * first-visit welcome, login greeting — per-language JSON blob so future copy
   * additions need no migration. Null/missing fields fall back to widget defaults.
   */
  @Column({ name: 'widget_copy', type: 'json', nullable: true })
  widgetCopy: TenantWidgetCopy | null;

  /**
   * Tabs the widget shows, in display order (PLN-260817-Widget-Tab-Config).
   *
   * NULL means "never configured" and resolves to WIDGET_TABS_DEFAULT at read
   * time — it is NOT the same as an empty array, which is refused on write. Kept
   * nullable so a later change to the default reaches every tenant who never
   * chose otherwise, with no backfill.
   */
  @Column({ name: 'widget_tabs', type: 'json', nullable: true })
  widgetTabs: string[] | null;

  /** Where the widget's tab bar sits: 'top' (default) or 'bottom'. */
  @Column({ name: 'widget_tab_position', type: 'varchar', length: 8, default: 'top' })
  widgetTabPosition: string;

  /**
   * Which external channels this shop may use per notification category —
   * a CEILING on delivery, not a replacement for the customer's own preference
   * (PLN-260817-Widget-Header-Prefs-Cleanup §2.2).
   *
   * NULL means "not configured" and imposes no ceiling at all, so a tenant that
   * never opens the setting sends exactly what it sent before it existed.
   */
  @Column({ name: 'notification_channels', type: 'json', nullable: true })
  notificationChannels: Record<string, string[]> | null;

  /**
   * Widget brand theme (PLN-260818): one colour plus a header choice. The ramp
   * and every foreground colour are DERIVED from it, so this column never holds
   * a palette someone could get internally inconsistent.
   *
   * NULL = never themed = the built-in palette, with no backfill.
   */
  @Column({ name: 'widget_theme', type: 'json', nullable: true })
  widgetTheme: WidgetTheme | null;

  /**
   * Domains allowed to embed this tenant's widget (PLN-260819 S1).
   *
   * NULL = never configured, and resolves at read time to the tenant's own
   * storefront (`defaultOrigins`) — NOT to "everything". Kept nullable so the
   * column ships without a backfill and without cutting off a tenant that is
   * already embedding today.
   *
   * This list is a misconfiguration guard, not authentication: the origin is
   * reported by the browser. See embed-origin.util.ts.
   */
  @Column({ name: 'embed_origins', type: 'json', nullable: true })
  embedOrigins: string[] | null;

  /**
   * Widget exposure restriction (PLN-260929): show the widget only from these
   * IPs or URLs, only inside this window, plus whoever holds the invite key.
   * NULL = never configured = off, so no existing tenant changes behaviour.
   *
   * Exposure control, not access control — the URL comes from the browser and
   * the IP is the edge's X-Forwarded-For. See widget-access.ts.
   */
  @Column({ name: 'widget_access', type: 'json', nullable: true })
  widgetAccess: WidgetAccess | null;

  /**
   * Invite key for testers who are not on a fixed IP. Encrypted at rest and
   * shown again in the console, like `embed_secret` — it is a test-window
   * convenience, not a credential that proves anything about who holds it.
   */
  @Column({
    name: 'widget_access_key',
    type: 'varbinary',
    length: 512,
    nullable: true,
    transformer: secretTransformer,
  })
  widgetAccessKey: string | null;

  /**
   * Shared secret the customer's own server signs user ids with (PLN-260819 S2).
   * Encrypted at rest with the same AES-256-GCM helper as messenger channel
   * credentials; shown in the console once at creation and never again.
   */
  @Column({
    name: 'embed_secret',
    type: 'varbinary',
    length: 512,
    nullable: true,
    transformer: secretTransformer,
  })
  embedSecret: string | null;

  /**
   * Issue-workflow entitlement (REQ-260807 §11.1, server-judged):
   * 'native' (paid add-on: kanban/state machine) | 'bridge' (external helpdesk
   * hand-off) | 'base' (chat list only, default — behavior unchanged).
   */
  @Column({ name: 'workflow_mode', type: 'varchar', length: 8, default: 'base' })
  workflowMode: string;

  /**
   * Whether /knowledge shows the product usage-guides section (PLN-260910 D-1).
   * OFF hides the section only — guide documents and their RAG citations stay.
   */
  @Column({ name: 'usage_guides_enabled', type: 'tinyint', width: 1, default: 0 })
  usageGuidesEnabled: number;

  /** Live custom widget (widget_designs.id); NULL = the basic widget (PLN-260910 P3). */
  @Column({ name: 'active_widget_design_id', type: 'bigint', nullable: true, transformer: bigintTransformer })
  activeWidgetDesignId: number | null;

  /**
   * Platform add-on (PLN-260910 P5): custom widget CSS is stored and delivered
   * only while this is on. It is a platform-admin switch, not a tenant one —
   * the capability carries risk the tenant cannot judge for the platform.
   */
  @Column({ name: 'custom_css_enabled', type: 'tinyint', width: 1, default: 0 })
  customCssEnabled: number;

  // IANA timezone (e.g. 'Asia/Seoul', 'America/New_York'). Drives the default
  // widget language when the shopper hasn't picked one (Seoul → ko, US → en).
  @Column({ type: 'varchar', length: 40, nullable: true })
  timezone: string | null;

  // Explicit default widget language (language code, e.g. 'vi'). NULL = derive
  // from `timezone` as before. Outranks the timezone, never an explicit
  // non-English shopper choice (REQ-260913-VN-Prerequisite-Gaps G1/G2).
  @Column({ name: 'default_language', type: 'varchar', length: 5, nullable: true })
  defaultLanguage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
