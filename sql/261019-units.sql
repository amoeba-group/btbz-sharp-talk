-- 261019-units.sql — tenant teams (units) + user membership + default rows
-- (PLN-261019-Users-Unit-Labels-Routing-Conditions P1)
--
-- units            one row per tenant team: code (stable slug, never changes), name (editable),
--                  sort_order. Unlike job_labels a unit code carries no permission.
-- users.unit_id    the user's team (at most one); NULL = unassigned.
--
-- Backfill: every tenant with no units gets cs / mkt / management (Korean names when
-- tenants.default_language = 'ko', English otherwise). The go2joy tenant (by slug)
-- additionally gets its four region teams. Job-label names that are still the seed's
-- Korean defaults on a non-Korean tenant are switched to the English defaults (D2);
-- a renamed label is left alone. Idempotent: every INSERT/UPDATE is guarded.
-- No `AFTER <col>` on the users ALTER: a database behind on earlier migrations would refuse it.

CREATE TABLE IF NOT EXISTS `units` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `tenant_id` BIGINT NOT NULL,
  `code` VARCHAR(24) NOT NULL,
  `name` VARCHAR(64) NOT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_unit_tenant_code` (`tenant_id`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Idempotence: guard with `SHOW COLUMNS FROM users LIKE 'unit_id'`.
ALTER TABLE `users`
  ADD COLUMN `unit_id` BIGINT NULL;

-- Default teams for tenants that have none.
INSERT INTO `units` (`tenant_id`, `code`, `name`, `sort_order`)
SELECT t.`id`, d.`code`,
       CASE WHEN LOWER(COALESCE(t.`default_language`, '')) = 'ko' THEN d.`ko` ELSE d.`en` END,
       d.`sort_order`
FROM `tenants` t
CROSS JOIN (
  SELECT 'cs' AS `code`, '고객지원팀' AS `ko`, 'CS' AS `en`, 10 AS `sort_order`
  UNION ALL SELECT 'mkt', '마케팅팀', 'MKT', 20
  UNION ALL SELECT 'management', '운영팀', 'Management', 30
) d
WHERE NOT EXISTS (SELECT 1 FROM `units` u WHERE u.`tenant_id` = t.`id`);

-- go2joy region teams (tenant found by slug; no-op where the tenant does not exist).
INSERT INTO `units` (`tenant_id`, `code`, `name`, `sort_order`)
SELECT t.`id`, d.`code`, d.`name`, d.`sort_order`
FROM `tenants` t
CROSS JOIN (
  SELECT 'north' AS `code`, 'North' AS `name`, 40 AS `sort_order`
  UNION ALL SELECT 'north_center', 'North Center', 50
  UNION ALL SELECT 'south', 'South', 60
  UNION ALL SELECT 'south_center', 'South Center', 70
) d
WHERE t.`slug` = 'go2joy'
  AND NOT EXISTS (SELECT 1 FROM `units` u WHERE u.`tenant_id` = t.`id` AND u.`code` = d.`code`);

-- D2: English default label names for non-Korean tenants whose names are still the seed defaults.
CREATE TABLE IF NOT EXISTS `job_labels_bak_261019` AS SELECT * FROM `job_labels`;
UPDATE `job_labels` jl
JOIN `tenants` t ON t.`id` = jl.`tenant_id`
SET jl.`name` = CASE jl.`code`
  WHEN 'consult' THEN 'Counsels'
  WHEN 'accounting' THEN 'Accountant'
  WHEN 'operations' THEN 'Operation'
  ELSE jl.`name` END
WHERE LOWER(COALESCE(t.`default_language`, '')) <> 'ko'
  AND ((jl.`code` = 'consult' AND jl.`name` = '상담')
    OR (jl.`code` = 'accounting' AND jl.`name` = '회계')
    OR (jl.`code` = 'operations' AND jl.`name` = '운영'));

-- Rollback:
-- UPDATE job_labels jl JOIN job_labels_bak_261019 b ON b.id = jl.id SET jl.name = b.name;
-- DROP TABLE job_labels_bak_261019;
-- ALTER TABLE `users` DROP COLUMN `unit_id`;
-- DROP TABLE `units`;
