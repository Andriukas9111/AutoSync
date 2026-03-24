-- Migration 025: Performance Indexes
-- Adds composite indexes for the most frequently polled queries.
-- job-status.tsx polls every 5 seconds with these patterns.

-- Product status counts: WHERE shop_id = X AND fitment_status = Y
-- Used by 6 count queries (now consolidated into 1, but index still helps)
CREATE INDEX IF NOT EXISTS idx_products_shop_fitment_status
  ON products(shop_id, fitment_status);

-- Vehicle page sync status: WHERE shop_id = X AND sync_status = Y
-- Used by 4 count queries (now consolidated into 1, but index still helps)
CREATE INDEX IF NOT EXISTS idx_vehicle_page_sync_shop_status
  ON vehicle_page_sync(shop_id, sync_status);

-- Pushed products: WHERE shop_id = X AND synced_at IS NOT NULL
-- Partial index — only indexes rows that have been synced
CREATE INDEX IF NOT EXISTS idx_products_shop_synced
  ON products(shop_id) WHERE synced_at IS NOT NULL;

-- Sync jobs by shop + status (for active job polling)
CREATE INDEX IF NOT EXISTS idx_sync_jobs_shop_status
  ON sync_jobs(shop_id, status);

-- Collection mappings by shop + type (for model collection count)
CREATE INDEX IF NOT EXISTS idx_collection_mappings_shop_type
  ON collection_mappings(shop_id, type);
