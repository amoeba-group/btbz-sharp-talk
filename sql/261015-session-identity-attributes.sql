-- 261015-session-identity-attributes.sql — signed facts about the signed-in user
-- (PLN-261015-SharpTalk-for-Go2Joy D2)
--
-- sessions.identity_attributes: `{ "hotel_id": "...", "hotel_name": "...",
-- "region": "north|central|south", "province": "...", "role": "manager|reception" }`
-- Written only by a verified /public/embed/identify whose HMAC covered these
-- values; read by handoff routing (D3) and shown in the console (D5).
-- NULL = guest, or a host that signs only the user id — every existing session.
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Run BEFORE deploying the backend (old code + new column = safe).
-- Idempotence: guard with `SHOW COLUMNS FROM sessions LIKE 'identity_attributes'`.

ALTER TABLE `sessions`
  ADD COLUMN `identity_attributes` json NULL;

-- Rollback (old code never reads it): ALTER TABLE `sessions` DROP COLUMN `identity_attributes`;
