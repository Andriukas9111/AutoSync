-- External data providers (CSV, XML, API, FTP)
CREATE TABLE IF NOT EXISTS providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'csv',
  config JSONB DEFAULT '{}',
  schedule_cron TEXT,
  last_fetch TIMESTAMPTZ,
  product_count INT DEFAULT 0,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shop_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_providers_shop ON providers(shop_id);

-- Now add foreign key from products to providers
ALTER TABLE products ADD CONSTRAINT fk_products_provider
  FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL;
