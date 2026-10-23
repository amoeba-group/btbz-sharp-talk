-- 261024-company-profile-products.sql — B2B company profile + room types as per-company products
-- (PLN-261023-Go2Joy-HA-Hotel-Profile-RoomTypes)
--
-- companies
--   code / phone / district / address   operator-entered (console) until the host sends them (A, later)
--   profile JSON                        operator-entered rest: group, flags, contract, payment, hotel type,
--                                       enterprise name / registration no., extra fee, descriptions, policies
--   partner_info JSON                   read from the Go2Joy Partner API (hours, cancellation policy, name)
--   partner_synced_at / partner_sync_error   last Partner sync outcome
--   profile_updated_at / profile_updated_by  last console edit (user id)
-- products_cache
--   company_id     the B2B company a product belongs to (Go2Joy room type → its hotel). NULL = store catalogue
--   source         'go2joy_partner' for room types; NULL = storefront sync (unchanged)
--   attributes     room-type details (HA status code, hours, list prices, bed, size, facilities, images, room count)
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard each ALTER with `SHOW COLUMNS FROM <table> LIKE '<col>'`.

ALTER TABLE `companies`
  ADD COLUMN `code` VARCHAR(64) NULL,
  ADD COLUMN `phone` VARCHAR(40) NULL,
  ADD COLUMN `district` VARCHAR(120) NULL,
  ADD COLUMN `address` VARCHAR(500) NULL,
  ADD COLUMN `profile` JSON NULL,
  ADD COLUMN `partner_info` JSON NULL,
  ADD COLUMN `partner_synced_at` DATETIME NULL,
  ADD COLUMN `partner_sync_error` VARCHAR(255) NULL,
  ADD COLUMN `profile_updated_at` DATETIME NULL,
  ADD COLUMN `profile_updated_by` BIGINT NULL;

ALTER TABLE `products_cache`
  ADD COLUMN `company_id` BIGINT NULL,
  ADD COLUMN `source` VARCHAR(16) NULL,
  ADD COLUMN `attributes` JSON NULL;
CREATE INDEX `idx_prdc_tenant_company` ON `products_cache` (`tenant_id`, `company_id`);

-- Rollback:
-- DROP INDEX `idx_prdc_tenant_company` ON `products_cache`;
-- ALTER TABLE `products_cache` DROP COLUMN `attributes`, DROP COLUMN `source`, DROP COLUMN `company_id`;
-- ALTER TABLE `companies` DROP COLUMN `profile_updated_by`, DROP COLUMN `profile_updated_at`,
--   DROP COLUMN `partner_sync_error`, DROP COLUMN `partner_synced_at`, DROP COLUMN `partner_info`,
--   DROP COLUMN `profile`, DROP COLUMN `address`, DROP COLUMN `district`, DROP COLUMN `phone`, DROP COLUMN `code`;
