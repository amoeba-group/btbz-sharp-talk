-- 261023-tenant-host-terms-trust.sql — which host sign-ins count as consent (PLN-261023 1-1)
--
-- tenants.host_terms_trust  'signed' (default) | 'claimed'
--   Only read when consent_source = 'host_terms'.
--   'signed'  — only a SIGNED identify records consent via the host's terms (today's behaviour).
--   'claimed' — an UNSIGNED identify kept as 'claimed' (tenant on EMBED_UNSIGNED_IDENTIFY_TENANT_IDS)
--               also records consent. UAT aid before the host can sign; customer/company
--               registration and thread continuity stay signed-only.
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.
-- Idempotence: guard with `SHOW COLUMNS FROM tenants LIKE 'host_terms_trust'`.

ALTER TABLE `tenants`
  ADD COLUMN `host_terms_trust` varchar(16) NOT NULL DEFAULT 'signed';

-- Rollback:
-- ALTER TABLE `tenants` DROP COLUMN `host_terms_trust`;
