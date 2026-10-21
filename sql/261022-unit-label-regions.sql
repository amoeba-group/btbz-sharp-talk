-- 261022-unit-label-regions.sql — places a team (unit) or a job label covers
-- (PLN-261022-Go2Joy-HA-B2B-Identity-Continuity, stage 1)
--
-- units.regions / units.provinces            JSON arrays: canonical region codes
-- job_labels.regions / job_labels.provinces  (north, north_center, central, south_center, south)
--                                            and province names (NFC, e.g. "Hồ Chí Minh").
--   NULL = covers nothing in particular — the unit/label still works as an explicit
--   routing group; only "assign by region" rules read these columns.
-- A user covers the union of their unit's and their labels' places.
-- No backfill: every existing row stays NULL, so no tenant's routing changes.
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard with `SHOW COLUMNS FROM units LIKE 'regions'` (and the other three).

ALTER TABLE `units`
  ADD COLUMN `regions` json NULL;

ALTER TABLE `units`
  ADD COLUMN `provinces` json NULL;

ALTER TABLE `job_labels`
  ADD COLUMN `regions` json NULL;

ALTER TABLE `job_labels`
  ADD COLUMN `provinces` json NULL;

-- Rollback:
-- ALTER TABLE `units` DROP COLUMN `regions`, DROP COLUMN `provinces`;
-- ALTER TABLE `job_labels` DROP COLUMN `regions`, DROP COLUMN `provinces`;
