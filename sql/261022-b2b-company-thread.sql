-- 261022-b2b-company-thread.sql — B2B company customers + account-level conversation threads
-- (PLN-261022-Go2Joy-HA-B2B-Identity-Continuity, stage 2)
--
-- companies            one row per business customer (Go2Joy: a partner hotel). external_key =
--                      'hotel:{hotel_id}' from a SIGNED identify; name/province/region refreshed on
--                      every identify. last_seen_at = latest identify.
-- company_contacts     company ↔ contact (customers row of type b2b_contact). A chain operator
--                      belongs to several companies; role = the signed role at last identify.
-- customers.customer_type   'b2c' (default — every existing row) | 'b2b_contact'.
-- sessions.company_id       the company the session's signed identify named (NULL = none).
-- conversations.customer_id / company_id   the account the thread belongs to, written when the
--                      conversation is created (and when an identify lands on an open one).
-- conversations.prev_conversation_id       the account thread's previous conversation (sticky agent).
-- tenants.thread_continuity  1 = widget shows the account's earlier conversations and the AI sees
--                      the previous one. Default 0 → no tenant changes behaviour.
--
-- Backfill: conversations.customer_id from their session (history lookups only; no behaviour change).
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard each ALTER with `SHOW COLUMNS … LIKE '<col>'`; CREATE uses IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS `companies` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `tenant_id` BIGINT NOT NULL,
  `external_key` VARCHAR(120) NOT NULL,
  `name` VARCHAR(200) NULL,
  `province` VARCHAR(120) NULL,
  `region` VARCHAR(32) NULL,
  `last_seen_at` DATETIME NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_companies_tenant_key` (`tenant_id`, `external_key`),
  KEY `idx_companies_tenant_region` (`tenant_id`, `region`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `company_contacts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `tenant_id` BIGINT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `customer_id` BIGINT NOT NULL,
  `role` VARCHAR(120) NULL,
  `last_seen_at` DATETIME NULL,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_company_contacts` (`company_id`, `customer_id`),
  KEY `idx_company_contacts_customer` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `customers`
  ADD COLUMN `customer_type` VARCHAR(16) NOT NULL DEFAULT 'b2c';

ALTER TABLE `sessions`
  ADD COLUMN `company_id` BIGINT NULL;
CREATE INDEX `idx_sessions_company` ON `sessions` (`company_id`);

ALTER TABLE `conversations`
  ADD COLUMN `customer_id` BIGINT NULL;
ALTER TABLE `conversations`
  ADD COLUMN `company_id` BIGINT NULL;
ALTER TABLE `conversations`
  ADD COLUMN `prev_conversation_id` BIGINT NULL;
CREATE INDEX `idx_conv_tenant_company` ON `conversations` (`tenant_id`, `company_id`, `id`);
CREATE INDEX `idx_conv_tenant_customer` ON `conversations` (`tenant_id`, `customer_id`, `id`);

ALTER TABLE `tenants`
  ADD COLUMN `thread_continuity` TINYINT(1) NOT NULL DEFAULT 0;

-- Backfill (safe to re-run): the session's customer is the conversation's account.
UPDATE `conversations` c
  JOIN `sessions` s ON s.id = c.session_id
   SET c.customer_id = s.customer_id
 WHERE c.customer_id IS NULL AND s.customer_id IS NOT NULL;

-- Rollback (after rolling the code back):
-- ALTER TABLE `tenants` DROP COLUMN `thread_continuity`;
-- ALTER TABLE `conversations` DROP INDEX `idx_conv_tenant_customer`, DROP INDEX `idx_conv_tenant_company`,
--   DROP COLUMN `prev_conversation_id`, DROP COLUMN `company_id`, DROP COLUMN `customer_id`;
-- ALTER TABLE `sessions` DROP INDEX `idx_sessions_company`, DROP COLUMN `company_id`;
-- ALTER TABLE `customers` DROP COLUMN `customer_type`;
-- DROP TABLE `company_contacts`; DROP TABLE `companies`;
