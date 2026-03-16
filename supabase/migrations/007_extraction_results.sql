-- Results from auto fitment extraction engine
CREATE TABLE IF NOT EXISTS extraction_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  signals JSONB NOT NULL,
  matched_vehicles JSONB,
  confidence DECIMAL(3,2),
  needs_review BOOLEAN DEFAULT FALSE,
  review_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shop_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_extraction_shop_review ON extraction_results(shop_id, needs_review);
