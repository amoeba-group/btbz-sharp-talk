-- 261008-journey-report-content.sql — a journey report as data
-- (PLN-261008-Journey-Report-Visualization P2).
--
-- Headline, questions with the samples they quote, hypotheses, data flags and
-- actions, validated against the samples before being stored. NULL = a report
-- written before this column, or one whose structured reply failed validation;
-- the console falls back to `body_md`, which is always written.
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard with `SHOW COLUMNS FROM journey_reports LIKE 'content_json'`.

ALTER TABLE `journey_reports`
  ADD COLUMN `content_json` json DEFAULT NULL;

-- Rollback: ALTER TABLE `journey_reports` DROP COLUMN `content_json`;
