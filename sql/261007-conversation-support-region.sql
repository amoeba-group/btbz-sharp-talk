-- 261007-conversation-support-region.sql — PLN-261007-Hotel-Region-Routing.
--
-- conversations.support_region: the team (north | south — same values as
-- users.region) that looks after the hotel's region, resolved from the signed
-- province claim when the conversation was handed to a person. NULL = region
-- routing is off, the visitor is not a signed partner, or the province is not
-- in the tenant's table.
-- Additive, nullable — old code ignores it, so apply BEFORE deploying the code
-- (staging runs DB_SYNCHRONIZE=false). Apply after 261007-conversation-support-type.sql.
-- Rollback: ALTER TABLE `conversations` DROP COLUMN `support_region`;

ALTER TABLE `conversations`
  ADD COLUMN `support_region` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `support_type`;
