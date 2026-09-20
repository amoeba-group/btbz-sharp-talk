-- 260920-products-cache-external-id.sql — catalogue ↔ order line join key
-- (PLN-260920 P4). The catalogue is keyed on `handle` (a storefront concept),
-- while an order line carries the platform's numeric product id. Without a
-- column holding that id there is no way to put the product's picture next to
-- the line the shopper bought. The public /products.json already returns it.
-- Not a unique key: `handle` remains the import identity, and a storefront that
-- omits the id simply leaves this NULL.
-- Idempotence: guard with `SHOW COLUMNS FROM products_cache LIKE 'external_id'`.

ALTER TABLE `products_cache`
  ADD COLUMN `external_id` varchar(64) DEFAULT NULL AFTER `handle`,
  ADD KEY `idx_prdc_tenant_ext` (`tenant_id`,`external_id`);
