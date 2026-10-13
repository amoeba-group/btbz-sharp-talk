-- 261016-tenant-partner-data-flag.sql — per-tenant switch for the partner-data lookup (PLN-261012 SG-31).
--
-- 0 (default) = the assistant never calls the partner data API for this tenant and its
-- chat behaves byte-identically to before. 1 = signed-in hotel users' questions about
-- rates / policies / bookings / settlement are answered from the partner API — but only
-- while the server-wide PARTNER_DATA_ENABLED env is also on (both must be on).
-- Additive, NOT NULL DEFAULT 0 — old code ignores it, so apply BEFORE deploying the code
-- (staging runs DB_SYNCHRONIZE=false; new code selects the column).
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard with `SHOW COLUMNS FROM tenants LIKE 'partner_data_enabled'`.

ALTER TABLE `tenants`
  ADD COLUMN `partner_data_enabled` tinyint(1) NOT NULL DEFAULT 0;

-- Rollback: ALTER TABLE `tenants` DROP COLUMN `partner_data_enabled`;
