-- 261016-partner-lookup-logs.sql — audit trail of partner-data lookups (PLN-261012 SG-31).
--
-- One row per lookup the assistant attempted against the partner (Go2Joy) data API
-- for a signed-in hotel user: who (tenant, hotel from the VERIFIED claims, role),
-- what (topic + scrubbed parameters), how it ended (status / error code / reason),
-- how long it took, and a hash of the validated data snapshot the answer was built
-- from (so "which numbers did the assistant see?" can be re-derived without storing
-- hotel financials in the log). Rejected parameters are logged as KEYS only.
-- Written by PartnerLookupLogService, which never throws into the chat path.
--
-- New table, nothing reads it until the code ships: apply BEFORE deploying the code
-- (staging runs DB_SYNCHRONIZE=false, and a missing table only costs log rows —
-- the service swallows the insert error — but the table should exist).
-- No `AFTER <col>`. Idempotence: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS `partner_lookup_logs` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT,
  `tenant_id`       BIGINT       NOT NULL,
  `conversation_id` BIGINT       NULL,
  `message_id`      BIGINT       NULL COMMENT 'the customer turn that triggered the lookup',
  `session_id`      BIGINT       NULL,
  `hotel_sn`        VARCHAR(32)  NULL COMMENT 'from the verified claims, never from the message',
  `actor_role`      VARCHAR(16)  NULL,
  `topic`           VARCHAR(24)  NOT NULL,
  `params`          JSON         NULL COMMENT 'scrubbed; for a rejected lookup only {rejectedKeys:[...]}',
  `status`          VARCHAR(16)  NOT NULL COMMENT 'ok | denied | rejected | error | unverified',
  `error_code`      VARCHAR(8)   NULL COMMENT 'E5100..E5108',
  `reason`          VARCHAR(64)  NULL,
  `source`          VARCHAR(8)   NULL COMMENT 'mock | live',
  `latency_ms`      INT          NULL,
  `snapshot_hash`   VARCHAR(64)  NULL,
  `created_at`      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_pll_tenant_created` (`tenant_id`, `created_at`),
  KEY `idx_pll_tenant_hotel` (`tenant_id`, `hotel_sn`, `created_at`),
  KEY `idx_pll_conversation` (`conversation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback: DROP TABLE `partner_lookup_logs`;
