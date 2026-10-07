// Shared domain enums & constant objects (frontend + backend).
// Pattern: const object + derived union type (amoeba_code_convention_v2).

// ---- Tenancy & RBAC ----
export const ADMIN_LEVEL = { SUPER_ADMIN: 'super_admin', ADMIN: 'admin' } as const;
export type AdminLevel = (typeof ADMIN_LEVEL)[keyof typeof ADMIN_LEVEL];

export const USER_RANK = {
  MASTER: 'master',
  DIRECTOR: 'director',
  MANAGER: 'manager',
  STAFF: 'staff',
} as const;
export type UserRank = (typeof USER_RANK)[keyof typeof USER_RANK];

export const JOB_LABEL = {
  CONSULT: 'consult',
  ACCOUNTING: 'accounting',
  OPERATIONS: 'operations',
  /** Sales Admin (PLN-261007): handles partner/contract conversations — consult screens + customers/orders. */
  SALES_ADMIN: 'sales_admin',
} as const;
export type JobLabel = (typeof JOB_LABEL)[keyof typeof JOB_LABEL];

/**
 * Which held labels satisfy a screen/capability that requires `required`
 * (PLN-261007). Sales Admin is a superset of consult for conversation work, so
 * a requirement for `consult` is met by either; the other labels are exact.
 */
export const JOB_LABEL_SATISFIED_BY: Record<JobLabel, readonly JobLabel[]> = {
  [JOB_LABEL.CONSULT]: [JOB_LABEL.CONSULT, JOB_LABEL.SALES_ADMIN],
  [JOB_LABEL.ACCOUNTING]: [JOB_LABEL.ACCOUNTING],
  [JOB_LABEL.OPERATIONS]: [JOB_LABEL.OPERATIONS],
  [JOB_LABEL.SALES_ADMIN]: [JOB_LABEL.SALES_ADMIN],
};

export function hasLabelFor(required: JobLabel, labels: readonly string[]): boolean {
  return (JOB_LABEL_SATISFIED_BY[required] ?? [required]).some((l) => labels.includes(l));
}

/** Operational region of a tenant user (PLN-261007); null = nationwide. */
export const USER_REGION = { NORTH: 'north', SOUTH: 'south' } as const;
export type UserRegion = (typeof USER_REGION)[keyof typeof USER_REGION];

export const ACTOR_TYPE = { ADMIN: 'admin', USER: 'user' } as const;
export type ActorType = (typeof ACTOR_TYPE)[keyof typeof ACTOR_TYPE];

// ---- Customer ----
export const CUSTOMER_TIER = { GUEST: 'guest', SUBSCRIBER: 'subscriber', REGULAR: 'regular' } as const;
export type CustomerTier = (typeof CUSTOMER_TIER)[keyof typeof CUSTOMER_TIER];

export const CONSENT_STATE = { PENDING: 'pending', GRANTED: 'granted', DECLINED: 'declined' } as const;
export type ConsentState = (typeof CONSENT_STATE)[keyof typeof CONSENT_STATE];

// How the widget's "Sign in" opens the storefront login (tenant console
// setting). REDIRECT navigates the whole tab (default — survives popup
// blockers and Shopify's hosted New Customer Accounts login); POPUP keeps the
// store page and brokers a popup window.
export const WIDGET_LOGIN_MODE = { REDIRECT: 'redirect', POPUP: 'popup' } as const;
export type WidgetLoginMode = (typeof WIDGET_LOGIN_MODE)[keyof typeof WIDGET_LOGIN_MODE];

// Which tabs the widget shows, and where the tab bar sits — both tenant console
// settings (PLN-260817-Widget-Tab-Config). Declared here so the API, console and
// widget cannot drift on the spelling of a tab key.
export const WIDGET_TAB = {
  NOTIFICATIONS: 'notifications',
  ORDERS: 'orders',
  CHAT: 'chat',
} as const;
export type WidgetTab = (typeof WIDGET_TAB)[keyof typeof WIDGET_TAB];

/**
 * Display order of the tab bar. Tenants choose WHICH tabs appear, not the order
 * they appear in — so normalization sorts by this rather than trusting the order
 * a request happened to arrive in.
 */
export const WIDGET_TAB_ORDER: readonly WidgetTab[] = [
  WIDGET_TAB.NOTIFICATIONS,
  WIDGET_TAB.ORDERS,
  WIDGET_TAB.CHAT,
] as const;

/**
 * What a tenant gets before they configure anything — and therefore what every
 * tenant that predates this setting keeps. Changing this line changes the widget
 * for every unconfigured tenant, which is exactly why the column stores NULL for
 * "unconfigured" rather than a copy of this array.
 *
 * All three since 2026-08-18. That NULL design is what makes this a one-line
 * change instead of a backfill: no tenant row records the old default, so every
 * shop that never chose picks up the new one on its next session.
 */
export const WIDGET_TABS_DEFAULT: readonly WidgetTab[] = [
  WIDGET_TAB.NOTIFICATIONS,
  WIDGET_TAB.ORDERS,
  WIDGET_TAB.CHAT,
] as const;

/**
 * Notification categories that belong to the ORDERS side of the widget.
 *
 * Shared because two places must agree exactly: the API, which filters and
 * counts by it, and the widget, which decides which tab renders which chips.
 * A category listed here shows under Orders when that tab is on, and falls back
 * to Notifications when it is off — it is never shown in both at once.
 * `inquiries` is deliberately absent: that chip reads the issue feed, not the
 * notification table.
 */
export const ORDER_NOTIFICATION_CATEGORIES: readonly string[] = [
  'payment',
  'shipping',
  'review',
] as const;

/**
 * Which half of the notification feed a request wants. Absent = the whole feed,
 * which is what a tenant with only one list tab should get.
 */
export const NOTIFICATION_SCOPE = { ORDER: 'order', NOTICE: 'notice' } as const;
export type NotificationScope = (typeof NOTIFICATION_SCOPE)[keyof typeof NOTIFICATION_SCOPE];

/**
 * Categories the shop sends because something happened to an order or a
 * conversation. They are default-ALLOW on external channels; everything else is
 * marketing and default-DENY (PLN-260817-Widget-Header-Prefs-Cleanup).
 */
export const TRANSACTIONAL_CATEGORIES: readonly string[] = [
  'payment',
  'shipping',
  'chat',
] as const;

/** External delivery channels — everything except the always-on in-app feed. */
export const EXTERNAL_CHANNELS: readonly string[] = [
  'email',
  'sms',
  'web_push',
  'push',
] as const;

/**
 * Marketing is DERIVED, never listed.
 *
 * The widget's "do not send me marketing" toggle and the server's default-deny
 * must cover exactly the same categories. Writing a second list would let them
 * drift the first time a category is added — and the failure mode is silent
 * marketing delivery to someone who opted out.
 */
export function isMarketingCategory(category: string): boolean {
  return !TRANSACTIONAL_CATEGORIES.includes(category);
}

/**
 * Per-tenant delivery policy: which external channels each category may use.
 * A category absent from the object is unconstrained — the policy is a ceiling
 * on what the SHOP sends, not a replacement for the customer's own preference.
 */
export type NotificationChannelPolicy = Record<string, string[]>;

/**
 * Does this tenant permit `channel` for `category`?
 *
 * `null`/absent policy means "not configured", which must behave exactly as the
 * system did before the setting existed — allowed here, with the customer
 * preference and the marketing default-deny below still deciding.
 */
export function channelAllowedByTenant(
  policy: NotificationChannelPolicy | null | undefined,
  category: string,
  channel: string,
): boolean {
  if (!policy || typeof policy !== 'object') return true;
  const allowed = policy[category];
  if (!Array.isArray(allowed)) return true;
  return allowed.includes(channel);
}

export const WIDGET_TAB_POSITION = { TOP: 'top', BOTTOM: 'bottom' } as const;
export type WidgetTabPosition = (typeof WIDGET_TAB_POSITION)[keyof typeof WIDGET_TAB_POSITION];

/**
 * Clean an arbitrary tab list into something renderable: known keys only, no
 * duplicates, canonical order. Returns null when nothing survives — the caller
 * decides whether that is a 400 (a tenant saving an empty bar) or a fallback to
 * the default (a stored value that predates a renamed tab key).
 *
 * A widget with no tabs cannot be navigated at all, so "empty" is never a valid
 * end state; it is only ever an input to reject or replace.
 */
export function normalizeWidgetTabs(input: unknown): WidgetTab[] | null {
  if (!Array.isArray(input)) return null;
  const wanted = new Set(input.filter((v): v is string => typeof v === 'string'));
  const tabs = WIDGET_TAB_ORDER.filter((t) => wanted.has(t));
  return tabs.length > 0 ? [...tabs] : null;
}

// Session identity assurance. VERIFIED is minted only via the Shopify App Proxy
// (Shopify-signed customer identity); GUEST covers order-number+email lookup.
export const SESSION_IDENTITY = { GUEST: 'guest', VERIFIED: 'verified' } as const;
export type SessionIdentity = (typeof SESSION_IDENTITY)[keyof typeof SESSION_IDENTITY];

// The language set moved to ./language.ts, which carries labels, timezone
// defaults and review state alongside the codes (REQ-260817). Re-exported here
// so the many `import { SESSION_LANGUAGE } from '@sharptalk/types'` sites keep working.
export { SESSION_LANGUAGE, type SessionLanguage } from './language';

// ---- Chat ----
export const CONVERSATION_STATUS = {
  AI_ACTIVE: 'ai_active',
  WAITING: 'waiting',
  AGENT: 'agent',
  ENDED: 'ended',
} as const;
export type ConversationStatus = (typeof CONVERSATION_STATUS)[keyof typeof CONVERSATION_STATUS];

export const SENDER_TYPE = { USER: 'user', AI: 'ai', AGENT: 'agent', SYSTEM: 'system' } as const;
export type SenderType = (typeof SENDER_TYPE)[keyof typeof SENDER_TYPE];

// ---- Orders (POL-014 taxonomy) ----
export const ORDER_STATUS_INTERNAL = {
  // Cafe24 N00(입금전) — the shopper hasn't paid yet. Shopify orders never carry
  // this (they enter the cache already paid); it only appears on channels that
  // expose a pre-payment stage (PLN-260807 §3.3).
  PENDING_PAYMENT: 'pending_payment',
  PAID: 'paid',
  PREPARING: 'preparing',
  SHIPPING: 'shipping',
  DELIVERED: 'delivered',
  // Cafe24 C00(취소신청) — a cancel was requested; off the main fulfilment flow.
  CANCEL_REQUESTED: 'cancel_requested',
} as const;
export type OrderStatusInternal = (typeof ORDER_STATUS_INTERNAL)[keyof typeof ORDER_STATUS_INTERNAL];

export const ORDER_STATUS_UI = {
  PENDING_PAYMENT: 'Pending payment',
  CONFIRMED: 'Confirmed',
  IN_TRANSIT: 'In Transit',
  DELIVERED: 'Delivered',
  REVIEW: 'Review',
  CANCEL_REQUESTED: 'Cancel requested',
} as const;
export type OrderStatusUi = (typeof ORDER_STATUS_UI)[keyof typeof ORDER_STATUS_UI];

export const FULFILLMENT_STATUS = {
  PREPARING: 'preparing',
  SHIPPED: 'shipped',
  IN_TRANSIT: 'in_transit',
  DELIVERED: 'delivered',
} as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUS)[keyof typeof FULFILLMENT_STATUS];

// ---- Notifications ----
export const NOTIFICATION_CATEGORY = {
  PAYMENT: 'payment',
  SHIPPING: 'shipping',
  EVENT: 'event',
  REVIEW: 'review',
  // Agent chat replies delivered while the mobile app is backgrounded.
  // Transactional (service) category — default-allow like payment/shipping.
  CHAT: 'chat',
  ALL: 'all',
} as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORY)[keyof typeof NOTIFICATION_CATEGORY];

export const NOTIFICATION_CHANNEL = {
  IN_APP: 'in_app',
  EMAIL: 'email',
  SMS: 'sms',
  WEB_PUSH: 'web_push',
  // Native mobile push (FCM/APNs via the provider abstraction in domain/push).
  PUSH: 'push',
} as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNEL)[keyof typeof NOTIFICATION_CHANNEL];

// ---- CJM ----
export const CJM_STAGE = {
  AWARENESS: 'Awareness',
  BROWSE: 'Browse',
  INQUIRY: 'Inquiry',
  PURCHASE: 'Purchase',
  DELIVERY: 'Delivery',
  POST: 'Post',
} as const;
export type CjmStage = (typeof CJM_STAGE)[keyof typeof CJM_STAGE];

// ---- AI engine / functions ----
export const AI_FUNCTION = {
  CHAT: 'chat',
  RAG: 'rag',
  SUMMARY: 'summary',
  ASSIST: 'assist',
  MODERATION: 'moderation',
  EMBEDDING: 'embedding',
  /**
   * Admin-facing coaching chat (FR-071). Routed separately from CHAT/RAG so a
   * tenant can give the channel that writes durable config its own engine.
   */
  COACH: 'coach',
} as const;
export type AiFunction = (typeof AI_FUNCTION)[keyof typeof AI_FUNCTION];

export const AI_PROVIDER = {
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  GOOGLE: 'google',
  AZURE: 'azure',
  CUSTOM: 'custom',
} as const;
export type AiProvider = (typeof AI_PROVIDER)[keyof typeof AI_PROVIDER];

// ---- Moderation ----
export const MODERATION_ACTION = {
  BLOCK: 'block',
  MASK: 'mask',
  WARN: 'warn',
  REPHRASE: 'rephrase',
  PASS: 'pass',
} as const;
export type ModerationAction = (typeof MODERATION_ACTION)[keyof typeof MODERATION_ACTION];

export const MODERATION_DECISION = {
  BLOCKED: 'blocked',
  DELIVERED: 'delivered',
  EDITED: 'edited',
} as const;
export type ModerationDecision = (typeof MODERATION_DECISION)[keyof typeof MODERATION_DECISION];

// ---- Knowledge sources ----
export const KNOWLEDGE_SOURCE_TYPE = {
  BOARD: 'board',
  REPOSITORY: 'repository',
  GDRIVE: 'gdrive',
  NOTION: 'notion',
} as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPE)[keyof typeof KNOWLEDGE_SOURCE_TYPE];

// ---- Integrations ----
export const INTEGRATION_PROVIDER = {
  SHOPIFY: 'shopify',
  CAFE24: 'cafe24',
  WOOCOMMERCE: 'woocommerce',
  ODOO: 'odoo',
  HARAVAN: 'haravan',
  FULFILLMENT: 'fulfillment',
  KLAVIYO: 'klaviyo',
  YOTPO: 'yotpo',
  GORGIAS: 'gorgias',
  GOOGLE_DRIVE: 'google_drive',
  NOTION: 'notion',
} as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDER)[keyof typeof INTEGRATION_PROVIDER];

/**
 * E-commerce providers that expose a per-tenant "connection settings" card in the
 * console (credentials + connection test). Shopify keeps its own richer card
 * (install guide, order sync, webhooks); these four use the generic flow.
 */
export const ECOMMERCE_PROVIDERS = [
  INTEGRATION_PROVIDER.CAFE24,
  INTEGRATION_PROVIDER.WOOCOMMERCE,
  INTEGRATION_PROVIDER.ODOO,
  INTEGRATION_PROVIDER.HARAVAN,
] as const;
export type EcommerceProvider = (typeof ECOMMERCE_PROVIDERS)[number];

/**
 * Non-commerce connected apps sharing the SAME generic credential flow
 * (PLN-260808-Marketing-Integrations): marketing platforms and helpdesks.
 * Kept as separate axes so the console can group tiles and P2 can add more
 * helpdesk connectors (Zendesk/Front/Freshdesk) without touching commerce.
 */
export const MARKETING_PROVIDERS = [
  INTEGRATION_PROVIDER.KLAVIYO,
  INTEGRATION_PROVIDER.YOTPO,
] as const;
export type MarketingProvider = (typeof MARKETING_PROVIDERS)[number];

export const HELPDESK_PROVIDERS = [INTEGRATION_PROVIDER.GORGIAS] as const;
export type HelpdeskProvider = (typeof HELPDESK_PROVIDERS)[number];

/** Every provider served by the generic settings/save/test flow. */
export const GENERIC_INTEGRATION_PROVIDERS = [
  ...ECOMMERCE_PROVIDERS,
  ...MARKETING_PROVIDERS,
  ...HELPDESK_PROVIDERS,
] as const;
export type GenericIntegrationProvider = (typeof GENERIC_INTEGRATION_PROVIDERS)[number];

/** One credential field of an integration. `secret` fields are write-only (masked on read). */
export interface IntegrationFieldSpec {
  key: string;
  secret: boolean;
  required: boolean;
}

/**
 * Credential field schema per e-commerce provider — single source of truth shared
 * by the API (which fields to store/mask/validate) and the console (which inputs to
 * render). Field labels/placeholders are localized on the client by field `key`.
 */
// `webhook_secret` (optional, per-tenant) is the HMAC/shared secret used to verify
// this provider's inbound webhooks. Stored encrypted alongside the other creds so a
// tenant can manage it from the console; the API falls back to a global env secret
// when it is unset. (Shopify is intentionally NOT here — its webhook secret is the
// app-level API secret shared across all shops, sourced from env.)
export const INTEGRATION_FIELDS: Record<GenericIntegrationProvider, IntegrationFieldSpec[]> = {
  cafe24: [
    { key: 'mall_id', secret: false, required: true },
    { key: 'client_id', secret: true, required: false },
    { key: 'client_secret', secret: true, required: false },
    { key: 'access_token', secret: true, required: true },
    { key: 'webhook_secret', secret: true, required: false },
  ],
  woocommerce: [
    { key: 'store_url', secret: false, required: true },
    { key: 'consumer_key', secret: true, required: true },
    { key: 'consumer_secret', secret: true, required: true },
    { key: 'webhook_secret', secret: true, required: false },
  ],
  odoo: [
    { key: 'url', secret: false, required: true },
    { key: 'db', secret: false, required: true },
    { key: 'username', secret: false, required: true },
    { key: 'api_key', secret: true, required: true },
    { key: 'webhook_secret', secret: true, required: false },
  ],
  haravan: [
    { key: 'shop_domain', secret: false, required: true },
    { key: 'access_token', secret: true, required: true },
    { key: 'webhook_secret', secret: true, required: false },
  ],
  // Marketing (PLN-260808): Klaviyo private API key; Yotpo core API app/secret pair.
  klaviyo: [{ key: 'api_key', secret: true, required: true }],
  yotpo: [
    { key: 'app_key', secret: false, required: true },
    { key: 'secret_key', secret: true, required: true },
  ],
  // Helpdesk (Rev.2, pre-provisions the P2 Gorgias L1 connector): REST Basic auth
  // = account email + REST API key on the account subdomain (REQ-260807 §11.2.1).
  gorgias: [
    { key: 'subdomain', secret: false, required: true },
    { key: 'email', secret: false, required: true },
    { key: 'api_key', secret: true, required: true },
    // L2 status webhook auth token (POST /webhooks/gorgias) — optional until the
    // tenant wires the Gorgias HTTP Integration (PLN-260809 P3).
    { key: 'webhook_secret', secret: true, required: false },
  ],
};

/**
 * External messenger channels (PLN-260810). Distinct from INTEGRATION_PROVIDER:
 * these carry *conversations* (inbound messages become SharpTalk conversations and
 * outbound replies go back out), not store/marketing credentials.
 */
export const MESSENGER_PROVIDER = {
  TELEGRAM: 'telegram',
  VIBER: 'viber',
  AMOEBATALK: 'amoebatalk',
  BTBZ_RELAY: 'btbz_relay',
  GMAIL: 'gmail',
} as const;
export type MessengerProvider = (typeof MESSENGER_PROVIDER)[keyof typeof MESSENGER_PROVIDER];

/** Channels SharpTalk speaks to directly (own webhook + own send API) — PR-M1. */
export const DIRECT_MESSENGER_PROVIDERS = [
  MESSENGER_PROVIDER.TELEGRAM,
  MESSENGER_PROVIDER.VIBER,
] as const;

/** How a channel is reached: 'direct' = platform API, 'hub' = via an aggregator. */
export const MESSENGER_MODE = { DIRECT: 'direct', HUB: 'hub' } as const;
export type MessengerMode = (typeof MESSENGER_MODE)[keyof typeof MESSENGER_MODE];

/**
 * Consent handling for a channel with no widget consent banner (REQ G3):
 * 'notice' sends the privacy notice on first contact and records the grant;
 * 'auto' relies on the platform's own terms (tenant's call).
 */
export const MESSENGER_CONSENT_MODE = { NOTICE: 'notice', AUTO: 'auto' } as const;
export type MessengerConsentMode =
  (typeof MESSENGER_CONSENT_MODE)[keyof typeof MESSENGER_CONSENT_MODE];

/**
 * Outbound delivery state. 'unconfirmed' exists because some relays (btbz KSR)
 * cannot prove delivery — reporting those as 'sent' would be a false claim.
 */
export const OUTBOX_STATUS = {
  PENDING: 'pending',
  SENT: 'sent',
  UNCONFIRMED: 'unconfirmed',
  FAILED: 'failed',
} as const;
export type OutboxStatus = (typeof OUTBOX_STATUS)[keyof typeof OUTBOX_STATUS];

export const CHANNEL_DIRECTION = { INBOUND: 'inbound', OUTBOUND: 'outbound' } as const;
export type ChannelDirection = (typeof CHANNEL_DIRECTION)[keyof typeof CHANNEL_DIRECTION];

/** Credential fields per messenger provider (console renders, API stores/masks). */
export const MESSENGER_FIELDS: Record<MessengerProvider, IntegrationFieldSpec[]> = {
  // Bot token from BotFather — the only credential Telegram needs.
  telegram: [{ key: 'bot_token', secret: true, required: true }],
  // Viber public-account auth token; also the HMAC key for inbound signatures.
  viber: [{ key: 'auth_token', secret: true, required: true }],
  amoebatalk: [
    { key: 'email', secret: false, required: true },
    { key: 'password', secret: true, required: true },
    { key: 'company_id', secret: false, required: false },
  ],
  btbz_relay: [
    { key: 'base_url', secret: false, required: true },
    // Operator account — still what sends replies (the provider surface has no
    // write route yet; PLN-260814 D1a hybrid).
    { key: 'email', secret: false, required: true },
    { key: 'password', secret: true, required: true },
    // Provider API key (PLN-260814): when key_id + api_secret are both set the
    // adapter reads via the signed provider API instead of the operator inbox.
    { key: 'key_id', secret: false, required: false },
    { key: 'api_secret', secret: true, required: false },
    // Optional binding assertion: the relay rejects the call (E5101) when the
    // instance does not serve this customerRef — a mispointed base_url is
    // detected before any data is stored.
    { key: 'expected_customer', secret: false, required: false },
  ],
  gmail: [
    { key: 'email', secret: false, required: true },
    { key: 'imap_host', secret: false, required: true },
    { key: 'smtp_host', secret: false, required: true },
    { key: 'app_password', secret: true, required: true },
  ],
};
