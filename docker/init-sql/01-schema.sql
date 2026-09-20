-- Production first-boot schema — SINGLE SOURCE OF TRUTH for DDL.
--
-- MySQL runs every file in this directory once, and only when the data
-- directory is empty (docker-entrypoint-initdb.d). Production sets
-- DB_SYNCHRONIZE=false, so anything missing here is missing forever: the API
-- boots and the features that need those tables answer 500.
--
-- Regenerate from the environment that is actually running, not from the
-- entities:
--
--   docker exec <mysql> mysqldump --no-data --skip-dump-date --skip-comments \
--     --single-transaction --set-gtid-purged=OFF -u"$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" \
--     | sed -E 's/ AUTO_INCREMENT=[0-9]+//'
--
-- AUTO_INCREMENT seeds are stripped on purpose — a schema with no rows has no
-- sequence to carry, and leaving them in makes every regeneration a diff.
--
-- Regenerated 2026-09-13 from the live staging DB (90 tables; 13 migrations were missing from the 2026-08-20 hand-maintained copy — FIX-260913).
-- tables and several columns behind, which the PLN-260820 rehearsal found the
-- hard way: a FIRST INSTALL booted against it and SEED_ON_BOOT died with
-- "Unknown column 'Tenant.widget_tabs'". A fresh customer deployment starts
-- from this file, so it being behind is not a stale comment — it is a broken
-- install.
--
-- There used to be a second copy at sql/01-schema.sql that disagreed with this
-- one. Two DDL files with different contents is how the gap went unnoticed, so
-- there is now exactly one.
--
-- 2026-08-20: +ai_agents, +ai_agent_id on sessions / tenant_ai_config_revisions /
-- agent_coaching_threads (PLN-260820, mirrors sql/260820-ai-agents.sql). 74 tables.


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `admin_users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `admin_users` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `level` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'admin',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `must_change_password` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `password_changed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_admin_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `affiliates`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `affiliates` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `customer_id` bigint NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `link_code` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `commission_rate` decimal(5,2) NOT NULL DEFAULT '10.00',
  `applied_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `reviewed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aff_link` (`link_code`),
  KEY `idx_aff_tenant` (`tenant_id`),
  KEY `idx_aff_customer` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `agent_alerts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agent_alerts` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `conversation_id` bigint NOT NULL,
  `session_id` bigint DEFAULT NULL,
  `reason` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `preview` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `target_user_id` bigint DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'new',
  `acked_by` bigint DEFAULT NULL,
  `acked_at` datetime DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_alert_tenant` (`tenant_id`),
  KEY `idx_alert_conv` (`conversation_id`),
  KEY `idx_alert_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `agent_coaching_messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agent_coaching_messages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `thread_id` bigint NOT NULL,
  `role` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `meta` json DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_coach_msg_thread` (`thread_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `agent_coaching_proposals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agent_coaching_proposals` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `thread_id` bigint NOT NULL,
  `message_id` bigint NOT NULL,
  `type` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `payload` json NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `applied_by` bigint DEFAULT NULL,
  `applied_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_coach_prop_thread` (`thread_id`,`id`),
  KEY `idx_coach_prop_tenant_status` (`tenant_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `agent_coaching_threads`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agent_coaching_threads` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `ai_agent_id` bigint DEFAULT NULL,
  `user_id` bigint NOT NULL,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_coach_thread_tenant` (`tenant_id`,`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `agent_daily_stats`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agent_daily_stats` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `agent_id` bigint NOT NULL,
  `stat_date` date NOT NULL,
  `handled` int NOT NULL DEFAULT '0',
  `avg_first_response_sec` int DEFAULT NULL,
  `avg_handle_sec` int DEFAULT NULL,
  `resolved` int NOT NULL DEFAULT '0',
  `escalated` int NOT NULL DEFAULT '0',
  `csat_avg` decimal(4,2) DEFAULT NULL,
  `online_sec` int DEFAULT NULL,
  `blocked_msgs` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agentstat` (`tenant_id`,`agent_id`,`stat_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `agent_profiles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agent_profiles` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `user_id` bigint NOT NULL,
  `languages` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `skills` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `max_concurrent` int NOT NULL DEFAULT '3',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'offline',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agent_user` (`user_id`),
  KEY `idx_agent_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `agents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agents` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'agent',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'offline',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_agents_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_agents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_agents` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `code` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `display_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `persona` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `greeting` json DEFAULT NULL,
  `rules` json DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aiagent_code` (`tenant_id`,`code`),
  KEY `idx_aiagent_tenant` (`tenant_id`,`is_default`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_engines`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_engines` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `provider` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `model` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `endpoint` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `api_key_encrypted` varbinary(2048) DEFAULT NULL,
  `capabilities` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'chat,rag,summary,assist,moderation',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'enabled',
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_aiengine_tenant` (`tenant_id`),
  KEY `idx_aiengine_provider` (`provider`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_usage_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_usage_daily` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `stat_date` date NOT NULL,
  `feature` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ai_function` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `engine_id` bigint DEFAULT NULL,
  `provider` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `model` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `engine_owner` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `calls` int NOT NULL DEFAULT '0',
  `tokens_in` bigint NOT NULL DEFAULT '0',
  `tokens_out` bigint NOT NULL DEFAULT '0',
  `stub_calls` int NOT NULL DEFAULT '0',
  `failures` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ai_usage` (`tenant_id`,`stat_date`,`feature`,`ai_function`,`engine_id`,`engine_owner`),
  KEY `idx_ai_usage_lookup` (`tenant_id`,`stat_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `answer_reuse`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `answer_reuse` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `lang` varchar(5) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ai_agent_id` bigint DEFAULT NULL,
  `question_text` varchar(500) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `answer_text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `source` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `source_message_id` bigint DEFAULT NULL,
  `confidence` decimal(4,3) DEFAULT NULL,
  `citations` json DEFAULT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `hit_count` int NOT NULL DEFAULT '0',
  `last_hit_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_reuse_tenant` (`tenant_id`,`active`),
  KEY `idx_reuse_src_msg` (`source_message_id`),
  KEY `idx_reuse_agent` (`tenant_id`,`ai_agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `assignments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `assignments` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `conversation_id` bigint NOT NULL,
  `agent_id` bigint DEFAULT NULL,
  `assigned_by` bigint DEFAULT NULL,
  `type` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'auto',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `assigned_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `released_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_assign_conv` (`conversation_id`),
  KEY `idx_assign_agent` (`agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `actor_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `actor_id` bigint NOT NULL,
  `action` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ip` varchar(45) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `request_id` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `result` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `metadata` json DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_audit_tenant` (`tenant_id`),
  KEY `idx_audit_actor` (`actor_type`,`actor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `board_attachments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `board_attachments` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `uuid` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` bigint NOT NULL,
  `document_id` bigint NOT NULL,
  `kind` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'file',
  `filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `storage_path` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `size` bigint DEFAULT NULL,
  `url` varchar(1024) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` bigint NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_board_att_uuid` (`uuid`),
  KEY `idx_board_att_doc` (`tenant_id`,`document_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `board_comments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `board_comments` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `document_id` bigint NOT NULL,
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `mentions` json DEFAULT NULL,
  `author_user_id` bigint NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_board_comments_doc` (`tenant_id`,`document_id`),
  KEY `idx_board_comments_tenant` (`tenant_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `board_document_revisions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `board_document_revisions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `document_id` bigint NOT NULL,
  `revision_no` int NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` longtext COLLATE utf8mb4_unicode_ci,
  `category1` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category2` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `changed_fields` json DEFAULT NULL,
  `change_kind` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'update',
  `actor_user_id` bigint DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_board_rev` (`document_id`,`revision_no`),
  KEY `idx_board_rev_tenant` (`tenant_id`,`document_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `board_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `board_documents` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `board_id` bigint NOT NULL,
  `doc_group` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'counsel',
  `category1` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category2` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `team_label` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `content` longtext COLLATE utf8mb4_unicode_ci,
  `tags` json DEFAULT NULL,
  `links` json DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `author_user_id` bigint NOT NULL,
  `updated_by` bigint DEFAULT NULL,
  `promoted_document_id` bigint DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_board_docs_tenant` (`tenant_id`,`board_id`,`doc_group`),
  FULLTEXT KEY `ft_board_docs_title_content` (`title`,`content`) /*!50100 WITH PARSER `ngram` */ 
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `boards`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `boards` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `name` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Smart Knowledge Board',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_boards_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `campaigns`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `campaigns` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `segment_ref` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `content` json DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `scheduled_at` datetime DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cmp_tenant` (`tenant_id`),
  KEY `idx_campaign_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `channel_message_map`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `channel_message_map` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `thread_id` bigint NOT NULL,
  `external_message_id` varchar(128) NOT NULL,
  `message_id` bigint NOT NULL,
  `direction` varchar(8) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cmm_thread_ext` (`thread_id`,`external_message_id`),
  KEY `idx_cmm_message` (`message_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `channel_outbox`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `channel_outbox` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `thread_id` bigint NOT NULL,
  `message_id` bigint NOT NULL,
  `status` varchar(12) NOT NULL DEFAULT 'pending',
  `external_command_id` varchar(64) DEFAULT NULL,
  `attempts` int NOT NULL DEFAULT '0',
  `next_attempt_at` datetime DEFAULT NULL,
  `last_error` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_co_message` (`message_id`),
  KEY `idx_co_due` (`status`,`next_attempt_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `channel_threads`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `channel_threads` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `channel_id` bigint NOT NULL,
  `external_thread_id` varchar(128) NOT NULL,
  `sub_channel` varchar(16) DEFAULT NULL,
  `reply_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `notice_version` varchar(32) DEFAULT NULL,
  `external_user_id` varchar(128) DEFAULT NULL,
  `external_user_name` varchar(128) DEFAULT NULL,
  `session_id` bigint DEFAULT NULL,
  `conversation_id` bigint DEFAULT NULL,
  `customer_id` bigint DEFAULT NULL,
  `inbound_cursor` varchar(64) DEFAULT NULL,
  `outbound_cursor` bigint DEFAULT NULL,
  `last_inbound_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ct_channel_thread` (`channel_id`,`external_thread_id`),
  KEY `idx_ct_conversation` (`conversation_id`),
  KEY `idx_ct_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_comments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_comments` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `scope` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `conversation_id` bigint DEFAULT NULL,
  `session_id` bigint DEFAULT NULL,
  `author_id` bigint NOT NULL,
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_ccomment_tenant_conv` (`tenant_id`,`conversation_id`),
  KEY `idx_ccomment_tenant_sess` (`tenant_id`,`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_group_members`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_group_members` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `group_id` bigint NOT NULL,
  `session_id` bigint NOT NULL,
  `added_by` bigint NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_cgm_group_session` (`group_id`,`session_id`),
  KEY `idx_cgm_tenant_session` (`tenant_id`,`session_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `chat_groups`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `chat_groups` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `kind` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_by` bigint NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_cgroup_tenant` (`tenant_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `cjm_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cjm_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `session_id` bigint DEFAULT NULL,
  `customer_id` bigint DEFAULT NULL,
  `stage` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_type` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `payload` json DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_cjm_tenant` (`tenant_id`),
  KEY `idx_cjm_session` (`session_id`),
  KEY `idx_cjm_customer` (`customer_id`),
  KEY `idx_cjm_stage` (`stage`),
  KEY `idx_cjm_tenant_created` (`tenant_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `content_filter_rules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `content_filter_rules` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `scope` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'both',
  `type` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pattern_or_prompt` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `lang` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `severity` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'high',
  `action` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'block',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_cfr_tenant` (`tenant_id`,`scope`,`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `conversation_briefings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `conversation_briefings` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `conversation_id` bigint NOT NULL,
  `last_message_id` bigint DEFAULT NULL,
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `translations` json DEFAULT NULL,
  `requested_by` bigint NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_brief_tenant_conv` (`tenant_id`,`conversation_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `conversations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `conversations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `session_id` bigint NOT NULL,
  `channel` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'widget',
  `status` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ai_active',
  `escalated` tinyint(1) NOT NULL DEFAULT '0',
  `agent_id` bigint DEFAULT NULL,
  `reply_channel` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `ended_at` datetime DEFAULT NULL,
  `idle_prompt_at` datetime DEFAULT NULL COMMENT 'when the idle check was sent; also the ask-once latch',
  `csat_rating` tinyint DEFAULT NULL COMMENT 'customer satisfaction 1..5',
  `csat_rated_at` datetime DEFAULT NULL,
  `pinned_at` datetime(6) DEFAULT NULL,
  `pinned_by` bigint DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_conv_tenant` (`tenant_id`),
  KEY `idx_conv_session` (`session_id`),
  KEY `idx_conv_agent` (`agent_id`),
  KEY `idx_conv_status` (`status`),
  KEY `idx_conv_tenant_status_id` (`tenant_id`,`status`,`id`),
  KEY `idx_conv_idle` (`status`,`idle_prompt_at`),
  KEY `idx_conv_tenant_pinned` (`tenant_id`,`pinned_at`),
  KEY `idx_conv_tenant_ended` (`tenant_id`,`ended_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `customers`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `customers` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `shopify_customer_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cafe24_user_identifier` varchar(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cafe24_member_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `external_customer_id` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tier` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'guest',
  `shopify_tier` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `email_hash` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varbinary(512) DEFAULT NULL,
  `name` varbinary(512) DEFAULT NULL,
  `phone` varbinary(256) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_customers_tenant_shopify` (`tenant_id`,`shopify_customer_id`),
  UNIQUE KEY `uq_customers_tenant_cafe24_uid` (`tenant_id`,`cafe24_user_identifier`),
  UNIQUE KEY `uq_customers_tenant_cafe24_mid` (`tenant_id`,`cafe24_member_id`),
  UNIQUE KEY `uq_customers_tenant_external` (`tenant_id`,`external_customer_id`),
  KEY `idx_customers_tenant` (`tenant_id`),
  KEY `idx_customers_email_hash` (`email_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `device_tokens`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `device_tokens` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `customer_id` bigint DEFAULT NULL,
  `session_id` bigint DEFAULT NULL,
  `platform` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `provider` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'expo',
  `token` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `token_hash` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `locale` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `app_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `last_seen_at` datetime DEFAULT NULL,
  `revoked_at` datetime DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_device_token_hash` (`token_hash`),
  KEY `idx_dtok_tenant` (`tenant_id`),
  KEY `idx_dtok_customer` (`customer_id`),
  KEY `idx_dtok_tenant_customer` (`tenant_id`,`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `diary_notes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `diary_notes` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `customer_id` bigint NOT NULL,
  `body` varchar(1000) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `product_handle` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_diary_tenant` (`tenant_id`),
  KEY `idx_diary_customer` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `erased_identities`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `erased_identities` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `email_hash` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `shopify_customer_hash` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `erased_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_erased_tenant_email` (`tenant_id`,`email_hash`),
  KEY `idx_erased_tenant_shopify` (`tenant_id`,`shopify_customer_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `external_tickets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `external_tickets` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `conversation_id` bigint NOT NULL,
  `provider` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `external_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `last_relayed_message_id` bigint DEFAULT NULL,
  `last_inbound_message_id` bigint DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ext_conv` (`conversation_id`,`provider`),
  KEY `idx_ext_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `fulfillments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `fulfillments` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `order_id` bigint NOT NULL,
  `status` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tracking_number` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `carrier` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_ful_tenant` (`tenant_id`),
  KEY `idx_fulfill_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `golden_questions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `golden_questions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `question` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `language` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'KO',
  `note` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `active` tinyint NOT NULL DEFAULT '1',
  `created_by` bigint DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_golden_q_tenant` (`tenant_id`,`active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `golden_run_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `golden_run_items` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `run_id` bigint NOT NULL,
  `question_id` bigint DEFAULT NULL,
  `question` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `answer` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `confidence` decimal(4,3) DEFAULT NULL,
  `blocked` tinyint NOT NULL DEFAULT '0',
  `citations` json DEFAULT NULL,
  `error` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_golden_item_run` (`run_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `golden_runs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `golden_runs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `kind` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `proposal_id` bigint DEFAULT NULL,
  `config_hash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `question_count` int NOT NULL DEFAULT '0',
  `truncated` tinyint NOT NULL DEFAULT '0',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'running',
  `created_by` bigint DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `completed_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_golden_run_tenant` (`tenant_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `inquiries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inquiries` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `conversation_id` bigint DEFAULT NULL,
  `order_id` bigint DEFAULT NULL,
  `customer_id` bigint DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_inq_tenant` (`tenant_id`),
  KEY `idx_inq_order` (`order_id`),
  KEY `idx_inq_customer` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `integration_credentials`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `integration_credentials` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `provider` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `secret_enc` varbinary(4096) DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'connected',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `last_tested_at` datetime DEFAULT NULL,
  `detail` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cred_tenant_provider` (`tenant_id`,`provider`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `integration_status`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `integration_status` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `name` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'connected',
  `last_sync_at` datetime DEFAULT NULL,
  `detail` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_integration_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `invitations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `invitations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `rank` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'staff',
  `token` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `temp_password_hash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `expires_at` datetime DEFAULT NULL,
  `created_by` bigint DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_inv_token` (`token`),
  KEY `idx_inv_tenant_email` (`tenant_id`,`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `issue_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `issue_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `issue_id` bigint NOT NULL,
  `actor_type` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `actor_id` bigint DEFAULT NULL,
  `type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `from_status` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_status` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ievt_issue` (`issue_id`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `issues`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `issues` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `issue_no` int NOT NULL,
  `conversation_id` bigint NOT NULL,
  `session_id` bigint NOT NULL,
  `customer_id` bigint DEFAULT NULL,
  `type` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'other',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'received',
  `resolved_tier` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `priority` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'normal',
  `assignee_user_id` bigint DEFAULT NULL,
  `assignee_label` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reject_reason` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `resolution_note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reopen_count` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `resolved_at` datetime DEFAULT NULL,
  `closed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_issue_no` (`tenant_id`,`issue_no`),
  UNIQUE KEY `uk_issue_conv` (`conversation_id`),
  KEY `idx_issue_tenant_status` (`tenant_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `job_labels`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `job_labels` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `code` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_label_tenant_code` (`tenant_id`,`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `journey_report_criteria`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `journey_report_criteria` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `version` int NOT NULL,
  `sections_json` json NOT NULL,
  `top_questions_n` int NOT NULL DEFAULT '5',
  `sample_cap` int NOT NULL DEFAULT '200',
  `quote_max_chars` int NOT NULL DEFAULT '200',
  `tone` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `banned_json` json DEFAULT NULL,
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_jrc` (`tenant_id`,`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `journey_reports`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `journey_reports` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `group_id` bigint NOT NULL,
  `kind` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `period_from` date DEFAULT NULL,
  `period_to` date DEFAULT NULL,
  `criteria_version` int NOT NULL,
  `session_ids_json` json NOT NULL,
  `metrics_json` json DEFAULT NULL,
  `body_md` mediumtext COLLATE utf8mb4_unicode_ci,
  `language` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `error` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source_report_ids` json DEFAULT NULL,
  `engine_id` bigint DEFAULT NULL,
  `provider` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `model` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hidden` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` bigint NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `finished_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_jr_lookup` (`tenant_id`,`group_id`,`created_at`),
  KEY `idx_jr_status` (`tenant_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `kb_answer_proposals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kb_answer_proposals` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `conversation_id` bigint DEFAULT NULL COMMENT 'where the answer was given; null once the conversation is purged',
  `question` varchar(500) NOT NULL,
  `answer` text NOT NULL,
  `status` varchar(16) NOT NULL DEFAULT 'pending' COMMENT 'pending|approved|rejected',
  `proposed_by` bigint NOT NULL,
  `decided_by` bigint DEFAULT NULL,
  `decided_at` datetime DEFAULT NULL,
  `reject_reason` varchar(500) DEFAULT NULL COMMENT 'shown to the proposer â€” an unexplained no repeats itself',
  `document_id` bigint DEFAULT NULL COMMENT 'kb_documents.id created on approval',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_kbprop_queue` (`tenant_id`,`status`,`created_at`),
  KEY `idx_kbprop_conversation` (`conversation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `kb_categories`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kb_categories` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `doc_group` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'counsel',
  `label` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `origin` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'manual',
  `sort_order` int NOT NULL DEFAULT '0',
  `hidden` tinyint(1) NOT NULL DEFAULT '0',
  `agent_ids` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_kb_category` (`tenant_id`,`doc_group`,`name`),
  KEY `idx_kb_category_tenant` (`tenant_id`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `kb_conflicts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kb_conflicts` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `doc_a_id` bigint NOT NULL,
  `doc_b_id` bigint NOT NULL,
  `similarity` decimal(5,4) DEFAULT NULL,
  `verdict` varchar(16) DEFAULT NULL COMMENT 'conflict|duplicate|complementary',
  `rationale` text COMMENT 'LLM explanation, moderation-checked',
  `status` varchar(16) NOT NULL DEFAULT 'pending' COMMENT 'pending|resolved|dismissed',
  `resolution` varchar(16) DEFAULT NULL COMMENT 'kept_a|kept_b|kept_both',
  `resolved_by` bigint DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `detected_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `failure_reason` varchar(24) DEFAULT NULL COMMENT 'model_error|parse_fail|bad_verdict — set only when status=failed',
  `attempts` int NOT NULL DEFAULT '1',
  `rationale_withheld` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'verdict kept, rationale suppressed by the moderation gate',
  `last_attempt_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_kbconflict_pair` (`tenant_id`,`doc_a_id`,`doc_b_id`),
  KEY `idx_kbconflict_status` (`tenant_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `kb_document_revisions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kb_document_revisions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `document_id` bigint NOT NULL,
  `revision_no` int NOT NULL COMMENT 'per document, starting at 1',
  `title` varchar(255) NOT NULL,
  `category` varchar(64) DEFAULT NULL,
  `content` longtext,
  `source_url` varchar(512) DEFAULT NULL,
  `effective_from` date DEFAULT NULL,
  `review_interval_days` int DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `changed_fields` json DEFAULT NULL COMMENT '["title","content"]',
  `change_kind` varchar(16) NOT NULL COMMENT 'baseline|create|update|restore|delete',
  `actor_user_id` bigint DEFAULT NULL,
  `restored_from` int DEFAULT NULL COMMENT 'revision_no this one was restored from',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_kbrev` (`tenant_id`,`document_id`,`revision_no`),
  KEY `idx_kbrev_doc` (`tenant_id`,`document_id`,`revision_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `kb_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kb_documents` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `source` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'knowledge_store',
  `source_id` bigint DEFAULT NULL,
  `category` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `content` longtext COLLATE utf8mb4_unicode_ci,
  `embedding_ref` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `embedding_model` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `embedded_at` datetime DEFAULT NULL,
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `source_url` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `owner_user_id` bigint DEFAULT NULL,
  `effective_from` date DEFAULT NULL,
  `review_interval_days` int DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `reviewed_by` bigint DEFAULT NULL,
  `superseded_by` bigint DEFAULT NULL,
  `doc_group` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'counsel' COMMENT 'counsel|product — closed set',
  `external_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'stable key from the origin system (product: Shopify Handle)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_kb_extkey` (`tenant_id`,`doc_group`,`external_key`),
  KEY `idx_kb_tenant` (`tenant_id`),
  KEY `idx_kb_source` (`source_id`),
  KEY `idx_kb_category` (`category`),
  KEY `idx_kb_group` (`tenant_id`,`doc_group`),
  FULLTEXT KEY `ft_kb_title_content` (`title`,`content`) /*!50100 WITH PARSER `ngram` */ 
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `kb_files`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `kb_files` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `source_id` bigint NOT NULL,
  `post_id` bigint DEFAULT NULL,
  `filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `storage_path` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  `size` bigint DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_file_source` (`source_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `knowledge_gap_tasks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `knowledge_gap_tasks` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `source` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ref_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(300) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `detail` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `metric_json` json DEFAULT NULL,
  `status` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'proposed',
  `decided_by` bigint DEFAULT NULL,
  `decided_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_gap` (`tenant_id`,`source`,`ref_key`),
  KEY `idx_gap_tenant_status` (`tenant_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `knowledge_sources`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `knowledge_sources` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `designated` tinyint(1) NOT NULL DEFAULT '1',
  `config_json` json DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `last_sync_at` datetime DEFAULT NULL,
  `last_sync_status` varchar(16) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'ok|failed â€” NULL means never synced',
  `last_sync_result` json DEFAULT NULL COMMENT '{created,updated,skipped,hidden,failed}',
  PRIMARY KEY (`id`),
  KEY `idx_ksrc_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `message_attachments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `message_attachments` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `uuid` char(36) NOT NULL,
  `tenant_id` bigint NOT NULL,
  `conversation_id` bigint DEFAULT NULL,
  `message_id` bigint DEFAULT NULL,
  `session_id` bigint DEFAULT NULL,
  `uploader_type` varchar(16) NOT NULL,
  `uploader_id` bigint DEFAULT NULL,
  `kind` varchar(16) NOT NULL,
  `filename` varchar(255) NOT NULL,
  `mime` varchar(128) NOT NULL,
  `size` bigint NOT NULL,
  `width` int DEFAULT NULL,
  `height` int DEFAULT NULL,
  `storage_path` varchar(512) NOT NULL,
  `thumb_path` varchar(512) DEFAULT NULL,
  `checksum` char(64) DEFAULT NULL,
  `source` varchar(24) NOT NULL DEFAULT 'widget',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_attach_uuid` (`uuid`),
  KEY `idx_attach_msg` (`message_id`),
  KEY `idx_attach_conv` (`conversation_id`),
  KEY `idx_attach_session` (`session_id`),
  KEY `idx_attach_tenant_created` (`tenant_id`,`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `messages`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `messages` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `conversation_id` bigint NOT NULL,
  `sender_type` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `lang` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `retrieval_trace` json DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `sender_id` bigint DEFAULT NULL,
  `intent` varchar(48) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `intent_confidence` decimal(4,3) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_msg_tenant` (`tenant_id`),
  KEY `idx_msg_conv` (`conversation_id`),
  KEY `idx_msg_intent` (`tenant_id`,`intent`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `messenger_channels`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `messenger_channels` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `provider` varchar(16) NOT NULL,
  `mode` varchar(8) NOT NULL DEFAULT 'direct',
  `label` varchar(64) NOT NULL,
  `external_account_id` varchar(128) DEFAULT NULL,
  `webhook_token` varchar(64) DEFAULT NULL,
  `config` json DEFAULT NULL,
  `secret_enc` varbinary(2048) DEFAULT NULL,
  `auto_reply` tinyint(1) NOT NULL DEFAULT '1',
  `reply_mode` varchar(8) NOT NULL DEFAULT 'auto',
  `consent_mode` varchar(8) NOT NULL DEFAULT 'notice',
  `active` tinyint(1) NOT NULL DEFAULT '0',
  `status` varchar(16) NOT NULL DEFAULT 'unknown',
  `last_sync_at` datetime DEFAULT NULL,
  `last_error` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_mc_tenant_provider_label` (`tenant_id`,`provider`,`label`),
  UNIQUE KEY `uk_mc_webhook_token` (`webhook_token`),
  KEY `idx_mc_tenant` (`tenant_id`),
  KEY `idx_mc_active` (`active`,`provider`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `mfa_credentials`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mfa_credentials` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `actor_type` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `actor_id` bigint NOT NULL,
  `secret_enc` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `enabled_at` datetime DEFAULT NULL,
  `last_used_step` bigint DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_mfa_actor` (`actor_type`,`actor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `mfa_recovery_codes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `mfa_recovery_codes` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `credential_id` bigint NOT NULL,
  `code_hash` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `used_at` datetime DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_mfa_code_credential` (`credential_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `moderation_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `moderation_logs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `conversation_id` bigint DEFAULT NULL,
  `author_type` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `author_id` bigint DEFAULT NULL,
  `excerpt` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rule_id` bigint DEFAULT NULL,
  `action` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `decision` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_modlog_tenant` (`tenant_id`),
  KEY `idx_modlog_conv` (`conversation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `notification_prefs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notification_prefs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `customer_id` bigint NOT NULL,
  `channel` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `category` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pref` (`customer_id`,`channel`,`category`),
  KEY `idx_npref_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `customer_id` bigint DEFAULT NULL,
  `session_id` bigint DEFAULT NULL,
  `category` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body` text COLLATE utf8mb4_unicode_ci,
  `status_badge` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `link_url` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ref_type` varchar(24) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ref_id` bigint DEFAULT NULL,
  `channel` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'in_app',
  `read_at` datetime DEFAULT NULL,
  `deleted_at` datetime DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_notif_tenant` (`tenant_id`),
  KEY `idx_notif_customer` (`customer_id`),
  KEY `idx_notif_category` (`category`),
  KEY `idx_notif_customer_read` (`customer_id`,`read_at`),
  KEY `idx_notif_ref` (`ref_type`,`ref_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `nudges`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `nudges` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `customer_id` bigint NOT NULL,
  `product_handle` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `message` varchar(280) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `code` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `views` int NOT NULL DEFAULT '0',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_nudge_code` (`code`),
  KEY `idx_nudge_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `order_items`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `order_items` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `order_id` bigint NOT NULL,
  `product_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `option_text` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qty` int NOT NULL DEFAULT '1',
  `price` decimal(12,2) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ordi_tenant` (`tenant_id`),
  KEY `idx_items_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `orders_cache`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `orders_cache` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `provider` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'shopify',
  `shopify_order_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_id` bigint DEFAULT NULL,
  `member_id` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `order_number` varchar(32) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status_internal` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status_ui` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `total` decimal(12,2) DEFAULT NULL,
  `subtotal` decimal(12,2) DEFAULT NULL,
  `discount_total` decimal(12,2) DEFAULT NULL,
  `shipping_total` decimal(12,2) DEFAULT NULL,
  `item_qty` int DEFAULT NULL,
  `currency` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT 'USD',
  `ordered_at` datetime DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_orders_channel` (`tenant_id`,`provider`,`shopify_order_id`),
  KEY `idx_ordc_tenant` (`tenant_id`),
  KEY `idx_orders_customer` (`customer_id`),
  KEY `idx_orders_number` (`order_number`),
  KEY `idx_ordc_tenant_created` (`tenant_id`,`created_at`),
  KEY `idx_ordc_tenant_member` (`tenant_id`,`member_id`),
  KEY `idx_ordc_tenant_ordered` (`tenant_id`,`ordered_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `product_saves`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `product_saves` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `customer_id` bigint NOT NULL,
  `product_handle` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `list` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `note` varchar(280) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_save` (`customer_id`,`product_handle`,`list`),
  KEY `idx_save_tenant` (`tenant_id`),
  KEY `idx_save_customer` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `products_cache`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `products_cache` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `external_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `handle` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `vendor` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `image_url` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `price` decimal(10,2) DEFAULT NULL,
  `currency` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'USD',
  `product_url` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tags` varchar(1024) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `published_at` datetime DEFAULT NULL,
  `synced_at` datetime DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `sku` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'storefront variant SKU â€” lookup aid, not an identity key',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_product_tenant_handle` (`tenant_id`,`handle`),
  KEY `idx_prdc_tenant_ext` (`tenant_id`,`external_id`),
  KEY `idx_prdc_tenant` (`tenant_id`),
  KEY `idx_prdc_sku` (`tenant_id`,`sku`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `question_clusters`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `question_clusters` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `label` varchar(255) DEFAULT NULL COMMENT 'representative question (PII-scrubbed)',
  `centroid` json DEFAULT NULL COMMENT 'running mean of member embeddings',
  `size` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_qcluster_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `question_stats_daily`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `question_stats_daily` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `stat_date` date NOT NULL,
  `dimension` varchar(16) NOT NULL COMMENT 'intent|category|document|keyword|cluster',
  `dim_key` varchar(128) NOT NULL COMMENT 'stable id within the dimension',
  `dim_label` varchar(255) DEFAULT NULL COMMENT 'human-readable label (PII-scrubbed)',
  `asked` int NOT NULL DEFAULT '0',
  `escalated` int NOT NULL DEFAULT '0',
  `no_source` int NOT NULL DEFAULT '0' COMMENT 'answered with no KB citation',
  `avg_confidence` decimal(5,4) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_qstat` (`tenant_id`,`stat_date`,`dimension`,`dim_key`),
  KEY `idx_qstat_lookup` (`tenant_id`,`dimension`,`stat_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `reply_drafts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reply_drafts` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `conversation_id` bigint NOT NULL,
  `message_id` bigint DEFAULT NULL,
  `body` text NOT NULL,
  `confidence` decimal(4,3) DEFAULT NULL,
  `status` varchar(12) NOT NULL DEFAULT 'pending',
  `resolved_by` bigint DEFAULT NULL,
  `resolved_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rd_conv_status` (`conversation_id`,`status`),
  KEY `idx_rd_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `restock_subscriptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `restock_subscriptions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `customer_id` bigint DEFAULT NULL,
  `product_id` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `channel` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'in_app',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `notified_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rsk_tenant` (`tenant_id`),
  KEY `idx_restock_customer` (`customer_id`),
  KEY `idx_restock_product` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `reviews`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `reviews` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `order_item_id` bigint NOT NULL,
  `customer_id` bigint NOT NULL,
  `rating` tinyint NOT NULL,
  `body` text COLLATE utf8mb4_unicode_ci,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'submitted',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_rev_tenant` (`tenant_id`),
  KEY `idx_review_item` (`order_item_id`),
  KEY `idx_review_customer` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `sessions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sessions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `session_token` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `channel` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `tenant_id` bigint DEFAULT NULL,
  `ai_agent_id` bigint DEFAULT NULL COMMENT 'AI agent (ai_agents.id) answering this session; NULL = tenant default',
  `customer_id` bigint DEFAULT NULL,
  `language` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'EN',
  `language_locked` tinyint(1) NOT NULL DEFAULT '0' COMMENT '1 = shopper picked the language themselves; auto-detection must not override',
  `consent_state` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `identity_level` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'guest',
  `alias` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `auto_reply_mode` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'inherit',
  `consent_at` datetime DEFAULT NULL,
  `consent_version` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_sessions_token` (`session_token`),
  KEY `idx_sessions_tenant` (`tenant_id`),
  KEY `idx_sessions_customer` (`customer_id`),
  KEY `idx_sessions_tenant_agent` (`tenant_id`,`ai_agent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `subscriptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `subscriptions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint DEFAULT NULL,
  `customer_id` bigint NOT NULL,
  `shopify_subscription_id` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `plan` varchar(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `next_billing` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_sub_tenant` (`tenant_id`),
  KEY `idx_sub_customer` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `tenant_ai_config`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenant_ai_config` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `persona` text COLLATE utf8mb4_unicode_ci,
  `rules` json DEFAULT NULL,
  `scenario_buttons` json DEFAULT NULL,
  `scenario_overrides` json DEFAULT NULL,
  `handoff_config` json DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_aiconfig_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `tenant_ai_config_revisions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenant_ai_config_revisions` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `ai_agent_id` bigint DEFAULT NULL,
  `revision_no` int NOT NULL,
  `persona` text COLLATE utf8mb4_unicode_ci,
  `rules` json DEFAULT NULL,
  `scenario_overrides` json DEFAULT NULL,
  `kind` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `changed_fields` json DEFAULT NULL,
  `note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `proposal_id` bigint DEFAULT NULL,
  `actor_user_id` bigint DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `idx_cfgrev_tenant` (`tenant_id`,`revision_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `tenant_ai_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenant_ai_settings` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `function` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `engine_id` bigint NOT NULL,
  `params_json` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_function` (`tenant_id`,`function`),
  KEY `idx_tas_engine` (`engine_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `tenant_assets`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenant_assets` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `uuid` char(36) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tenant_id` bigint NOT NULL,
  `area` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kind` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `filename` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mime` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ext` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `size` bigint NOT NULL,
  `sha256` char(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `width` int DEFAULT NULL,
  `height` int DEFAULT NULL,
  `storage_path` varchar(512) COLLATE utf8mb4_unicode_ci NOT NULL,
  `version` int NOT NULL DEFAULT '1',
  `label` varchar(128) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` bigint NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `deleted_at` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_assets_uuid` (`uuid`),
  KEY `idx_tenant_assets_tenant_area` (`tenant_id`,`area`,`deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `tenant_menus`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenant_menus` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `menu_code` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `provided` tinyint(1) NOT NULL COMMENT '1=provided despite plan, 0=withheld despite plan',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_menu` (`tenant_id`,`menu_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `tenant_role_menus`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenant_role_menus` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `rank` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'master/director/manager/staff',
  `menu_code` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `allowed` tinyint(1) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_rank_menu` (`tenant_id`,`rank`,`menu_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `tenant_user_menus`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenant_user_menus` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `user_id` bigint NOT NULL,
  `menu_code` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `allowed` tinyint(1) NOT NULL COMMENT '1=allow exception, 0=deny exception',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_user_menu` (`tenant_id`,`user_id`,`menu_code`),
  KEY `idx_tum_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `tenants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `tenants` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `uuid` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `shop_domain` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `slug` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `plan` varchar(32) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `privacy_policy_url` varchar(512) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `consent_notice_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `widget_login_mode` varchar(16) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'redirect',
  `widget_copy` json DEFAULT NULL,
  `widget_tabs` json DEFAULT NULL,
  `widget_tab_position` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'top',
  `notification_channels` json DEFAULT NULL,
  `widget_theme` json DEFAULT NULL,
  `embed_origins` json DEFAULT NULL,
  `embed_secret` varbinary(512) DEFAULT NULL,
  `workflow_mode` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'base',
  `usage_guides_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `active_widget_design_id` bigint DEFAULT NULL,
  `custom_css_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `timezone` varchar(40) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `default_language` varchar(5) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `storefront_url` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'customer-facing shop origin, e.g. https://ivyusa.com',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tenant_shop` (`shop_domain`),
  UNIQUE KEY `uk_tenant_slug` (`slug`),
  UNIQUE KEY `uk_tenant_uuid` (`uuid`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `usage_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `usage_types` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `type_key` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(128) COLLATE utf8mb4_unicode_ci NOT NULL,
  `keywords` text COLLATE utf8mb4_unicode_ci,
  `sort_order` int NOT NULL DEFAULT '0',
  `active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_usage_type` (`tenant_id`,`type_key`),
  KEY `idx_usage_type_tenant` (`tenant_id`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `user_job_labels`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_job_labels` (
  `user_id` bigint NOT NULL,
  `job_label_id` bigint NOT NULL,
  PRIMARY KEY (`user_id`,`job_label_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rank` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'staff',
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `must_change_password` tinyint(1) NOT NULL DEFAULT '1',
  `invited_at` datetime DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `password_changed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_tenant_email` (`tenant_id`,`email`),
  KEY `idx_user_tenant` (`tenant_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `widget_design_revisions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `widget_design_revisions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `design_id` bigint NOT NULL,
  `revision_no` int NOT NULL,
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `design_json` json NOT NULL,
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `actor_user_id` bigint DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_wdr_design_rev` (`design_id`,`revision_no`),
  KEY `idx_wdr_tenant_design` (`tenant_id`,`design_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `widget_designs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `widget_designs` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `name` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `design_json` json NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ready',
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` bigint NOT NULL,
  `updated_by` bigint DEFAULT NULL,
  `applied_at` datetime(6) DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_widget_designs_tenant_name` (`tenant_id`,`name`),
  KEY `idx_widget_designs_tenant` (`tenant_id`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

