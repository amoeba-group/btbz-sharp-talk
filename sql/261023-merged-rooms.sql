-- 261023-merged-rooms.sql — one live-chat room over the same customer's sessions
-- (PLN-261023-LiveChat-Merge-Same-Customer-Sessions).
-- Apply BEFORE deploying the code (staging/production run DB_SYNCHRONIZE=false).
--
-- merged_rooms         one per customer (D5); auto_join = the customer's later
--                      sessions join on their next message (D4).
-- merged_room_sessions a session sits in at most one room; state 'excluded'
--                      remembers a session the operator took out so auto-join
--                      never brings it back (D6). added_by NULL = auto-joined.
-- A room is a view: conversations, messages, assignment and stats are untouched,
-- and dropping both tables restores the old console exactly.

CREATE TABLE IF NOT EXISTS merged_rooms (
  id          BIGINT      NOT NULL AUTO_INCREMENT,
  tenant_id   BIGINT      NOT NULL,
  customer_id BIGINT      NOT NULL,
  auto_join   TINYINT(1)  NOT NULL DEFAULT 1,
  created_by  BIGINT      NOT NULL,
  created_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at  DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mroom_tenant_customer (tenant_id, customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS merged_room_sessions (
  id         BIGINT      NOT NULL AUTO_INCREMENT,
  tenant_id  BIGINT      NOT NULL,
  room_id    BIGINT      NOT NULL,
  session_id BIGINT      NOT NULL,
  state      VARCHAR(16) NOT NULL DEFAULT 'member',
  added_by   BIGINT      NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mrs_tenant_session (tenant_id, session_id),
  KEY idx_mrs_room (room_id, state)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rollback (after rolling the code back):
-- DROP TABLE merged_room_sessions; DROP TABLE merged_rooms;
