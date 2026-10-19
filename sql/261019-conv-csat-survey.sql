-- 261019-conv-csat-survey.sql — satisfaction survey (PLN-261019-Csat-Survey-Disclosure P1)
--
-- conversations: the three answers a `survey`-mode card adds to the 1..5 rating.
--   csat_resolved  1 = "my issue was resolved", 0 = "not yet", NULL = not asked (rating mode / older rows)
--   csat_reason    fixed code for an unhappy rating (unclear | slow | no_response | software_error | other)
--   csat_comment   free text for "other", PII-masked before storage (≤ 50 chars typed, 80 stored for masks)
-- tenants: which card the widget shows, and the terms link the bottom disclosure line points at.
--   csat_mode      'rating' (default, every existing tenant unchanged) | 'survey'
--   terms_url      optional absolute http(s) URL; the widget falls back to privacy_policy_url
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard with `SHOW COLUMNS FROM conversations LIKE 'csat_resolved'` / `... tenants LIKE 'csat_mode'`.

ALTER TABLE `conversations`
  ADD COLUMN `csat_resolved` tinyint(1) NULL,
  ADD COLUMN `csat_reason` varchar(32) NULL,
  ADD COLUMN `csat_comment` varchar(80) NULL;

-- terms_url first: the manifest parser stops at the first quote, so the quoted default goes last.
ALTER TABLE `tenants`
  ADD COLUMN `terms_url` varchar(512) NULL,
  ADD COLUMN `csat_mode` varchar(8) NOT NULL DEFAULT 'rating';

-- Rollback:
-- ALTER TABLE `conversations` DROP COLUMN `csat_resolved`, DROP COLUMN `csat_reason`, DROP COLUMN `csat_comment`;
-- ALTER TABLE `tenants` DROP COLUMN `csat_mode`, DROP COLUMN `terms_url`;
