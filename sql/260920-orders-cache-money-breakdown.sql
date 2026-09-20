-- 260920-orders-cache-money-breakdown.sql — order money breakdown (PLN-260920 P2).
-- The widget's order detail showed a single Total because that is all the cache
-- kept. Shopify hands the rest back inside `read_orders` (no new scope), so the
-- four numbers behind "Discount / Subtotal · N items / Shipping / Total" get
-- columns. All nullable on purpose: an order synced before this ships has no
-- breakdown, and the widget hides those rows rather than drawing them as 0.
-- Idempotence: guard with `SHOW COLUMNS FROM orders_cache LIKE 'subtotal'`.

ALTER TABLE `orders_cache`
  ADD COLUMN `subtotal` decimal(12,2) DEFAULT NULL AFTER `total`,
  ADD COLUMN `discount_total` decimal(12,2) DEFAULT NULL AFTER `subtotal`,
  ADD COLUMN `shipping_total` decimal(12,2) DEFAULT NULL AFTER `discount_total`,
  ADD COLUMN `item_qty` int DEFAULT NULL AFTER `shipping_total`;
