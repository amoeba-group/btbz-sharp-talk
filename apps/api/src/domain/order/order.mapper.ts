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

  static toItemView(item: OrderItem): OrderItemView {
    return {
      id: String(item.id),
      title: item.title,
      optionText: item.optionText,
      qty: item.qty,
      price: item.price,
    };
  }

  static toDetail(order: OrderCache, items: OrderItem[]): OrderDetailView {
    return {
      id: String(order.id),
      orderNumber: order.orderNumber,
      statusInternal: order.statusInternal,
      statusUi: this.uiStatus(order),
      total: order.total,
      subtotal: order.subtotal,
      discountTotal: order.discountTotal,
      shippingTotal: order.shippingTotal,
      itemQty: order.itemQty,
      currency: order.currency,
      createdAt: order.createdAt.toISOString(),
      orderedAt: order.orderedAt ? order.orderedAt.toISOString() : null,
      items: items.map((i) => this.toItemView(i)),
    };
  }
}
