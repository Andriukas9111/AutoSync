-- ═══════════════════════════════════════════════════════════════════════
-- 039: Prevent duplicate products + fitments from ever happening again
-- ═══════════════════════════════════════════════════════════════════════
--
-- Audit found 3 duplicate products (same title + handle, no shopify_product_id
-- yet) and 113 duplicate fitment rows (same product_id + make + model + year
-- + engine). Root cause: no unique constraints preventing re-insertion.
--
-- Fix:
--  1. UNIQUE INDEX on vehicle_fitments (NULL-safe via COALESCE).
--  2. UNIQUE INDEX on products (shop_id, handle) for non-staged rows.
--  3. Nightly cron as belt-and-suspenders — deletes dupes that slip in via
--     direct DB access / migrations / any path that bypasses the constraint.
--
-- The existing rows were deduped manually via MCP before this migration ran;
-- this file makes the fix replayable from scratch on a fresh DB.
-- ═══════════════════════════════════════════════════════════════════════

-- One-time cleanup (idempotent — safe on fresh DB where there are no dupes)
-- 1a. Re-parent fitments from duplicate products (same title+handle, no shopify_product_id)
--     to the earliest-created product for that title+handle. Do this BEFORE the index
--     is created so any existing dupes don't block index creation.
UPDATE vehicle_fitments vf
SET product_id = pd.keeper::uuid
FROM (
  SELECT shop_id, title, handle,
    (array_agg(id::text ORDER BY created_at))[1] as keeper,
    array_agg(id::text ORDER BY created_at) as all_ids
  FROM products
  WHERE status != 'staged' AND shopify_product_id IS NULL AND handle IS NOT NULL
  GROUP BY shop_id, title, handle HAVING count(*) > 1
) pd
WHERE vf.product_id::text = ANY(pd.all_ids[2:])
  AND vf.shop_id = pd.shop_id;

-- 1b. Delete the loser product rows now that their fitments moved away.
DELETE FROM products p
USING (
  SELECT shop_id, title, handle,
    array_agg(id::text ORDER BY created_at) as all_ids
  FROM products
  WHERE status != 'staged' AND shopify_product_id IS NULL AND handle IS NOT NULL
  GROUP BY shop_id, title, handle HAVING count(*) > 1
) pd
WHERE p.id::text = ANY(pd.all_ids[2:])
  AND p.shop_id = pd.shop_id;

-- 1c. Dedupe fitments (keep lowest id per unique tuple). Must run after
--     reparenting because reparenting can create new dupes on the keeper.
WITH dup_groups AS (
  SELECT
    product_id, shop_id,
    COALESCE(make, '') as make_k,
    COALESCE(model, '') as model_k,
    COALESCE(year_from, 0) as yf_k,
    COALESCE(year_to, 0) as yt_k,
    COALESCE(engine, '') as engine_k,
    COALESCE(group_slug, '') as gs_k,
    COALESCE(group_engine_slug, '') as ges_k,
    is_group_universal,
    MIN(id::text) as keep_id
  FROM vehicle_fitments
  GROUP BY product_id, shop_id, make_k, model_k, yf_k, yt_k, engine_k, gs_k, ges_k, is_group_universal
  HAVING count(*) > 1
)
DELETE FROM vehicle_fitments vf
USING dup_groups dg
WHERE vf.product_id = dg.product_id
  AND vf.shop_id = dg.shop_id
  AND COALESCE(vf.make,'') = dg.make_k
  AND COALESCE(vf.model,'') = dg.model_k
  AND COALESCE(vf.year_from,0) = dg.yf_k
  AND COALESCE(vf.year_to,0) = dg.yt_k
  AND COALESCE(vf.engine,'') = dg.engine_k
  AND COALESCE(vf.group_slug,'') = dg.gs_k
  AND COALESCE(vf.group_engine_slug,'') = dg.ges_k
  AND vf.is_group_universal = dg.is_group_universal
  AND vf.id::text != dg.keep_id;

-- 2. Unique constraints — the actual fix (prevents future dupes)
--    NULL-safe via COALESCE: NULL make/model/year/engine are treated as
--    equal to each other, so "same product, no vehicle data" can only
--    have ONE fitment row, not dozens.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_fitments_dedup_uniq
ON vehicle_fitments (
  shop_id, product_id,
  COALESCE(make, ''),
  COALESCE(model, ''),
  COALESCE(year_from, 0),
  COALESCE(year_to, 0),
  COALESCE(engine, ''),
  COALESCE(group_slug, ''),
  COALESCE(group_engine_slug, ''),
  is_group_universal
);

-- Products: one row per (shop_id, handle) for non-staged products. Staged
-- provider imports are intentionally not covered because the import preview
-- stages many candidate rows before the merchant commits them.
CREATE UNIQUE INDEX IF NOT EXISTS products_shop_handle_uniq
ON products (shop_id, handle)
WHERE handle IS NOT NULL AND status != 'staged';

-- 3. Nightly cron — catches any dupes that slip in through backdoor paths
--    (direct DB access, migrations, etc). Runs at 03:23 UTC, just after
--    the existing nightly-collection-dedupe at 03:17 and before any
--    business-hours traffic.
DO $$
BEGIN
  PERFORM cron.unschedule('nightly-fitment-dedupe');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'nightly-fitment-dedupe',
  '23 3 * * *',
  $$
  WITH dup_groups AS (
    SELECT
      product_id, shop_id,
      COALESCE(make, '') as make_k,
      COALESCE(model, '') as model_k,
      COALESCE(year_from, 0) as yf_k,
      COALESCE(year_to, 0) as yt_k,
      COALESCE(engine, '') as engine_k,
      COALESCE(group_slug, '') as gs_k,
      COALESCE(group_engine_slug, '') as ges_k,
      is_group_universal,
      MIN(id::text) as keep_id
    FROM vehicle_fitments
    GROUP BY product_id, shop_id, make_k, model_k, yf_k, yt_k, engine_k, gs_k, ges_k, is_group_universal
    HAVING count(*) > 1
  )
  DELETE FROM vehicle_fitments vf
  USING dup_groups dg
  WHERE vf.product_id = dg.product_id
    AND vf.shop_id = dg.shop_id
    AND COALESCE(vf.make,'') = dg.make_k
    AND COALESCE(vf.model,'') = dg.model_k
    AND COALESCE(vf.year_from,0) = dg.yf_k
    AND COALESCE(vf.year_to,0) = dg.yt_k
    AND COALESCE(vf.engine,'') = dg.engine_k
    AND COALESCE(vf.group_slug,'') = dg.gs_k
    AND COALESCE(vf.group_engine_slug,'') = dg.ges_k
    AND vf.is_group_universal = dg.is_group_universal
    AND vf.id::text != dg.keep_id;
  $$
);
