-- 260916-notifications-deleted-at.sql — shopper-side notification deletion
-- (PLN-260916 P3). Soft delete: the row stays for support/audit but leaves the
-- widget feed and the unread count. Idempotence: guard with
-- `SHOW COLUMNS FROM notifications LIKE 'deleted_at'`.

ALTER TABLE `notifications`
  ADD COLUMN `deleted_at` datetime DEFAULT NULL AFTER `read_at`;
