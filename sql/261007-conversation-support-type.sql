-- 261007-conversation-support-type.sql — PLN-261007-Handoff-Team-Routing.
--
-- conversations.support_type: the team the customer picked when they asked for
-- a human (handoff_config.teamRouting option id, e.g. cs | business). NULL =
-- the tenant does not ask, or the customer has not chosen yet.
-- Additive, nullable — old code ignores it, so apply BEFORE deploying the code
-- (staging runs DB_SYNCHRONIZE=false).
-- Rollback: ALTER TABLE `conversations` DROP COLUMN `support_type`;

ALTER TABLE `conversations`
  ADD COLUMN `support_type` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `reply_channel`;
