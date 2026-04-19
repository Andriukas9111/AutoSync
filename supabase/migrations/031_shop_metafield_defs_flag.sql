-- Migration 031: Separate the "shop metafield definitions created" flag from the
-- "product metafield definitions created" flag.
--
-- Problem:
--   - app/routes/app.tsx creates SHOP-level metafield definitions (plan_tier,
--     allowed_widgets, hide_watermark) in namespace `$app:autosync`.
--   - app/lib/pipeline/metafield-definitions.server.ts creates PRODUCT-level
--     metafield definitions (make, model, year, engine, generation, data) in
--     namespace `$app:vehicle_fitment`.
--   Both paths shared the same `metafield_definitions_created` flag. Whichever
--   path ran first flipped the flag and the OTHER path silently skipped —
--   leaving half the definitions missing on some tenants.
--
-- Fix: Give each path its own flag. Safe/idempotent.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS shop_metafield_defs_created BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN tenants.shop_metafield_defs_created IS
  'SHOP-level metafield definitions ($app:autosync.* — plan_tier, allowed_widgets, hide_watermark) confirmed to exist on the merchant shop. Set by app/routes/app.tsx.';

COMMENT ON COLUMN tenants.metafield_definitions_created IS
  'PRODUCT-level metafield definitions ($app:vehicle_fitment.* — make, model, year, engine, generation, data) confirmed to exist on the merchant shop. Set by app/lib/pipeline/metafield-definitions.server.ts.';
