-- 261016-kb-ui-version.sql — KB documents stamped with the product UI version they describe,
-- plus the tenant's reference version and what to do on a mismatch
-- (PLN-261012 SG-20, REQ FR-010 / R10).
--
-- Three additive nullable columns — old code ignores them, so apply BEFORE deploying the code
-- (staging runs DB_SYNCHRONIZE=false):
--   kb_documents.ui_version             the version the document describes, as typed ("v23.3.0",
--                                       "0.12.0"). NULL = unversioned: never caveated in an answer,
--                                       flagged "unversioned" in the console. Every existing row.
--   kb_document_revisions.ui_version    the same, snapshotted per revision. NULL = "not recorded"
--                                       (every revision written before this file) — a restore leaves
--                                       the document's own version alone for those; '' = "recorded,
--                                       the document was unversioned".
--   tenant_ai_config.kb_version_policy  JSON { referenceVersion, onMismatch: caveat|hide|off, notice{lang} }.
--                                       NULL = no stamping: answers and retrieval are untouched.
-- The "verified on" date is the existing kb_documents.reviewed_at — no new date column.
--
-- The version AXIS is not decided (Go2Joy's policy CSV cites Hotel Admin v23.3.0/v23.4.0, the requirements
-- document cites v0.4.1-v0.12.0), so the column is an opaque label compared for equality after
-- trim / lower-case / dropping one leading "v" before a digit. Nothing is backfilled here.
--
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard each statement with `SHOW COLUMNS FROM <table> LIKE '<column>'`.
--
-- ⚠️ If a LATER backfill touches kb_documents rows (e.g. stamping the Go2Joy policy documents), assign
-- `updated_at = updated_at` in the same UPDATE. updated_at is ON UPDATE CURRENT_TIMESTAMP, so any
-- UPDATE otherwise rewrites every touched document's "last edited" to the migration time and destroys the
-- staleness signal (migration_kb_provenance.sql, observed on staging 2026-08-04). Template:
--   UPDATE kb_documents SET ui_version = 'v23.3.0', updated_at = updated_at
--    WHERE tenant_id = <id> AND external_key LIKE 'GTJ-HA-POL-%' AND ui_version IS NULL;

ALTER TABLE `kb_documents`
  ADD COLUMN `ui_version` varchar(16) DEFAULT NULL;

ALTER TABLE `kb_document_revisions`
  ADD COLUMN `ui_version` varchar(16) DEFAULT NULL;

ALTER TABLE `tenant_ai_config`
  ADD COLUMN `kb_version_policy` json DEFAULT NULL;

-- Rollback (nothing reads the columns before this release):
--   ALTER TABLE `kb_documents` DROP COLUMN `ui_version`;
--   ALTER TABLE `kb_document_revisions` DROP COLUMN `ui_version`;
--   ALTER TABLE `tenant_ai_config` DROP COLUMN `kb_version_policy`;
