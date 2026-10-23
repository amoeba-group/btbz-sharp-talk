-- 261024-alarm-center.sql — alarm center, assignee display, personal alarm settings
-- (PLN-261024-Alarm-Center-Assignee-Region-Routing).
-- Apply BEFORE deploying the code (staging/production run DB_SYNCHRONIZE=false).
--
-- agent_alerts.event_key        one escalation = one key; a group alarm writes a
--                               row per paged agent, and the console shows them
--                               as one alarm with its assignees. NULL on older
--                               rows (each row stands alone).
-- agent_alerts.rule_name        the routing rule that chose the agents (NULL = none matched).
-- agent_alerts.consult_category the consult category the shopper picked.
-- agent_alert_reads             "seen" per user — closing an alarm hides it for
--                               that user only; ack (stop paging) stays with the
--                               assignee (D2).
-- user_alert_settings           popup scope / sound / desktop / mail per user (D4);
--                               no row = defaults.

ALTER TABLE agent_alerts
  ADD COLUMN event_key        VARCHAR(36)  NULL,
  ADD COLUMN rule_name        VARCHAR(120) NULL,
  ADD COLUMN consult_category VARCHAR(64)  NULL,
  ADD KEY idx_alert_tenant_created (tenant_id, created_at),
  ADD KEY idx_alert_event (event_key);

CREATE TABLE IF NOT EXISTS agent_alert_reads (
  id        BIGINT      NOT NULL AUTO_INCREMENT,
  tenant_id BIGINT      NOT NULL,
  alert_id  BIGINT      NOT NULL,
  user_id   BIGINT      NOT NULL,
  read_at   DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_alert_read (alert_id, user_id),
  KEY idx_alert_read_user (tenant_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_alert_settings (
  user_id    BIGINT      NOT NULL,
  tenant_id  BIGINT      NOT NULL,
  popup      VARCHAR(16) NOT NULL DEFAULT 'all',
  sound      TINYINT(1)  NOT NULL DEFAULT 1,
  desktop    TINYINT(1)  NOT NULL DEFAULT 0,
  email      TINYINT(1)  NOT NULL DEFAULT 1,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (user_id),
  KEY idx_alert_settings_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback (after rolling the code back):
-- DROP TABLE user_alert_settings; DROP TABLE agent_alert_reads;
-- ALTER TABLE agent_alerts DROP KEY idx_alert_event, DROP KEY idx_alert_tenant_created,
--   DROP COLUMN consult_category, DROP COLUMN rule_name, DROP COLUMN event_key;
