-- PLN-260920: widget impression / access statistics.
--
-- A `sessions` row is already created on every storefront page load, so it is
-- the impression log. These three columns turn it into the access log too:
-- which page the widget appeared on, and how often the shopper opened it.
--
-- Nothing backfills: rows written before this ships keep NULL/0, which the
-- console shows as "collected from <date>". Apply BEFORE deploying the code.

ALTER TABLE `sessions`
  ADD COLUMN `landing_path` varchar(255) NULL AFTER `channel`,
  ADD COLUMN `open_count` int NOT NULL DEFAULT 0 AFTER `landing_path`,
  ADD COLUMN `first_opened_at` datetime NULL AFTER `open_count`;

-- Per-path grouping is the one new read pattern (top pages by impressions).
ALTER TABLE `sessions`
  ADD INDEX `idx_sessions_tenant_path` (`tenant_id`, `landing_path`);

-- Rollback:
-- ALTER TABLE `sessions` DROP INDEX `idx_sessions_tenant_path`;
-- ALTER TABLE `sessions`
--   DROP COLUMN `first_opened_at`, DROP COLUMN `open_count`, DROP COLUMN `landing_path`;
