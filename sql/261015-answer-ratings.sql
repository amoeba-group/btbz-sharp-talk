-- 261015-answer-ratings.sql — per-message accuracy verdicts (PLN-261015 D7)
--
-- An agent rates an AI answer (or a knowledge lead rates an agent answer) as
-- accurate / partial / inaccurate with a reason. One row per (message, rater);
-- rating again replaces the row. Partial/inaccurate AI answers also raise a
-- knowledge_gap_tasks proposal (source 'answer_rating') — that table needs no
-- change: `source` is a free varchar.
-- New table: old code never reads it. Run BEFORE deploying the backend.
-- Idempotence: CREATE TABLE IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS `answer_ratings` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `conversation_id` bigint NOT NULL,
  `message_id` bigint NOT NULL,
  `sender_type` varchar(8) NOT NULL,
  `rating` varchar(12) NOT NULL,
  `reason` varchar(24) NULL,
  `note` varchar(500) NULL,
  `rated_by` bigint NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_answer_rating` (`tenant_id`, `message_id`, `rated_by`),
  KEY `idx_answer_rating_tenant_created` (`tenant_id`, `created_at`),
  KEY `idx_answer_rating_conversation` (`conversation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback: DROP TABLE `answer_ratings`;
