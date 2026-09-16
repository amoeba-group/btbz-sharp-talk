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

/**
 * Which chips a given list tab shows, given the tenant's tab configuration
 * (PLN-260817-Widget-Tab-Config W-5).
 *
 * There are only two list-shaped tabs, notifications and orders. When both are
 * on they split the chips by subject; when only one is on it absorbs the other's
 * chips, because otherwise switching a tab off would silently delete features —
 * a shopper with the orders tab disabled must still be able to track a shipment.
 */
export function chipsFor(tab: TabKey, visibleTabs: TabKey[]): ChipDef[] {
  const bothPresent =
    visibleTabs.includes('notifications') && visibleTabs.includes('orders');
  // One list tab absorbs the other's chips. Order follows the design's single
  // bar (PLN-260916 P3): All · Orders · Shipping · Event · Review · Inquiries.
  if (!bothPresent) return [NOTICE_CHIPS[0], ORDER_CHIPS[0], ORDER_CHIPS[1], NOTICE_CHIPS[1], ORDER_CHIPS[2], ORDER_CHIPS[3]];
  return tab === 'orders' ? ORDER_CHIPS : NOTICE_CHIPS;
}

/** The chip a tab starts on — always its own first. */
export function defaultChip(tab: TabKey, visibleTabs: TabKey[]): string {
  return chipsFor(tab, visibleTabs)[0]?.key ?? 'all';
}

/** True when `filter` is one this tab actually renders. */
export function chipBelongsTo(filter: string, tab: TabKey, visibleTabs: TabKey[]): boolean {
  return chipsFor(tab, visibleTabs).some((c) => c.key === filter);
}
