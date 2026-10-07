-- 261007-answer-footer.sql — tenant contact footer appended to AI knowledge
-- answers, and the values PII masking must leave alone
-- (PLN-261007-Go2Joy-FAQ-Accuracy R2/R4).
--
-- JSON {enabled, text:{EN,KO,VI,...}, protected:[...]}. NULL = no footer and no
-- protected values — exactly today's behaviour for every tenant.
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard with `SHOW COLUMNS FROM tenant_ai_config LIKE 'answer_footer'`.

ALTER TABLE `tenant_ai_config`
  ADD COLUMN `answer_footer` json NULL;

-- Rollback (after reverting the code): ALTER TABLE `tenant_ai_config` DROP COLUMN `answer_footer`;
