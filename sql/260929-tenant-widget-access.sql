-- 260929-tenant-widget-access.sql — widget exposure restriction (PLN-260929).
--
-- "Show the widget only from these IPs or these URLs, only during this window,
-- plus whoever holds the invite key." Two columns, mirroring how the tenant
-- already stores this kind of setting: the list/window as JSON (like
-- `embed_origins`) and the invite key encrypted (like `embed_secret`).
--
-- NULL `widget_access` = the feature was never configured, which is the same as
-- switched off — no behaviour change for any existing tenant.
-- Idempotence: guard with `SHOW COLUMNS FROM tenants LIKE 'widget_access'`.

ALTER TABLE `tenants`
  ADD COLUMN `widget_access` json DEFAULT NULL AFTER `embed_origins`,
  ADD COLUMN `widget_access_key` varbinary(512) DEFAULT NULL AFTER `widget_access`;
