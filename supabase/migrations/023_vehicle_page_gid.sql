-- Migration 023: Add page_gid to vehicle_page_sync
-- Tracks the Shopify Page GID alongside the metaobject GID.
-- Vehicle pages now render via Shopify Pages (HTML) instead of metaobject onlineStore.

ALTER TABLE vehicle_page_sync ADD COLUMN IF NOT EXISTS page_gid TEXT;
ALTER TABLE vehicle_page_sync ADD COLUMN IF NOT EXISTS page_handle TEXT;

CREATE INDEX IF NOT EXISTS idx_vps_page_gid ON vehicle_page_sync(page_gid) WHERE page_gid IS NOT NULL;
