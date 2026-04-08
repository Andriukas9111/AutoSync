-- Wheel-specific fitment data
CREATE TABLE IF NOT EXISTS wheel_fitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  pcd TEXT,
  offset_min INT,
  offset_max INT,
  center_bore DECIMAL(5,2),
  diameter INT,
  width DECIMAL(4,1),
  bolt_pattern TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wheel_fitments_shop ON wheel_fitments(shop_id);
CREATE INDEX IF NOT EXISTS idx_wheel_fitments_product ON wheel_fitments(shop_id, product_id);
