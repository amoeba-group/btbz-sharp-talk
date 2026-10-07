-- 261008-golden-graded.sql — graded regression runs (PLN-261007-Golden-Graded-Regression S1).
--
-- expected/forbidden: what an answer must / must not contain (string arrays).
-- NULL = no verdict for that question — exactly today's diff-only behaviour.
-- A run records which AI agent it asked as and how many questions passed.
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard with `SHOW COLUMNS FROM golden_questions LIKE 'expected'`.

ALTER TABLE `golden_questions`
  ADD COLUMN `expected` json NULL,
  ADD COLUMN `forbidden` json NULL;

ALTER TABLE `golden_runs`
  ADD COLUMN `ai_agent_id` bigint NULL,
  ADD COLUMN `pass_count` int NOT NULL DEFAULT 0,
  ADD COLUMN `fail_count` int NOT NULL DEFAULT 0;

ALTER TABLE `golden_run_items`
  ADD COLUMN `verdict` varchar(8) NULL,
  ADD COLUMN `failed_checks` json NULL;

-- Rollback (after reverting the code):
-- ALTER TABLE `golden_questions` DROP COLUMN `expected`, DROP COLUMN `forbidden`;
-- ALTER TABLE `golden_runs` DROP COLUMN `ai_agent_id`, DROP COLUMN `pass_count`, DROP COLUMN `fail_count`;
-- ALTER TABLE `golden_run_items` DROP COLUMN `verdict`, DROP COLUMN `failed_checks`;
