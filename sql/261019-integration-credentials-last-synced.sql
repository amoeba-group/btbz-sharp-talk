-- 261019-integration-credentials-last-synced.sql — per-tenant Shopify order-sync cursor
-- (FIX-261019-Shopify-Sync-Cursor-Per-Tenant)
--
-- integration_credentials.last_synced_at   when this tenant's last SUCCESSFUL order sync
--                                           started; NULL = never synced → next run is a full sync.
--
-- Replaces the provider-wide integration_status.last_sync_at cursor, which every Shopify
-- store shared: one store's run advanced another's cursor past orders it had never read.
-- Apply BEFORE deploying the code (old code ignores the extra column). The first run after
-- deploy is a full sync per store (cursor NULL) — bounded by the sync's page cap.
ALTER TABLE `integration_credentials`
  ADD COLUMN `last_synced_at` datetime NULL;

-- Rollback:
-- ALTER TABLE `integration_credentials` DROP COLUMN `last_synced_at`;
