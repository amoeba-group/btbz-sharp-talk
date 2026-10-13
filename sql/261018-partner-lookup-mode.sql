-- 261018-partner-lookup-mode.sql — model-driven (tool-calling) partner lookups (PLN-261012 SG-33).
--
-- Two additive columns; both default to "what existed before", so applying this changes no behaviour:
--
--  1. partner_lookup_logs.mode   `prefetch` (default; every existing row and every lookup the
--     deterministic detector triggers) | `tool` (a lookup the model asked for through a tool call).
--     NOT NULL DEFAULT 'prefetch' — old code never writes it and keeps working, new code writes it.
--  2. tenants.partner_data_mode  the tenant's override of PARTNER_DATA_MODE: NULL = follow the
--     server default (`prefetch` unless the env says otherwise), or an explicit `prefetch` | `tools`.
--     Nullable, no default: a tenant that never opened the setting is untouched.
--
-- Order (CLAUDE.md "Migration order"): apply to the target DB BEFORE deploying the code — the new
-- code selects tenants.partner_data_mode and inserts partner_lookup_logs.mode (staging runs
-- DB_SYNCHRONIZE=false; old code + new columns is safe, new code + old schema is not).
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: ADD COLUMN has no IF NOT EXISTS on MySQL 8.0 — guard each statement with
--   SHOW COLUMNS FROM `partner_lookup_logs` LIKE 'mode';
--   SHOW COLUMNS FROM `tenants` LIKE 'partner_data_mode';
-- and skip the matching ALTER when a row comes back.

ALTER TABLE `partner_lookup_logs`
  ADD COLUMN `mode` VARCHAR(8) NOT NULL DEFAULT 'prefetch'
    COMMENT 'prefetch | tool — what triggered the lookup (PLN-261012 SG-33)';

ALTER TABLE `tenants`
  ADD COLUMN `partner_data_mode` VARCHAR(8) NULL;

-- Rollback:
--   ALTER TABLE `tenants` DROP COLUMN `partner_data_mode`;
--   ALTER TABLE `partner_lookup_logs` DROP COLUMN `mode`;
