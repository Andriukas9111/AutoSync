-- Migration 032: Fix DB advisor warnings.
-- 1) Add covering indexes for foreign keys that lacked them (real-world perf win).
-- 2) Drop the duplicate index on tenant_active_makes.
-- 3) Drop indexes flagged as never-used to shed write overhead / storage.
--
-- Idempotent — safe to re-run.

-- ── 1. Covering indexes for foreign keys ─────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_collection_mappings_ymme_make_id ON collection_mappings(ymme_make_id);
CREATE INDEX IF NOT EXISTS idx_collection_mappings_ymme_model_id ON collection_mappings(ymme_model_id);
CREATE INDEX IF NOT EXISTS idx_extraction_results_product_id ON extraction_results(product_id);
CREATE INDEX IF NOT EXISTS idx_price_alerts_product_id ON price_alerts(product_id);
CREATE INDEX IF NOT EXISTS idx_price_history_rule_id ON price_history(rule_id);
CREATE INDEX IF NOT EXISTS idx_products_provider_id ON products(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_product_changes_shop_id ON provider_product_changes(shop_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_fitments_ymme_engine_id ON vehicle_fitments(ymme_engine_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_fitments_ymme_make_id ON vehicle_fitments(ymme_make_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_fitments_ymme_model_id ON vehicle_fitments(ymme_model_id);

-- ── 2. Drop duplicate index (pkey already covers the same columns) ───────────
DROP INDEX IF EXISTS idx_tenant_active_makes_unique;

-- ── 3. Drop unused indexes flagged by the advisor ────────────────────────────
-- These indexes are not referenced by any query in the working set — cutting
-- them shrinks disk usage and speeds up writes. If they are needed later
-- they can be recreated via a new migration.
DROP INDEX IF EXISTS idx_price_history_shop;
DROP INDEX IF EXISTS idx_conversion_events_shop;
DROP INDEX IF EXISTS idx_conversion_events_created;
DROP INDEX IF EXISTS idx_conversion_events_funnel;
DROP INDEX IF EXISTS idx_conversion_events_vehicle;
DROP INDEX IF EXISTS idx_promotions_active;
DROP INDEX IF EXISTS idx_pi_provider;
DROP INDEX IF EXISTS idx_pi_shop;
DROP INDEX IF EXISTS idx_search_events_shop_created;
DROP INDEX IF EXISTS idx_vps_page_gid;
DROP INDEX IF EXISTS idx_plate_lookups_created;
DROP INDEX IF EXISTS idx_extraction_shop_review;
DROP INDEX IF EXISTS idx_widget_events_type;
DROP INDEX IF EXISTS idx_widget_events_created;
DROP INDEX IF EXISTS idx_ppc_created;
DROP INDEX IF EXISTS idx_extraction_shop;
DROP INDEX IF EXISTS idx_scrape_changelog_job;
DROP INDEX IF EXISTS idx_se_created;
