-- 261023-merged-rooms-company.sql — a merged room can also be keyed on a B2B company
-- (PLN-261023-LiveChat-Merge-Company-Conversations F1-F3).
-- Apply BEFORE deploying the code. Requires 261023-merged-rooms.sql.
--
-- merged_rooms.company_id  the hotel/company the room was merged for: its later sessions
--                          auto-join like the customer's do. One room per company.
-- merged_rooms.customer_id now nullable — a room merged from a company's other staff may
--                          have no single person behind it.
-- No `AFTER <col>`: a database behind on earlier migrations would refuse it.

ALTER TABLE merged_rooms MODIFY customer_id BIGINT NULL;
ALTER TABLE merged_rooms ADD COLUMN company_id BIGINT NULL;
ALTER TABLE merged_rooms ADD UNIQUE KEY uq_mroom_tenant_company (tenant_id, company_id);

-- Rollback (after rolling the code back; only while no room has customer_id NULL):
-- ALTER TABLE merged_rooms DROP INDEX uq_mroom_tenant_company, DROP COLUMN company_id,
--   MODIFY customer_id BIGINT NOT NULL;
