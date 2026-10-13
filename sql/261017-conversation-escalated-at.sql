-- 261017-conversation-escalated-at.sql — routing extras (PLN-261012 SG-63 / SG-66 / SG-65, REQ D-10 / D-20).
--
-- conversations.escalated_at: when the conversation became WAITING for a person
--   (stamped by the hand-off / "talk to an agent" paths, re-stamped by a re-route,
--   cleared when the thread is handed back to the AI). The console shows the age of
--   each waiting row from it and the unclaimed-alert sweeper counts from it.
--   NULL = not escalated, or a waiting row from before this migration (those are left
--   alone by the sweeper — no burst of pages on deploy).
-- conversations.unclaimed_pages / unclaimed_paged_at: how many "UNCLAIMED" re-pages the
--   sweeper has sent for the current waiting spell and when the last one went out. They
--   are the de-dupe latch (no re-page on every tick, a cap per conversation) and live
--   on the row so a restart or a second API instance cannot page twice.
-- conversations.support_region_hint: the province a signed partner sent that the
--   tenant's region table does not list. Persisted so the queue can show a "?" badge
--   (province in the tooltip) and filter on it; support_region stays NULL for such a row.
-- Additive, nullable/defaulted — old code ignores all four, so apply BEFORE deploying
-- the code (staging runs DB_SYNCHRONIZE=false).
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard each with `SHOW COLUMNS FROM conversations LIKE '<col>'`.

-- One statement per column, so a half-applied file can be finished by re-running only the
-- statements whose column is still missing.
ALTER TABLE `conversations`
  ADD COLUMN `escalated_at` datetime DEFAULT NULL;
ALTER TABLE `conversations`
  ADD COLUMN `unclaimed_pages` tinyint unsigned NOT NULL DEFAULT '0';
ALTER TABLE `conversations`
  ADD COLUMN `unclaimed_paged_at` datetime DEFAULT NULL;
ALTER TABLE `conversations`
  ADD COLUMN `support_region_hint` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL;

-- Rollback:
--   ALTER TABLE `conversations` DROP COLUMN `support_region_hint`, DROP COLUMN `unclaimed_paged_at`,
--     DROP COLUMN `unclaimed_pages`, DROP COLUMN `escalated_at`;
