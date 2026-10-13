-- 261018-analytics-pilot-indexes.sql — a date-window index on conversations (PLN-261012 SG-52).
--
-- WHY: the pilot analytics (and every statistics lens: journey, channels, agents, resolution) read
-- "this tenant's conversations created in [from, to)". The only indexes that lead with tenant_id are
--   idx_conv_tenant (tenant_id), idx_conv_tenant_hotel_created (tenant_id, hotel_sn, created_at), ...
-- and none of them has created_at right after tenant_id, so EXPLAIN shows
--   type=ref key=idx_conv_tenant rows=<every conversation of the tenant> Extra=Using where; Using filesort
-- i.e. the whole tenant history is read and sorted to answer a two-week question. With this index the
-- same query is a range scan over the window, already in (created_at, id) order — no filesort.
-- The cost therefore grows with the tenant's whole history, not with the window. Measured on a scratch
-- MySQL 8 with 100,000 conversations for the tenant (478,571 messages in all), statistics fresh:
-- the window read (2 calls, up to 50,000 rows each) 526 ms -> 254 ms, the 14-day pilot report 607 ms ->
-- 527 ms, the 92-day report 2.77 s -> 2.56 s; the plan changes from "read all 99,498 rows + filesort" to
-- "range over the window". The absolute gain is modest at this size and is the part that scales with
-- history (see docs/implementation/RPT-261013-w2b-analytics-pilot.md for the full table).
--
-- Not added, on purpose: moderation_logs. Its first EXPLAIN chose idx_modlog_tenant (99,626 rows) and
-- cost 7.2 s over 75 calls, but that was stale statistics straight after a bulk load; after
-- ANALYZE TABLE the optimizer picks idx_modlog_conv (1,000 rows) and the same calls cost 0.5 s. If a
-- bulk backfill ever leaves a deployment in that state, run `ANALYZE TABLE moderation_logs;` rather than
-- adding an index.
--
-- Additive and non-blocking: a plain secondary index, built online by InnoDB (concurrent reads and
-- writes continue). Old code ignores it, so apply BEFORE deploying the code, like every migration
-- (staging runs DB_SYNCHRONIZE=false). Size: ~(8 + 8 + 8) bytes per conversation row.
-- No `AFTER <col>`. Idempotence: skip when
--   `SHOW INDEX FROM conversations WHERE Key_name = 'idx_conv_tenant_created'`
-- already returns a row (the statement below fails with "Duplicate key name" if it is re-run).

ALTER TABLE `conversations`
  ADD INDEX `idx_conv_tenant_created` (`tenant_id`, `created_at`);

-- Rollback:
--   ALTER TABLE `conversations` DROP INDEX `idx_conv_tenant_created`;
