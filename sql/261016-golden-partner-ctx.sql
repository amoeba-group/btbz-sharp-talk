-- 261016-golden-partner-ctx.sql — golden questions that run as a signed-in hotel user (PLN-261012 SG-31).
--
-- golden_questions.partner_ctx: `{ "hotelSn": "1721", "role": "manager", "mockSet": "default" }`.
-- NULL = an ordinary knowledge question, asked exactly as before (every existing row).
-- Set = the regression runner first runs the question through the partner-data step against
-- that MOCK fixture set (never the live partner API), so figures, role refusals and
-- cross-hotel isolation can be graded like any other answer.
-- Additive, nullable — old code ignores it, so apply BEFORE deploying the code (staging runs
-- DB_SYNCHRONIZE=false; new code selects the column).
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard with `SHOW COLUMNS FROM golden_questions LIKE 'partner_ctx'`.

ALTER TABLE `golden_questions`
  ADD COLUMN `partner_ctx` json NULL;

-- Rollback: ALTER TABLE `golden_questions` DROP COLUMN `partner_ctx`;
