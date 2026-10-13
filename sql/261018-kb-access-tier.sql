-- 261018-kb-access-tier.sql — role-tiered knowledge access (PLN-261012 SG-10, SG-11, SG-06; REQ D-06).
--
-- kb_categories.min_audience  VARCHAR(16) NULL — the lowest audience that may READ the category:
--   'public' | 'partner' | 'manager'.  NULL = a row from before tiers: guest_visible=1 reads as public,
--   otherwise partner.  NO BACKFILL — NULL keeps that meaning, and `guest_visible` stays the single
--   public flag (the guest gate's SQL is untouched).  Only 'manager' restricts retrieval: it is excluded
--   for every caller that is not a manager/internal session, guests of `open` agents included.
--   Written together with guest_visible by KbCategoryService.setAccess(); CSV import never writes it,
--   so a category created by an import stays fail-closed (not public, not widened).
--
-- answer_reuse.audience_rank  TINYINT NULL — the audience rank (0 public / 1 partner / 2 manager) of the
--   session an answer was generated for.  A stored answer is replayed only to a viewer whose rank is >=.
--   NULL = a row written before this column: while the tenant has ANY manager-only category such rows are
--   never replayed (their audience is unknowable); a tenant with no tier keeps replaying them as before.
--
-- Additive and nullable — old code ignores both, so apply BEFORE deploying the code
-- (staging runs DB_SYNCHRONIZE=false).  No `AFTER <col>`: a database behind on earlier migrations would
-- refuse it.
-- Idempotence: guard each statement with
--   SHOW COLUMNS FROM kb_categories LIKE 'min_audience';   SHOW COLUMNS FROM answer_reuse LIKE 'audience_rank';

ALTER TABLE `kb_categories`
  ADD COLUMN `min_audience` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL;

ALTER TABLE `answer_reuse`
  ADD COLUMN `audience_rank` tinyint DEFAULT NULL;

-- Rollback:
--   ALTER TABLE `kb_categories` DROP COLUMN `min_audience`;
--   ALTER TABLE `answer_reuse` DROP COLUMN `audience_rank`;
