-- 261015-agent-alerts-reminded-at.sql — unanswered-alarm reminder latch
-- (PLN-261015-SharpTalk-for-Go2Joy D4)
--
-- agent_alerts.reminded_at: when the reminder for this escalation was sent.
-- The sweep picks rows still 'new' with reminded_at NULL older than the
-- tenant's handoff_config.reAlert.afterMinutes, and stamps every row of the
-- conversation so it reminds exactly once. NULL for every existing row; tenants
-- without reAlert configured are never swept.
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Run BEFORE deploying the backend (old code + new column = safe).
-- Idempotence: guard with `SHOW COLUMNS FROM agent_alerts LIKE 'reminded_at'`.

ALTER TABLE `agent_alerts`
  ADD COLUMN `reminded_at` datetime NULL;

-- Rollback (old code never reads it): ALTER TABLE `agent_alerts` DROP COLUMN `reminded_at`;
