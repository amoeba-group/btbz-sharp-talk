-- 261017-agent-alerts-target-region.sql — strict regional routing (PLN-261012 SG-67).
--
-- agent_alerts.target_region: when an alert has no addressed person (target_user_id NULL)
-- in `strict` region mode, it is a REGION-SCOPED broadcast — only staff of that team
-- (users.region = target_region) and nationwide staff (users.region NULL) see it.
-- NULL = a plain broadcast, the behaviour every existing row has.
-- Additive, nullable — old code ignores it, so apply BEFORE deploying the code
-- (staging runs DB_SYNCHRONIZE=false).
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard with `SHOW COLUMNS FROM agent_alerts LIKE 'target_region'`.

ALTER TABLE `agent_alerts`
  ADD COLUMN `target_region` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL;

-- Rollback: ALTER TABLE `agent_alerts` DROP COLUMN `target_region`;
