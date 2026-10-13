-- 261016-tenant-identity-policy.sql — how a tenant's signed identity is treated
-- (PLN-261012 SG-03 claims max age, SG-04 refuse identify v1; REQ-261012 D-04, D-05).
--
-- tenants.identity_policy: JSON `{ "maxAgeHours"?: 1..720, "refuseV1"?: true }`.
--   maxAgeHours  per-tenant override of the platform IDENTITY_MAX_AGE_HOURS (default 8):
--                signed claims older than this are treated as a guest until the host signs again.
--   refuseV1     reject `identify` calls that carry no claims (the v1 signature never expires
--                and cannot say which hotel/role the person acts for).
-- NULL = never configured = platform default, so every existing row keeps today's behaviour.
-- Additive, nullable — old code ignores it, so apply BEFORE deploying the code
-- (staging runs DB_SYNCHRONIZE=false).
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard with `SHOW COLUMNS FROM tenants LIKE 'identity_policy'`.

ALTER TABLE `tenants`
  ADD COLUMN `identity_policy` json DEFAULT NULL;

-- Rollback: ALTER TABLE `tenants` DROP COLUMN `identity_policy`;
