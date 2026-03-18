-- Migration 021: Vehicle Pages (Enterprise feature)
-- Tracks metaobject sync status per tenant per vehicle spec
-- Adds image columns to ymme_vehicle_specs for rich vehicle pages

-- 1. Vehicle page sync tracking table
CREATE TABLE IF NOT EXISTS vehicle_page_sync (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id TEXT NOT NULL REFERENCES tenants(shop_id) ON DELETE CASCADE,
    engine_id UUID NOT NULL REFERENCES ymme_engines(id) ON DELETE CASCADE,
    metaobject_gid TEXT,
    metaobject_handle TEXT,
    sync_status TEXT NOT NULL DEFAULT 'pending',
    linked_product_count INTEGER DEFAULT 0,
    synced_at TIMESTAMPTZ,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(shop_id, engine_id)
);

CREATE INDEX IF NOT EXISTS idx_vps_shop ON vehicle_page_sync(shop_id);
CREATE INDEX IF NOT EXISTS idx_vps_status ON vehicle_page_sync(shop_id, sync_status);
CREATE INDEX IF NOT EXISTS idx_vps_engine ON vehicle_page_sync(engine_id);

-- 2. Add image columns to ymme_vehicle_specs
ALTER TABLE ymme_vehicle_specs ADD COLUMN IF NOT EXISTS hero_image_url TEXT;
ALTER TABLE ymme_vehicle_specs ADD COLUMN IF NOT EXISTS gallery_images JSONB DEFAULT '[]';
ALTER TABLE ymme_vehicle_specs ADD COLUMN IF NOT EXISTS image_scraped_at TIMESTAMPTZ;

-- 3. Add vehiclePages to plan limits tracking
-- (handled in TypeScript PLAN_LIMITS, no DB change needed)

-- 4. Add metaobject definition tracking to app_settings
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS vehicle_page_metaobject_definition_id TEXT;
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS vehicle_pages_enabled BOOLEAN DEFAULT FALSE;
