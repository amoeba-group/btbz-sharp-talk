import type { TabKey } from '../../store/widgetStore';

export interface ChipDef {
  key: string;
  labelKey: string;
}

/**
 * Chips that read the notification feed itself.
 * `all` is the catch-all view, `event` is coupons and campaigns.
 */
const NOTICE_CHIPS: ChipDef[] = [
  { key: 'all', labelKey: 'notifications.filters.all' },
  { key: 'event', labelKey: 'notifications.filters.event' },
];

/**
 * Chips about a shopper's orders. `inquiries` is a sixth chip the design does
 * not show (PLN-260817 §7 D-3) — it is the only home the shipped issue feed has.
 *
 * `orders` leads, and it is the order LIST rather than a notification filter.
 * It replaced a `payment` chip that read the notification feed: the Orders tab
 * opened on it, and across the whole staging database not one `payment`
 * notification had ever been written, so the tab named for orders opened empty
 * for every shopper (REQ-260818-Widget-Orders-Tab C-1). Payment notices still
 * reach the Notifications tab's `all`, so nothing was taken away.
 */
const ORDER_CHIPS: ChipDef[] = [
  { key: 'orders', labelKey: 'notifications.filters.orders' },
  { key: 'shipping', labelKey: 'notifications.filters.shipping' },
  { key: 'review', labelKey: 'notifications.filters.review' },
  { key: 'inquiries', labelKey: 'notifications.filters.inquiries' },
];

/** Tenant facts that change the chip bar beyond the tab layout itself. */
export interface ChipOptions {
  /**
   * The tenant runs an issue workflow (`workflow_mode` native/bridge), so the
   * shopper has an inquiry feed worth a chip. Only consulted by the single
   * list-tab bar — see chipsFor.
   */
  inquiries?: boolean;
}

/**
 * Which chips a given list tab shows, given the tenant's tab configuration
 * (PLN-260817-Widget-Tab-Config W-5).
 *
 * There are only two list-shaped tabs, notifications and orders. When both are
 * on they split the chips by subject; when only one is on it absorbs the other's
 * chips, because otherwise switching a tab off would silently delete features —
 * a shopper with the orders tab disabled must still be able to track a shipment.
 */
export function chipsFor(tab: TabKey, visibleTabs: TabKey[], opts: ChipOptions = {}): ChipDef[] {
  const bothPresent =
    visibleTabs.includes('notifications') && visibleTabs.includes('orders');
  if (bothPresent) return tab === 'orders' ? ORDER_CHIPS : NOTICE_CHIPS;
  // One list tab absorbs the other's chips, in the design's single bar
  // (PLN-260923 P1): All · Payment · Delivery · Event · Review.
  //  - `orders` is still the order LIST; beside "All" with no Orders tab next
  //    to it the design calls it Payment, so only the label moves.
  //  - `inquiries` is not in that design. It is the only home of the issue
  //    feed, so it stays for tenants that actually run an issue workflow and
  //    goes for everyone else, where it could only ever be empty (D-2).
  const [orders, shipping, review, inquiries] = ORDER_CHIPS;
  const chips: ChipDef[] = [
    NOTICE_CHIPS[0],
    { ...orders, labelKey: 'notifications.filters.payment' },
    shipping,
    NOTICE_CHIPS[1],
    review,
  ];
  return opts.inquiries ? [...chips, inquiries] : chips;
}

/** The chip a tab starts on — always its own first. */
export function defaultChip(tab: TabKey, visibleTabs: TabKey[], opts: ChipOptions = {}): string {
  return chipsFor(tab, visibleTabs, opts)[0]?.key ?? 'all';
}

/** True when `filter` is one this tab actually renders. */
export function chipBelongsTo(
  filter: string,
  tab: TabKey,
  visibleTabs: TabKey[],
  opts: ChipOptions = {},
): boolean {
  return chipsFor(tab, visibleTabs, opts).some((c) => c.key === filter);
}
