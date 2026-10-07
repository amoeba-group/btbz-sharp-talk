-- 261008-kb-documents-video-ref.sql — the video a KB document explains
-- (PLN-261006-KB-Video-Links P1).
--
-- `https://…` is played as is; `notion:<blockId>` is a file uploaded to Notion
-- whose signed URL expires within the hour, resolved on click by
-- GET /api/v1/kb-videos/:id. NULL = no video, which is every existing row.
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard with `SHOW COLUMNS FROM kb_documents LIKE 'video_ref'`.

ALTER TABLE `kb_documents`
  ADD COLUMN `video_ref` varchar(255) DEFAULT NULL;

-- Rollback: ALTER TABLE `kb_documents` DROP COLUMN `video_ref`;
