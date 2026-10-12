-- 261015-agent-profile-last-seen.sql — real agent presence (PLN-261012 SG-60, REQ-261012 D-09).
--
-- agent_profiles.last_seen: when the console last polled the alert feed for an agent
-- whose status is 'online'. Routing counts an agent as present only while this is
-- within AGENT_PRESENCE_TTL_SEC (default 90 s), so a stale 'online' no longer lasts
-- forever. NULL = never seen = not present, which is every existing row — nobody is
-- "on duty" until they switch the duty toggle on in the console.
-- Additive, nullable — old code ignores it, so apply BEFORE deploying the code
-- (staging runs DB_SYNCHRONIZE=false).
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard with `SHOW COLUMNS FROM agent_profiles LIKE 'last_seen'`.

ALTER TABLE `agent_profiles`
  ADD COLUMN `last_seen` datetime DEFAULT NULL;

-- Rollback: ALTER TABLE `agent_profiles` DROP COLUMN `last_seen`;
