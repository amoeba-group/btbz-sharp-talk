-- 261006-journey-management.sql — customer journey management (PLN-261006 P2).
--
-- One journey per chat group (timeline = a person, project = a client company):
-- its current stage, owner and next actions. Stages are per tenant; a tenant
-- with none gets Kotler's 5A on first read (D3). Stage history goes to
-- audit_logs (`journey.stage_changed`) — no history table.
-- New tables only: nothing existing changes, and an empty journeys table
-- means every group simply shows "no stage yet".
-- Idempotence: CREATE TABLE IF NOT EXISTS.
-- Rollback: DROP TABLE `journey_tasks`, `journeys`, `journey_stages`;

CREATE TABLE IF NOT EXISTS `journey_stages` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `key` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` json NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `color` varchar(9) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_journey_stage` (`tenant_id`,`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `journeys` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `group_id` bigint NOT NULL,
  `stage_key` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `owner_user_id` bigint DEFAULT NULL,
  `stage_changed_at` datetime DEFAULT NULL,
  `created_by` bigint NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_journey_group` (`tenant_id`,`group_id`),
  KEY `idx_journey_stage` (`tenant_id`,`stage_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `journey_tasks` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `journey_id` bigint NOT NULL,
  `title` varchar(300) COLLATE utf8mb4_unicode_ci NOT NULL,
  `due_at` date DEFAULT NULL,
  `assignee_user_id` bigint DEFAULT NULL,
  `done_at` datetime DEFAULT NULL,
  `source` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `report_id` bigint DEFAULT NULL,
  `created_by` bigint NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_journey_task_journey` (`tenant_id`,`journey_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
