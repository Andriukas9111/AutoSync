-- Tenant management table
CREATE TABLE IF NOT EXISTS tenants (
  shop_id TEXT PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  plan_status TEXT NOT NULL DEFAULT 'active',
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  uninstalled_at TIMESTAMPTZ,
  scopes TEXT,
  product_count INT DEFAULT 0,
  fitment_count INT DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tenants_plan ON tenants(plan);
