-- Tracks smart collections pushed to Shopify
CREATE TABLE IF NOT EXISTS collection_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id) ON DELETE CASCADE,
  shopify_collection_id BIGINT,
  ymme_make_id INT,
  ymme_model_id INT,
  type TEXT NOT NULL,
  seo_title TEXT,
  seo_description TEXT,
  image_url TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shop_id, ymme_make_id, ymme_model_id, type)
);

CREATE INDEX IF NOT EXISTS idx_collections_shop ON collection_mappings(shop_id);
