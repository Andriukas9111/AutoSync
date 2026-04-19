-- Provider Archived Products — tracks products users have excluded
-- These products are skipped during re-imports

CREATE TABLE IF NOT EXISTS provider_archived_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  provider_sku TEXT NOT NULL,
  title TEXT,
  reason TEXT DEFAULT 'user_excluded',
  archived_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider_id, provider_sku)
);

CREATE INDEX IF NOT EXISTS idx_pap_provider ON provider_archived_products(provider_id);
CREATE INDEX IF NOT EXISTS idx_pap_shop ON provider_archived_products(shop_id);

-- Add discount_percentage to providers
ALTER TABLE providers ADD COLUMN IF NOT EXISTS discount_percentage NUMERIC;

-- Add fetch_schedule and next_scheduled_fetch for auto-scheduling
ALTER TABLE providers ADD COLUMN IF NOT EXISTS fetch_schedule TEXT DEFAULT 'manual';
ALTER TABLE providers ADD COLUMN IF NOT EXISTS next_scheduled_fetch TIMESTAMPTZ;
