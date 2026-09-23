-- PLN-260923 P3: the widget's Review chip links each purchased line to the
-- product's own page, where the store's review form lives.
--
-- The URL has to come from the ORDER: the catalogue cache is synced from the
-- tenant's storefront, which is not necessarily the shop the orders came from
-- (ivyusa.com vs ambshop-dev), so a catalogue join misses. The GraphQL rich
-- tier (read_products) reads `product { handle onlineStoreUrl }` per line.
--
-- Nothing backfills here: existing lines fill in on their next sync window,
-- and a line without a URL falls back to the in-widget review form.
-- Apply BEFORE deploying the code.

ALTER TABLE `order_items`
  ADD COLUMN `product_url` varchar(1024) NULL;

-- Rollback:
-- ALTER TABLE `order_items` DROP COLUMN `product_url`;
