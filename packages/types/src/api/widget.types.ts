/**
 * Wire contracts for the widget-facing (storefront) endpoints — the single source
 * of truth shared by the API mappers and the widget frontend.
 *
 * The widget used to hand-maintain its own copy of every shape, with nothing
 * checking the two against each other. They drifted, silently: an order detail
 * typed `{ order, items }` against a flat payload crashed the whole widget, and a
 * tracking stepper typed `{label}[]` against `string[]` rendered blank rows. A
 * mapper that `implements`/returns these types makes such a drift a compile error.
 *
 * These describe the JSON **as it leaves the server**, which is why:
 *  - ids are `string` — every PK is a MySQL BIGINT with no numeric transformer, so
 *    the driver hands back a string and that is what serializes.
 *  - timestamps are ISO `string` — mappers emit `Date`, JSON makes it a string, and
 *    the client only ever sees the string.
 * Nullability below is what the entities actually allow, not what is convenient.
 */

import type { WidgetLoginMode, WidgetTab, WidgetTabPosition } from '../common/enum.types';
import type { WidgetTheme } from '../common/widget-theme';

// ---- session -------------------------------------------------------------
/** Per-language customer-facing copy; keys are uppercase language codes. */
export interface WidgetCopyText {
  EN?: string;
  ES?: string;
  KO?: string;
}

/**
 * Tenant-configured widget copy (PLN-260808-Widget-Greetings). Missing/empty
 * fields fall back to the widget's built-in defaults with `{shop}` = displayName.
 */
export interface WidgetCopy {
  /** Store display name for the widget header and greeting templates. */
  displayName: string | null;
  /** First-visit welcome bubble text; `{shop}` substituted. */
  firstVisit: WidgetCopyText;
  /** Signed-in greeting template; `{name}` (and `{shop}`) substituted. */
  loginGreeting: WidgetCopyText;
}

export interface SessionResponse {
  sessionToken: string;
  language: string;
  consentState: string;
  authenticated: boolean;
  /** Bound customer's display name; null for guests and until the profile syncs. */
  customerName: string | null;
  /** Tenant's privacy-policy link (null when the tenant has not set one). */
  privacyPolicyUrl: string | null;
  /** Effective consent-notice version (tenant override ?? platform default). */
  consentNoticeVersion: string;
  /** True when a recorded consent references a version other than the effective one. */
  noticeOutdated: boolean;
  /** When the consent choice was recorded (ISO 8601), null when never recorded. */
  consentAt: string | null;
  /** How the widget's "Sign in" opens the storefront login (tenant console setting). */
  widgetLoginMode: WidgetLoginMode;
  /**
   * Region code where AI inference runs for this deployment (env
   * AI_PROCESSING_REGION, default 'US'). The widget's AI disclosure names it
   * (REQ-260913-VN-Prerequisite-Gaps G7).
   */
  aiProcessingRegion: string;
  /**
   * Tabs this tenant shows, in display order (PLN-260817-Widget-Tab-Config).
   * Always non-empty and already normalized — the widget renders it as given
   * rather than re-deciding what a valid bar looks like.
   */
  widgetTabs: WidgetTab[];
  /** Where the tab bar sits: 'top' (default) or 'bottom'. */
  widgetTabPosition: WidgetTabPosition;
  /**
   * Brand theme, or null when unthemed. Null is meaningful: the widget's own
   * stylesheet carries the built-in palette, so an unthemed tenant needs no
   * variables written at all (PLN-260818 §2.4).
   */
  widgetTheme: WidgetTheme | null;
  /** Tenant widget copy (display name + greetings); displayName pre-falls back to the tenant name. */
  widgetCopy: WidgetCopy;
  /**
   * The tenant runs an issue workflow, so the shopper has an inquiry feed
   * (PLN-260923 D-2). Optional: a server that predates it sends nothing, which
   * reads as "no feed".
   */
  issueFeed?: boolean;
}

// ---- chat ---------------------------------------------------------------
export interface ChatCitation {
  id?: number;
  title?: string;
  category?: string | null;
  source?: string;
  snippet?: string;
  /** counsel | product | operation — the widget labels product citations as recommendations. */
  group?: string;
  /** Present only for a product on the tenant's own storefront; null otherwise. */
  url?: string | null;
}

/** Scenario follow-up chip (FR-S1). */
export interface ScenarioFollowUpResponse {
  id: string;
  label: string;
}

/**
 * A file exchanged in the conversation (PLN-260814). `url`/`thumbUrl` are signed
 * and short-lived, so they are re-minted on every response that carries them —
 * a URL held from an earlier poll stops working, by design.
 */
export interface ChatAttachmentResponse {
  id: string;
  kind: 'image' | 'file';
  filename: string;
  mime: string;
  size: number;
  width?: number | null;
  height?: number | null;
  url: string;
  /** Images only; null when thumbnailing was unavailable (render the original). */
  thumbUrl?: string | null;
}

export interface ChatMessageResponse {
  id: string;
  senderType: string;
  senderName: string | null;
  body: string;
  createdAt: string;
  /** Files sent with this turn. Absent when the turn is text-only. */
  attachments?: ChatAttachmentResponse[];
  /** Present only on a scripted turn that carries chips. */
  quickReplies?: ScenarioFollowUpResponse[];
  /**
   * Knowledge references behind an AI answer, including product-page links.
   * Served from the persisted turn so they survive the poll reconcile and a
   * reload — the send response alone made them vanish within one poll.
   */
  citations?: ChatCitation[];
}

export interface ConversationResponse {
  /** Null until the first message creates a conversation. */
  conversationId: string | null;
  status: string;
  messages: ChatMessageResponse[];
  /**
   * Satisfaction state for the ended thread (PLN-260810 P2/P3). `canRate` is
   * false once the 24-hour window closes, so the widget never shows stars that
   * the API would reject.
   */
  csatRating?: number | null;
  canRate?: boolean;
}

export interface ChatTurnResponse {
  /**
   * Null when the turn produced no conversation (consent declined). It used to be
   * the number 0 for that case; the client's `if (!conversationId)` guard relied on
   * it being falsy, and `'0'` would not have been — hence null, not a stringified 0.
   */
  conversationId: string | null;
  /** Null in agent/waiting mode — the human reply arrives via polling. */
  reply: {
    senderType: string;
    body: string;
    citations?: ChatCitation[];
    /** RAG grounding confidence — surfaced for the admin preview diagnostics. */
    confidence?: number;
    /**
     * Persisted id of this turn. The admin preview uses it to anchor a coaching
     * thread to the exact answer under discussion; the widget ignores it.
     */
    messageId?: string;
  } | null;
  escalate: boolean;
  needsAuth: boolean;
  /**
   * Off-hours handoff with no address on file: the widget asks for one so the
   * agent's reply has somewhere to go (PLN-260806).
   */
  needsContactEmail?: boolean;
}

/** Post-reply navigation the widget performs after a scripted answer (FR-003). */
export interface ScenarioPostActionResponse {
  type: 'none' | 'open_orders' | 'open_contact' | 'open_affiliate' | 'connect_agent' | 'open_url';
  url?: string;
}

export interface ScenarioTurnResponse {
  /**
   * Null when the turn produced no conversation — same consent-declined case as
   * ChatTurnResponse above, reached from the scenario-button path. Null rather
   * than a stringified 0 for the same reason: the client tests it for falsiness.
   */
  conversationId: string | null;
  reply: { senderType: string; body: string };
  followUps: ScenarioFollowUpResponse[];
  /** Absent/`none` = stay in the thread. */
  postAction?: ScenarioPostActionResponse;
}

// ---- orders -------------------------------------------------------------
/** Guest lookup result — deliberately smaller than the list item. */
export interface OrderLookupResponse {
  id: string;
  orderNumber: string;
  statusUi: string | null;
  total: number | null;
}

export interface OrderListItemResponse {
  id: string;
  orderNumber: string;
  statusInternal: string | null;
  statusUi: string | null;
  total: number | null;
  currency: string | null;
  createdAt: string;
  /** When the order was placed on the platform; null for rows that predate it. */
  orderedAt: string | null;
  itemCount: number;
  /**
   * Title of the order's first line item, so a list row can read
   * "Vitamin C Serum Set + 2 more" without a detail fetch per order
   * (PLN-260817 W-2). Null when the order has no items cached.
   */
  firstItemTitle: string | null;
}

export interface OrderItemResponse {
  /** Required to review the item (POST /reviews takes order_item_id). */
  id: string;
  title: string;
  optionText: string | null;
  qty: number;
  price: number | null;
  /**
   * Product picture for the line, resolved from the tenant's catalogue
   * (PLN-260920 P4). Null when the line cannot be matched — the client draws a
   * placeholder rather than shifting the layout.
   */
  imageUrl?: string | null;
}

/**
 * One purchased line the shopper can review — the widget's Review chip
 * (PLN-260923 P3). Only lines from delivered orders are listed.
 */
export interface ReviewItemResponse {
  /** order_items.id — also what POST /reviews takes (the in-widget fallback form). */
  orderItemId: string;
  orderId: string;
  orderNumber: string;
  title: string;
  optionText: string | null;
  price: number | null;
  currency: string | null;
  imageUrl: string | null;
  /**
   * The product's storefront page, where the store's review form lives. Null
   * when the order did not carry one — the widget then opens its own form.
   */
  productUrl: string | null;
  /** The shopper already reviewed this line (a `reviews` row exists). */
  reviewed: boolean;
  /** When the order was placed (ISO), for the row's relative date. */
  orderedAt: string;
}

/** Flat: the order's own fields sit alongside `items` — never `{ order, items }`. */
export interface OrderDetailResponse {
  id: string;
  orderNumber: string;
  statusInternal: string | null;
  statusUi: string | null;
  total: number | null;
  /**
   * Money breakdown behind the total (PLN-260920 P2). Every field is nullable
   * and additive: an order cached before the columns existed carries none, and
   * the client hides the row rather than rendering a 0 it was never told.
   */
  subtotal?: number | null;
  discountTotal?: number | null;
  shippingTotal?: number | null;
  /**
   * Summed line QUANTITY — "Subtotal · 3 items". Deliberately not `itemCount`:
   * the list DTO already uses that name for the number of line rows.
   */
  itemQty?: number | null;
  currency: string | null;
  createdAt: string;
  /** When the order was placed on the platform; null for rows that predate it. */
  orderedAt: string | null;
  /**
   * The shopper's own contact pair, shown in the order detail (PLN-260920 P3).
   * Only ever the bound customer's own data — the detail route refuses any
   * order that is not theirs.
   */
  contactName?: string | null;
  contactEmail?: string | null;
  items: OrderItemResponse[];
}

/**
 * `steps` are localized LABELS and progress comes from `stepIndex` — there is no
 * per-step object.
 */
export interface TrackingResponse {
  status: string;
  carrier: string | null;
  trackingNumber: string | null;
  /**
   * The carrier's own tracking page (PLN-260923 P2): the platform's link, else
   * one built from carrier + number, else null (widget keeps its stepper).
   * Optional so a server that predates it reads as "no link".
   */
  trackingUrl?: string | null;
  stepIndex: number;
  steps: string[];
}

// ---- notifications ------------------------------------------------------
export interface NotificationResponse {
  id: string;
  category: string;
  title: string;
  body: string | null;
  statusBadge: string | null;
  /** Deep-link target (campaign product/url — A-9); client routes on tap. */
  linkUrl: string | null;
  /**
   * In-app record this notification is about — currently only `'order_item'`,
   * set by review requests so the client can open the review form for the right
   * item (PLN-260817 S5). Null on every row written before it existed.
   */
  refType: string | null;
  /** Id of `refType`'s record. BIGINT, so a string on the wire. */
  refId: string | null;
  channel: string;
  /** Derived server-side from `readAt != null`. */
  read: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPrefResponse {
  id: string;
  channel: string;
  category: string;
  /** Boolean on the wire; the column is a tinyint. */
  enabled: boolean;
}

export interface UnreadCountResponse {
  count: number;
}

// ---- affiliate ----------------------------------------------------------
/** Note: with no affiliate row the endpoint 404s — there is no 'none' status. */
export interface AffiliateStatusResponse {
  status: string;
  linkCode: string | null;
  commissionRate: number;
}

// ---- scenario menu ------------------------------------------------------
export interface ScenarioButtonResponse {
  /** Action slug (e.g. 'delivery_status'), not a numeric id. */
  id: string;
  label: string;
  action: string;
  enabled: boolean;
}

export interface ScenarioConfigResponse {
  scenarioButtons: ScenarioButtonResponse[];
}
