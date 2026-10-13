-- 261016-tenant-pilot-hotels.sql — pilot allowlist by hotel (PLN-261012 SG-40, REQ §3.5).
--
-- Go2Joy opens the agent to a short list of hotels first and widens it as the
-- pilot goes well. The list is keyed by the SIGNED hotelSn (sessions.identity_claims)
-- and enforced server-side on every chat turn.
--
--   tenant_pilot_hotels  the list itself — a table, not a JSON array, because it needs
--                        CSV import, one audit row per change and a size beyond what a
--                        JSON column should hold. `active` lets a hotel be paused
--                        without losing its note. hotel_sn is utf8mb4_bin so the unique
--                        key compares exactly the way the application does (the signed
--                        claim is matched case-sensitively, no folding).
--   tenants.pilot_access JSON {enabled, guestAllowed, nonPilot:'hide'|'notice',
--                        notice:{EN,ES,KO,VI,JA,ZH}} — the switch and what a hotel that
--                        is not on the list sees. NULL = never configured = every tenant
--                        today: nothing changes for them.
--
-- Additive only — old code ignores both, so apply BEFORE deploying the code (staging
-- runs DB_SYNCHRONIZE=false).
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: CREATE TABLE IF NOT EXISTS; for the ALTER, guard with
--   SHOW COLUMNS FROM tenants LIKE 'pilot_access'
-- and skip when it already exists.

CREATE TABLE IF NOT EXISTS `tenant_pilot_hotels` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `hotel_sn` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `added_by` bigint DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pilot_hotel` (`tenant_id`,`hotel_sn`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `tenants`
  ADD COLUMN `pilot_access` json NULL;

-- Rollback (after reverting the code):
--   DROP TABLE `tenant_pilot_hotels`;
--   ALTER TABLE `tenants` DROP COLUMN `pilot_access`;
