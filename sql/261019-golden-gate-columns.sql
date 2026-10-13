-- 261019-golden-gate-columns.sql — golden questions that ask AS a viewer and expect the gate to open
-- or close (PLN-261012 SG-51, REQ D-13 / D-16).
--
-- golden_questions.audience     VARCHAR(16) NULL — who the question is asked as:
--   'guest' | 'partner' | 'receptionist' | 'manager' (the console's "Test as…" viewers).
--   NULL = asked exactly as before (the operator's own view, no gate involved) — every existing row.
-- golden_questions.expect_gate  VARCHAR(8)  NULL — 'allow' | 'refuse'. NULL = the gate is not graded.
--   'refuse' means ANY decision other than allow (sign-in prompt, manager-account line, hand-off).
--
-- golden_run_items records what the gate did per question, so a run is calibration data and a gate
-- regression is a red line in the comparison:
--   audience / expect_gate  the viewer and expectation AS ASKED (a later edit cannot rewrite the past)
--   gate_decision           allow | guest_gate | role_manager_only | low_confidence | embedder_degraded
--   gate_confidence         the deciding measurement (confidence scale), gate_threshold the bar it met
--   gate_top_similarity     best dense similarity found; gate_vector_provider voyage | stub | none
--
-- Additive, nullable — old code ignores every column, so apply BEFORE deploying the code (staging runs
-- DB_SYNCHRONIZE=false; new code selects them).  No `AFTER <col>`: a database behind on earlier
-- migrations would refuse it.
-- Idempotence: guard each statement with
--   SHOW COLUMNS FROM golden_questions LIKE 'audience';   SHOW COLUMNS FROM golden_run_items LIKE 'gate_decision';

ALTER TABLE `golden_questions`
  ADD COLUMN `audience` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  ADD COLUMN `expect_gate` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL;

ALTER TABLE `golden_run_items`
  ADD COLUMN `audience` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  ADD COLUMN `expect_gate` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  ADD COLUMN `gate_decision` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  ADD COLUMN `gate_confidence` decimal(4,3) DEFAULT NULL,
  ADD COLUMN `gate_threshold` decimal(4,3) DEFAULT NULL,
  ADD COLUMN `gate_top_similarity` decimal(4,3) DEFAULT NULL,
  ADD COLUMN `gate_vector_provider` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL;

-- Rollback:
--   ALTER TABLE `golden_questions` DROP COLUMN `audience`, DROP COLUMN `expect_gate`;
--   ALTER TABLE `golden_run_items` DROP COLUMN `audience`, DROP COLUMN `expect_gate`, DROP COLUMN `gate_decision`,
--     DROP COLUMN `gate_confidence`, DROP COLUMN `gate_threshold`, DROP COLUMN `gate_top_similarity`,
--     DROP COLUMN `gate_vector_provider`;
