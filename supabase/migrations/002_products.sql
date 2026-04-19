-- Products fetched from Shopify or uploaded via providers
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id) ON DELETE CASCADE,
  shopify_product_id BIGINT,
  title TEXT NOT NULL,
  description TEXT,
  handle TEXT,
  image_url TEXT,
  price DECIMAL(10,2),
  vendor TEXT,
  product_type TEXT,
  tags TEXT[] DEFAULT '{}',
  variants JSONB DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'shopify',
  provider_id UUID,
  fitment_status TEXT NOT NULL DEFAULT 'unmapped',
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shop_id, shopify_product_id)
);

CREATE INDEX IF NOT EXISTS idx_products_shop_status ON products(shop_id, fitment_status);
CREATE INDEX IF NOT EXISTS idx_products_shop_provider ON products(shop_id, provider_id);
CREATE INDEX IF NOT EXISTS idx_products_shop_created ON products(shop_id, created_at DESC);
