-- 261019-tenant-widget-languages.sql — languages a tenant's widget offers (PLN-261019-Widget-Language-Follow-Selection P1)
--
-- tenants.widget_languages  JSON array of language codes in display order, e.g. ["vi","en"].
--   NULL = every registered language (today's behaviour, so no existing tenant changes).
--   English is always offered: the server adds it when the saved list lacks it.
--   Governs the widget's language picker, which session languages may be chosen or
--   auto-detected, and the start language (a browser language outside the list → English).
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard with `SHOW COLUMNS FROM tenants LIKE 'widget_languages'`.

ALTER TABLE `tenants`
  ADD COLUMN `widget_languages` json NULL;

-- Rollback:
-- ALTER TABLE `tenants` DROP COLUMN `widget_languages`;
