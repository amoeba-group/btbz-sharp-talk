-- 261007-ai-engine-health.sql — what each AI engine last did, and whether
-- tenants may pick a platform engine (PLN-261007-AI-Engine-Status S1, D1).
--
-- last_ok_at / last_error_* are written by the gateway on real calls and by the
-- connection test. They exist because the 2026-10-06 go2joy outage (credit
-- balance exhausted, 365 failed calls) was visible only in server logs.
-- tenant_selectable (platform engines only): 0 = tenants see it but cannot
-- choose it — choosing a platform engine bills the operator's key (D1).
-- Default 0 keeps today's behaviour for tenants and adds no new spend.
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard with `SHOW COLUMNS FROM ai_engines LIKE 'last_ok_at'`.

ALTER TABLE `ai_engines`
  ADD COLUMN `last_ok_at` datetime NULL,
  ADD COLUMN `last_error_at` datetime NULL,
  ADD COLUMN `last_error_reason` varchar(24) NULL,
  ADD COLUMN `last_error_detail` varchar(255) NULL,
  ADD COLUMN `tenant_selectable` tinyint(1) NOT NULL DEFAULT 0;

-- Rollback (after reverting the code):
-- ALTER TABLE `ai_engines` DROP COLUMN `last_ok_at`, DROP COLUMN `last_error_at`,
--   DROP COLUMN `last_error_reason`, DROP COLUMN `last_error_detail`, DROP COLUMN `tenant_selectable`;
