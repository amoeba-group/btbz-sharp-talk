-- 261024-consult-category.sql — consult categories the shopper picks in the widget
-- (PLN-261024-Widget-Handoff-Consult-Category-Picker).
-- Apply BEFORE deploying the code (staging/production run DB_SYNCHRONIZE=false).
--
-- routing_categories.visible  1 = offered in the widget when the shopper asks for
--                             an agent (or the AI hands off); 0 = console only.
-- routing_categories.names    per-language display names {en,es,ko,vi,ja,zh}.
-- conversations.consult_category  the code the shopper picked for this thread;
--                             routing rules' category filter matches this only.
--
-- D8: the five Go2Joy regions seeded by 261024-routing-categories.sql are not
-- consult categories — region is now a customer-information condition
-- ("region" field). They are removed from unit/label scopes and deleted. Only
-- the seeded rows (name IS NULL) go; a tenant's own row with the same code stays.

ALTER TABLE routing_categories
  ADD COLUMN visible TINYINT(1) NOT NULL DEFAULT 0 AFTER sort_order,
  ADD COLUMN names   JSON       NULL               AFTER visible;

ALTER TABLE conversations
  ADD COLUMN consult_category    VARCHAR(64) NULL,
  ADD COLUMN consult_category_at DATETIME(6) NULL;

-- Check first: a routing rule still naming a region code in its category filter.
-- Expected 0 rows on staging/production (2026-10-24). If any, move the codes to a
-- customer-information "region" condition in the console before going on.
SELECT tenant_id, JSON_EXTRACT(handoff_config, '$.routingRules[*].regions') AS rule_categories
  FROM tenant_ai_config
 WHERE JSON_OVERLAPS(COALESCE(JSON_EXTRACT(handoff_config, '$.routingRules[*].regions[*]'), JSON_ARRAY()),
                     JSON_ARRAY('north', 'north_center', 'central', 'south_center', 'south'));

-- Unit / label scopes: drop the five region codes (an emptied list becomes NULL).
UPDATE units u
   SET u.regions = (
     SELECT JSON_ARRAYAGG(j.v) FROM JSON_TABLE(u.regions, '$[*]' COLUMNS (v VARCHAR(64) PATH '$')) j
      WHERE j.v NOT IN ('north', 'north_center', 'central', 'south_center', 'south'))
 WHERE JSON_OVERLAPS(u.regions, JSON_ARRAY('north', 'north_center', 'central', 'south_center', 'south'));

UPDATE job_labels l
   SET l.regions = (
     SELECT JSON_ARRAYAGG(j.v) FROM JSON_TABLE(l.regions, '$[*]' COLUMNS (v VARCHAR(64) PATH '$')) j
      WHERE j.v NOT IN ('north', 'north_center', 'central', 'south_center', 'south'))
 WHERE JSON_OVERLAPS(l.regions, JSON_ARRAY('north', 'north_center', 'central', 'south_center', 'south'));

DELETE FROM routing_categories
 WHERE code IN ('north', 'north_center', 'central', 'south_center', 'south')
   AND name IS NULL;

-- Rollback (after rolling the code back):
-- ALTER TABLE conversations DROP COLUMN consult_category_at, DROP COLUMN consult_category;
-- ALTER TABLE routing_categories DROP COLUMN names, DROP COLUMN visible;
-- (the deleted rows and scopes come back from the pre-deploy backup or 261024-routing-categories.sql)
