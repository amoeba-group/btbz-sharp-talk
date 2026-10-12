-- 261007-user-role-region.sql — PLN-261007: Sales Admin role label + user region.
--
-- 1) users.region: operational area of a tenant user (north | south), NULL = nationwide.
--    Additive, nullable — old code ignores it, so apply BEFORE deploying the code
--    (staging runs DB_SYNCHRONIZE=false).
-- 2) job_labels: every existing tenant gets the new `sales_admin` label row (new
--    tenants receive it from the tenant seed). Idempotent: skips tenants that
--    already have one.
-- Rollback: ALTER TABLE `users` DROP COLUMN `region`; DELETE FROM `job_labels` WHERE `code` = 'sales_admin'
--           (only after unassigning it from users: user_job_labels rows reference the label id).

-- The label name is Korean: force the client charset so a `mysql < file` run from
-- a shell with a latin1 default does not store mojibake (seen on dev 2026-10-07).
SET NAMES utf8mb4;

ALTER TABLE `users`
  ADD COLUMN `region` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `status`;

INSERT INTO `job_labels` (`tenant_id`, `code`, `name`)
SELECT t.`id`, 'sales_admin', '영업관리'
FROM `tenants` t
WHERE NOT EXISTS (
  SELECT 1 FROM `job_labels` jl WHERE jl.`tenant_id` = t.`id` AND jl.`code` = 'sales_admin'
);
