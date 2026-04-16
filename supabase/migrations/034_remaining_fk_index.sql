-- Migration 034: Cover the remaining FK advisor warning.
-- `fk_extraction_results_tenant` on extraction_results(shop_id) wasn't indexed.
CREATE INDEX IF NOT EXISTS idx_extraction_results_shop_id ON extraction_results(shop_id);
