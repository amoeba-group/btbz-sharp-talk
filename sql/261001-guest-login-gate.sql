-- 261001-guest-login-gate.sql — guest gate per AI agent + signed partner context
-- (PLN-261001 v1.1: REQ-261001 T1/T2/T4 + REQ-261006 H1).
--
-- Five additive columns, all defaulted/NULL, so old code keeps running on the
-- new schema (apply BEFORE deploying the code — staging runs DB_SYNCHRONIZE=false):
--   ai_agents.guest_policy      'open' (today's behaviour) | 'login_guidance'
--   kb_categories.guest_visible  1 = an unidentified visitor may be answered from here
--   tenant_ai_config.guest_guidance  JSON {loginUrl, signupUrl, notice{lang}, hostLinkTemplate}
--   sessions.identity_claims     JSON {hotelSn, role, hotelName, hotelCode, signed, verifiedAt}
--   customers.last_claims        JSON — last signed claims for the Customers screen
-- Idempotence: guard each statement with `SHOW COLUMNS FROM <table> LIKE '<column>'`.
-- Rollback: ALTER TABLE … DROP COLUMN for each of the five (no code reads them before this PR).

ALTER TABLE `ai_agents`
  ADD COLUMN `guest_policy` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open' AFTER `rules`;

ALTER TABLE `kb_categories`
  ADD COLUMN `guest_visible` tinyint(1) NOT NULL DEFAULT '0' AFTER `agent_ids`;

ALTER TABLE `tenant_ai_config`
  ADD COLUMN `guest_guidance` json DEFAULT NULL AFTER `handoff_config`;

ALTER TABLE `sessions`
  ADD COLUMN `identity_claims` json DEFAULT NULL AFTER `identity_level`;

ALTER TABLE `customers`
  ADD COLUMN `last_claims` json DEFAULT NULL AFTER `shopify_tier`;
