-- 261001-tenant-commerce-enabled.sql — does this tenant sell things shoppers
-- can order? (PLN-261001-Go2Joy-Partner-Widget S0)
--
-- 1 (default) = a store: the chat asks a guest to sign in before answering
-- order questions, and replies end with My orders / Shipping / Returns chips.
-- 0 = no orders to look up (a hotel partner desk, a B2B help desk): that gate is
-- skipped and the chips come from the tenant's own scenario buttons.
-- Default 1 keeps every existing tenant exactly as it was.
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard with `SHOW COLUMNS FROM tenants LIKE 'commerce_enabled'`.

ALTER TABLE `tenants`
  ADD COLUMN `commerce_enabled` tinyint(1) NOT NULL DEFAULT 1;

-- Rollback: ALTER TABLE `tenants` DROP COLUMN `commerce_enabled`;
