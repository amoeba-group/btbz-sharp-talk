-- 261016-conversation-stamps.sql — who a conversation was with, and which agent spoke
-- (PLN-261012 SG-50, REQ-261012 D-13).
--
-- Stamped when the conversation is created, from the session at that moment:
--   conversations.hotel_sn     the signed hotel key — only when the claims are signed AND not expired
--   conversations.actor_role   the signed role (manager | receptionist | internal) — same rule
--   conversations.ai_agent_id  the EFFECTIVE AI agent (the pin, or the tenant default when unpinned)
-- A guest, a v1 identity or a lapsed claim leaves hotel_sn / actor_role NULL. A guest who signs in
-- later on the same session has the open conversation's NULLs filled in once (never overwritten).
-- Existing rows stay NULL: there is nothing reliable to backfill from.
-- The composite index serves "conversations of hotel X in a date range" (pilot analytics).
-- Additive, nullable — old code ignores the columns, so apply BEFORE deploying the code
-- (staging runs DB_SYNCHRONIZE=false).
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard with `SHOW COLUMNS FROM conversations LIKE 'hotel_sn'` and
--   `SHOW INDEX FROM conversations WHERE Key_name = 'idx_conv_tenant_hotel_created'`.

ALTER TABLE `conversations`
  ADD COLUMN `hotel_sn` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  ADD COLUMN `actor_role` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  ADD COLUMN `ai_agent_id` bigint DEFAULT NULL,
  ADD INDEX `idx_conv_tenant_hotel_created` (`tenant_id`, `hotel_sn`, `created_at`);

-- Rollback:
--   ALTER TABLE `conversations` DROP INDEX `idx_conv_tenant_hotel_created`,
--     DROP COLUMN `ai_agent_id`, DROP COLUMN `actor_role`, DROP COLUMN `hotel_sn`;
