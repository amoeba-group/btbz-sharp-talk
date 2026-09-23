-- PLN-260923 P2: the widget's Track opens the carrier's own tracking page.
--
-- Shopify hands us `tracking_url` on every fulfillment webhook and we dropped
-- it. Rows written before this ships keep NULL; the API then builds a URL from
-- the carrier name + tracking number (packages/common carrier-tracking), and
-- only when both are missing does the widget fall back to the inline stepper.
--
-- Also backfills `tenant_id`: `applyFulfillment` created rows without it (one
-- NULL row on staging, 2026-09-22). The code now writes it; this repairs the
-- rows already there from their order. Apply BEFORE deploying the code.

ALTER TABLE `fulfillments`
  ADD COLUMN `tracking_url` varchar(1024) NULL AFTER `carrier`;

UPDATE `fulfillments` f
  JOIN `orders_cache` o ON o.id = f.order_id
   SET f.tenant_id = o.tenant_id
 WHERE f.tenant_id IS NULL;

-- Rollback (the tenant_id backfill is a repair and is not undone):
-- ALTER TABLE `fulfillments` DROP COLUMN `tracking_url`;
