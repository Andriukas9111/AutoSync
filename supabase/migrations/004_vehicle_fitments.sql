-- Product-to-vehicle fitment mappings
CREATE TABLE IF NOT EXISTS vehicle_fitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ymme_make_id INT,
  ymme_model_id INT,
  ymme_engine_id INT,
  year_start INT,
  year_end INT,
  method TEXT NOT NULL DEFAULT 'manual',
  confidence DECIMAL(3,2) DEFAULT 1.0,
  reviewed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shop_id, product_id, ymme_make_id, ymme_model_id, ymme_engine_id, year_start, year_end)
);

CREATE INDEX IF NOT EXISTS idx_fitments_shop_product ON vehicle_fitments(shop_id, product_id);
CREATE INDEX IF NOT EXISTS idx_fitments_shop_make ON vehicle_fitments(shop_id, ymme_make_id);
