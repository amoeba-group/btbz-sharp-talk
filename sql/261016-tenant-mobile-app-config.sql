-- 261016-tenant-mobile-app-config.sql — host MOBILE APP surface settings
-- (PLN-261015-Go2Joy-Kotlin-SDK-0.2 S9)
--
-- JSON: { app: {font, fontSize, menuStyle, header, brand}, entries: [{screen, agentCode, contextLabel}], minSdk }
-- NULL (the default) = never configured = the web widget theme applies to the app unchanged,
-- so every existing tenant behaves exactly as before.
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Run BEFORE deploying the backend (old code + new column = safe).
-- Idempotence: guard with `SHOW COLUMNS FROM tenants LIKE 'mobile_app_config'`.

ALTER TABLE `tenants`
  ADD COLUMN `mobile_app_config` json DEFAULT NULL;

-- Rollback (old code never reads it): ALTER TABLE `tenants` DROP COLUMN `mobile_app_config`;
