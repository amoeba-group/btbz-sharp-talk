-- 261023-session-visitor-ip.sql — visitor IP on widget sessions
-- (PLN-261023-LiveChat-Search-IP-SessionNo-B2BLink, S2)
--
-- sessions.first_ip    the address the session was first seen from (as our proxies recorded it —
--                      X-Forwarded-For read from the right, not the client-supplied first hop).
-- sessions.last_ip     the latest address; re-stamped when it changes or hourly.
-- sessions.last_ip_at  when last_ip was written.
-- Personal data: the console masks it unless the viewer holds customer.pii_reveal (audited);
-- DSAR export returns it, erasure clears it. Existing rows stay NULL (nothing was recorded before).
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.

ALTER TABLE `sessions`
  ADD COLUMN `first_ip` VARCHAR(45) NULL;
ALTER TABLE `sessions`
  ADD COLUMN `last_ip` VARCHAR(45) NULL;
ALTER TABLE `sessions`
  ADD COLUMN `last_ip_at` DATETIME NULL;

-- Rollback (after rolling the code back):
-- ALTER TABLE `sessions` DROP COLUMN `last_ip_at`, DROP COLUMN `last_ip`, DROP COLUMN `first_ip`;
