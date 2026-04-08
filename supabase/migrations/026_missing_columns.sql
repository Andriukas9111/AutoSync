-- Migration 026: Missing columns and tables found during full audit (2026-03-25)
-- These columns exist in production Supabase (added manually) but were never
-- captured in migration files. This migration ensures they exist.

-- ============================================================
-- 1. TENANTS — missing columns used by app.tsx + Edge Function
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS shopify_access_token TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS online_store_publication_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS metafield_definitions_created BOOLEAN DEFAULT FALSE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS shopify_app_id TEXT;

-- ============================================================
-- 2. SYNC_JOBS — locked_at for Edge Function job locking
-- ============================================================
ALTER TABLE sync_jobs ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

-- ============================================================
-- 3. PLATE_LOOKUPS — analytics table for UK reg lookups
-- ============================================================
CREATE TABLE IF NOT EXISTS plate_lookups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id) ON DELETE CASCADE,
  plate TEXT NOT NULL,
  make TEXT,
  model TEXT,
  year INTEGER,
  fuel_type TEXT,
  colour TEXT,
  source TEXT DEFAULT 'dvla',
  resolved_make_id UUID,
  resolved_model_id UUID,
  resolved_engine_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plate_lookups_shop ON plate_lookups(shop_id);
CREATE INDEX IF NOT EXISTS idx_plate_lookups_created ON plate_lookups(created_at DESC);

-- ============================================================
-- 4. COMPARE_AT_PRICE — only in master rebuild, not incremental
-- ============================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS compare_at_price NUMERIC(10,2);
