-- 261017-hotel-provinces.sql — hotel → province table (PLN-261012 SG-67, REQ-261007 R3).
--
-- For hosts that sign a hotelSn in the identify claims but NOT the hotel's province: the
-- tenant uploads a CSV (console → AI settings → Hotel region table) and region routing
-- falls back to this table, keyed ONLY by the signed hotelSn — never by an unsigned hotel
-- name or code. The province a signed claim carries always wins over this table.
-- The console replaces the whole table in one transaction (delete + insert), so a partial
-- upload never leaves a mixed table.
-- New table only: nothing existing changes, and an empty table means region routing behaves
-- exactly as before.
-- Idempotence: CREATE TABLE IF NOT EXISTS.
-- Rollback: DROP TABLE `hotel_provinces`;

CREATE TABLE IF NOT EXISTS `hotel_provinces` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `hotel_sn` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  `province` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_hotel_province` (`tenant_id`,`hotel_sn`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
