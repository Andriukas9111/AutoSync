-- Which makes a tenant has activated
CREATE TABLE IF NOT EXISTS tenant_active_makes (
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id) ON DELETE CASCADE,
  ymme_make_id INT NOT NULL,
  PRIMARY KEY (shop_id, ymme_make_id)
);

-- Tenant-specific custom vehicle entries
CREATE TABLE IF NOT EXISTS tenant_custom_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id) ON DELETE CASCADE,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year_start INT,
  year_end INT,
  engine TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_custom_vehicles_shop ON tenant_custom_vehicles(shop_id);
