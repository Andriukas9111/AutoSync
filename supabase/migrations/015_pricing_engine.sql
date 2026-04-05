-- ================================================================
-- 015: PRICING ENGINE
-- Markup rules, price history, and MAP enforcement
-- ================================================================

-- Pricing rules: per-tenant markup/margin rules
CREATE TABLE IF NOT EXISTS pricing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,      -- higher = applied first
  rule_type TEXT NOT NULL DEFAULT 'markup',  -- markup | margin | fixed | map
  scope_type TEXT NOT NULL DEFAULT 'global', -- global | vendor | product_type | provider | tag | sku_prefix
  scope_value TEXT,                          -- e.g. "Forge Motorsport" for vendor scope
  value DECIMAL(10,2) NOT NULL,             -- percentage or fixed amount
  round_to DECIMAL(10,2) DEFAULT 0.99,      -- round to nearest .99, .95, etc. NULL = no rounding
  min_price DECIMAL(10,2),                  -- floor price (MAP enforcement)
  max_price DECIMAL(10,2),                  -- ceiling price
  apply_to_compare_at BOOLEAN DEFAULT FALSE, -- also set compare_at_price
  compare_at_markup DECIMAL(10,2),           -- extra % for compare_at (strikethrough price)
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pricing_rules_shop ON pricing_rules(shop_id);
CREATE INDEX idx_pricing_rules_active ON pricing_rules(shop_id, is_active) WHERE is_active = TRUE;

-- Price history: track every price change for analytics
CREATE TABLE IF NOT EXISTS price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  old_price DECIMAL(10,2),
  new_price DECIMAL(10,2),
  old_compare_at DECIMAL(10,2),
  new_compare_at DECIMAL(10,2),
  rule_id UUID REFERENCES pricing_rules(id) ON DELETE SET NULL,
  rule_name TEXT,
  change_type TEXT NOT NULL DEFAULT 'rule',  -- rule | manual | provider_update | map_enforcement
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_price_history_shop ON price_history(shop_id);
CREATE INDEX idx_price_history_product ON price_history(product_id);
CREATE INDEX idx_price_history_created ON price_history(shop_id, created_at DESC);

-- Price alerts: notify when prices need attention
CREATE TABLE IF NOT EXISTS price_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL REFERENCES tenants(shop_id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,  -- margin_low | margin_high | below_map | competitor_undercut | cost_increase
  message TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning', -- info | warning | critical
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_price_alerts_shop ON price_alerts(shop_id);
CREATE INDEX idx_price_alerts_unresolved ON price_alerts(shop_id, resolved) WHERE resolved = FALSE;
