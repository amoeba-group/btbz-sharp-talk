-- 261024-routing-categories.sql — tenant-managed routing categories
-- (PLN-261024-Settings-Handoff-Tab-Routing-Categories D3/D4).
-- Apply BEFORE deploying the code (staging/production run DB_SYNCHRONIZE=false).
--
-- The routing rules' "region" axis becomes "category": a tenant-owned list of
-- codes the session's signed `region` value is matched against. Codes are what
-- rules, unit/label scopes and companies already store, so nothing else moves.
-- name NULL = the console shows its built-in localized name (the five Go2Joy
-- regions) or the code itself.

CREATE TABLE IF NOT EXISTS routing_categories (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  tenant_id  BIGINT       NOT NULL,
  code       VARCHAR(64)  NOT NULL,
  name       VARCHAR(100) NULL,
  sort_order INT          NOT NULL DEFAULT 0,
  created_at DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_rcat_tenant_code (tenant_id, code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- D4: the five regions, only for tenants that route on regions today (province
-- map, unit/label scope, company region, or a rule's regions). Idempotent.
INSERT IGNORE INTO routing_categories (tenant_id, code, name, sort_order)
SELECT t.tenant_id, r.code, NULL, r.sort_order
FROM (
  SELECT tenant_id FROM tenant_ai_config
   WHERE JSON_LENGTH(COALESCE(JSON_EXTRACT(handoff_config, '$.provinceRegions'), JSON_OBJECT())) > 0
      OR JSON_LENGTH(COALESCE(JSON_EXTRACT(handoff_config, '$.routingRules[*].regions[*]'), JSON_ARRAY())) > 0
  UNION SELECT tenant_id FROM units      WHERE JSON_LENGTH(COALESCE(regions, JSON_ARRAY())) > 0
  UNION SELECT tenant_id FROM job_labels WHERE JSON_LENGTH(COALESCE(regions, JSON_ARRAY())) > 0
  UNION SELECT tenant_id FROM companies  WHERE region IS NOT NULL AND region <> ''
) t
CROSS JOIN (
  SELECT 'north' AS code, 10 AS sort_order
  UNION ALL SELECT 'north_center', 20
  UNION ALL SELECT 'central', 30
  UNION ALL SELECT 'south_center', 40
  UNION ALL SELECT 'south', 50
) r;

-- Rollback (after rolling the code back):
-- DROP TABLE routing_categories;
