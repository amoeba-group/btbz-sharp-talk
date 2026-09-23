/**
 * Widget-side view of the API contracts.
 *
 * The response shapes are NOT redeclared here — they are imported from
 * `@sharptalk/types`, the same file the API mappers return. That is deliberate: this
 * file used to hand-maintain its own copies, nothing compared the two, and they
 * drifted into runtime crashes (an order detail typed `{ order, items }` against a
 * flat payload took the whole widget down). Now a backend shape change that the
 * widget doesn't expect is a compile error instead.
 *
 * Only genuinely client-side concepts are defined locally: the narrowed unions the
 * UI switches on, and fields that exist solely in local optimistic state.
 */
import type {
  AffiliateStatusResponse,
  ChatCitation,
  ChatAttachmentResponse,
  ChatMessageResponse,
  ChatTurnResponse,
  ConversationResponse,
  NotificationPrefResponse,
  NotificationResponse,
  OrderDetailResponse,
  OrderItemResponse,
  ReviewItemResponse,
  OrderListItemResponse,
  OrderLookupResponse,
  ScenarioButtonResponse,
  ScenarioFollowUpResponse,
  ScenarioPostActionResponse,
  ScenarioTurnResponse,
  SessionResponse,
  TrackingResponse,
} from '@sharptalk/types';

export type { SessionResponse };
export type {
  WidgetCopy,
  WidgetCopyText,
  WidgetLoginMode,
  WidgetTab,
  WidgetTabPosition,
  WidgetTheme,
  WidgetLogo,
} from '@sharptalk/types';

/** Narrowed for the UI's sender switch; the wire type is a plain string. */
export type SenderType = 'user' | 'ai' | 'agent' | 'system';

export type Citation = ChatCitation;

/**
 * Narrowed for the UI's consent switch. `SessionResponse` is NOT redeclared here —
 * it comes from `@sharptalk/types` above, including the privacy-notice fields, so the
 * consent UI cannot drift from what the session mapper actually sends.
 */
export type ConsentState = 'pending' | 'granted' | 'declined';

export interface ConsentResult {
  consentState: ConsentState | string;
  consentVersion: string;
}

/**
 * A thread message: the wire shape plus the bits that only exist locally.
 * `senderName` is relaxed to optional because optimistic bubbles the widget builds
 * itself have no agent name — the server always sends the key (possibly null).
 * `senderType` stays the wire's `string`: server values must be assignable, so it
 * cannot be narrowed to SenderType here.
 */
export interface ChatMessage extends Omit<ChatMessageResponse, 'senderName'> {
  senderName?: string | null;
  citations?: Citation[];
  /** Optimistic bubble still in flight — never sent by the server. */
  pending?: boolean;
}

/** A file on a turn (PLN-260814); `url`/`thumbUrl` are signed and short-lived. */
export type ChatAttachment = ChatAttachmentResponse;

export type Conversation = ConversationResponse;
export type ChatReply = ChatTurnResponse;
export type ScenarioFollowUp = ScenarioFollowUpResponse;
export type ScenarioReply = ScenarioTurnResponse;
export type ScenarioPostAction = ScenarioPostActionResponse;

export type OrderSummary = OrderListItemResponse;
export type OrderItem = OrderItemResponse;
export type OrderDetail = OrderDetailResponse;
export type OrderLookupResult = OrderLookupResponse;
export type Tracking = TrackingResponse;
export type ReviewItem = ReviewItemResponse;

export type NotificationCategory =
  | 'payment'
  | 'shipping'
  | 'event'
  | 'review'
  | string;

export type NotificationItem = NotificationResponse;

// 'push' = native mobile push (managed from the mobile app; not surfaced in the
// widget's preference panel — the widget cannot register device tokens).
export type NotifChannel = 'in_app' | 'email' | 'sms' | 'web_push' | 'push';
export type NotifPref = NotificationPrefResponse;

export type AffiliateStatus = AffiliateStatusResponse;

/** Server-driven scenario action keys (admin-configured). */
export type ScenarioActionKey =
  | 'delivery_status'
  | 'cancel_refund'
  | 'product_help'
  | 'contact_support'
  | 'affiliate'
  | 'my_orders'
  | 'message';

export type ScenarioButton = ScenarioButtonResponse;
