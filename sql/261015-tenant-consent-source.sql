-- 261015-tenant-consent-source.sql — where widget consent comes from
-- (PLN-261015-SharpTalk-for-Go2Joy D9)
--
-- 'widget' (default) = the visitor accepts the banner, exactly as today.
-- 'host_terms' = the host app's own terms cover AI support (Go2Joy Hotel Admin):
-- a user the host SIGNS (verified /public/embed/identify) is recorded as
-- consented with time + notice version; unsigned visitors still get the banner.
-- Default 'widget' keeps every existing tenant unchanged.
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Run BEFORE deploying the backend (old code + new column = safe).
-- Idempotence: guard with `SHOW COLUMNS FROM tenants LIKE 'consent_source'`.

ALTER TABLE `tenants`
  ADD COLUMN `consent_source` varchar(16) NOT NULL DEFAULT 'widget';

-- Rollback (old code never reads it): ALTER TABLE `tenants` DROP COLUMN `consent_source`;
