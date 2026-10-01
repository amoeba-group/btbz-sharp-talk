-- 261001-tenant-privacy-notice-copy.sql — consent notice copy per tenant
-- (PLN-261001 §2).
--
-- The notice text lived only in the widget bundle, written for a store: a
-- lodging tenant's shoppers were told we collect their "order lookups". The
-- copy now comes from the server — an industry profile supplies it and a tenant
-- may rewrite individual lines.
--
-- Both columns NULL = nothing configured, which resolves to the profile implied
-- by `commerce_enabled`. No tenant's notice changes until someone chooses.
-- Idempotence: guard with `SHOW COLUMNS FROM tenants LIKE 'privacy_profile'`.

ALTER TABLE `tenants`
  ADD COLUMN `privacy_profile` varchar(16) DEFAULT NULL AFTER `consent_notice_version`,
  ADD COLUMN `privacy_notice_copy` json DEFAULT NULL AFTER `privacy_profile`;
