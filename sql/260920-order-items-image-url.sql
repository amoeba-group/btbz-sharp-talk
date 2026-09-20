-- 260920-order-items-image-url.sql — the picture of what was actually bought
-- (PLN-260920 §7 follow-up, read_products).
--
-- P4 resolved line pictures through the catalogue cache, but the catalogue is
-- synced from the tenant's STOREFRONT and the orders come from the connected
-- SHOP — at ivyusa those are two different stores (ivyusa.com vs
-- ambshop-dev.myshopify.com), so the join matched nothing. With read_products
-- the order itself carries the variant/product image, so store it on the line.
-- Catalogue resolution stays as the fallback for lines that arrive without one.
-- Idempotence: guard with `SHOW COLUMNS FROM order_items LIKE 'image_url'`.

ALTER TABLE `order_items`
  ADD COLUMN `image_url` varchar(1024) DEFAULT NULL AFTER `option_text`;
