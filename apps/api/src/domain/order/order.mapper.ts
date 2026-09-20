import {
  internalToUiStatus,
  type OrderDetailResponse,
  type OrderItemResponse,
  type OrderListItemResponse,
  type OrderLookupResponse,
} from '@sharptalk/types';
import { OrderCache } from './entity/order-cache.entity';
import { OrderItem } from './entity/order-item.entity';

/**
 * Response shapes live in `@sharptalk/types` so the widget consumes the same contract —
 * see the note there. Aliased locally to keep existing call sites readable.
 */
export type OrderSummary = OrderLookupResponse;
export type OrderListItem = OrderListItemResponse;
export type OrderItemView = OrderItemResponse;
export type OrderDetailView = OrderDetailResponse;

/** Entity -> response mapping for orders (camelCase payloads). */
export class OrderMapper {
  private static uiStatus(order: OrderCache): string | null {
    return order.statusInternal ? internalToUiStatus(order.statusInternal) : order.statusUi;
  }

  static toSummary(order: OrderCache): OrderSummary {
    return {
      id: String(order.id),
      orderNumber: order.orderNumber,
      statusUi: this.uiStatus(order),
      total: order.total,
    };
  }

  static toListItem(
    order: OrderCache,
    summary: { count: number; firstTitle: string | null },
  ): OrderListItem {
    return {
      id: String(order.id),
      orderNumber: order.orderNumber,
      statusInternal: order.statusInternal,
      statusUi: this.uiStatus(order),
      total: order.total,
      currency: order.currency,
      createdAt: order.createdAt.toISOString(),
      orderedAt: order.orderedAt ? order.orderedAt.toISOString() : null,
      itemCount: summary.count,
      firstItemTitle: summary.firstTitle,
    };
  }

  /**
   * `imageUrl` here is the CATALOGUE guess. The line's own picture — stored
   * when the order carried one — wins: it is the variant the shopper actually
   * bought, not a lookalike matched by title.
   */
  static toItemView(item: OrderItem, imageUrl?: string | null): OrderItemView {
    return {
      id: String(item.id),
      title: item.title,
      optionText: item.optionText,
      qty: item.qty,
      price: item.price,
      imageUrl: item.imageUrl ?? imageUrl ?? null,
    };
  }

  static toDetail(
    order: OrderCache,
    items: OrderItem[],
    customer?: { name: string | null; email: string | null } | null,
    /** item id → catalogue picture, resolved by the service (PLN-260920 P4). */
    images?: Map<string, string>,
  ): OrderDetailView {
    return {
      id: String(order.id),
      orderNumber: order.orderNumber,
      statusInternal: order.statusInternal,
      statusUi: this.uiStatus(order),
      total: order.total,
      // `?? null` rather than passing the property through: the column is new,
      // so a row built before it existed reads `undefined`, which JSON drops
      // from the response entirely. Null is the answer the contract promises.
      subtotal: order.subtotal ?? null,
      discountTotal: order.discountTotal ?? null,
      shippingTotal: order.shippingTotal ?? null,
      itemQty: order.itemQty ?? null,
      currency: order.currency,
      createdAt: order.createdAt.toISOString(),
      orderedAt: order.orderedAt ? order.orderedAt.toISOString() : null,
      contactName: customer?.name ?? null,
      contactEmail: customer?.email ?? null,
      items: items.map((i) => this.toItemView(i, images?.get(String(i.id)) ?? null)),
    };
  }
}
