-- ================================================================
-- AUTOSYNC V3 — MASTER SCHEMA REBUILD
-- Drops ALL app tables and recreates from scratch
-- Does NOT touch the "Session" table (Prisma session storage)
-- ================================================================

-- Drop all existing tables in dependency order
DROP TABLE IF EXISTS search_events CASCADE;
DROP TABLE IF EXISTS extraction_results CASCADE;
DROP TABLE IF EXISTS collection_mappings CASCADE;
DROP TABLE IF EXISTS tenant_active_makes CASCADE;
DROP TABLE IF EXISTS tenant_custom_vehicles CASCADE;
DROP TABLE IF EXISTS vehicle_fitments CASCADE;
DROP TABLE IF EXISTS wheel_fitments CASCADE;
DROP TABLE IF EXISTS wheel_specs CASCADE;
DROP TABLE IF EXISTS sync_jobs CASCADE;
DROP TABLE IF EXISTS app_settings CASCADE;
DROP TABLE IF EXISTS review_queue CASCADE;
DROP TABLE IF EXISTS sync_log CASCADE;
DROP TABLE IF EXISTS import_jobs CASCADE;
DROP TABLE IF EXISTS ymme_engines CASCADE;
DROP TABLE IF EXISTS ymme_models CASCADE;
DROP TABLE IF EXISTS ymme_aliases CASCADE;
DROP TABLE IF EXISTS ymme_makes CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS providers CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;

-- ================================================================
-- 1. TENANTS (root table)
-- ================================================================
CREATE TABLE tenants (
  shop_id TEXT PRIMARY KEY,
  shop_domain TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  plan_status TEXT DEFAULT 'active',
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  uninstalled_at TIMESTAMPTZ,
  scopes TEXT,
  product_count INTEGER DEFAULT 0,
  fitment_count INTEGER DEFAULT 0
);

-- ================================================================
-- 2. PROVIDERS
-- ================================================================
CREATE TABLE providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT,
  type TEXT NOT NULL DEFAULT 'csv',
  url TEXT,
  api_key TEXT,
  api_secret TEXT,
  config JSONB DEFAULT '{}',
  fetch_schedule TEXT,
  product_count INTEGER DEFAULT 0,
  last_fetch_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_providers_shop ON providers(shop_id);

-- ================================================================
-- 3. PRODUCTS
-- ================================================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL,
  shopify_product_id TEXT,
  shopify_gid TEXT,
  title TEXT,
  description TEXT,
  handle TEXT,
  vendor TEXT,
  product_type TEXT,
  price TEXT,
  compare_at_price NUMERIC,
  image_url TEXT,
  tags JSONB DEFAULT '[]',
  variants JSONB,
  sku TEXT,
  barcode TEXT,
  source TEXT,
  provider_id UUID REFERENCES providers(id) ON DELETE SET NULL,
  fitment_status TEXT DEFAULT 'unmapped',
  status TEXT DEFAULT 'active',
  raw_data JSONB,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shop_id, shopify_product_id)
);
CREATE INDEX idx_products_shop ON products(shop_id);
CREATE INDEX idx_products_fitment_status ON products(shop_id, fitment_status);
CREATE INDEX idx_products_created ON products(created_at DESC);

-- ================================================================
-- 4. YMME MAKES
-- ================================================================
CREATE TABLE ymme_makes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT,
  country TEXT,
  logo_url TEXT,
  active BOOLEAN DEFAULT TRUE,
  nhtsa_make_id INTEGER,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(name)
);
CREATE INDEX idx_ymme_makes_active ON ymme_makes(active);
CREATE UNIQUE INDEX idx_ymme_makes_slug ON ymme_makes(slug) WHERE slug IS NOT NULL;

-- ================================================================
-- 5. YMME MODELS
-- ================================================================
CREATE TABLE ymme_models (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  make_id UUID NOT NULL REFERENCES ymme_makes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  generation TEXT,
  year_from INTEGER,
  year_to INTEGER,
  body_type TEXT,
  active BOOLEAN DEFAULT TRUE,
  nhtsa_model_id INTEGER,
  source TEXT,
  UNIQUE(make_id, name, generation)
);
CREATE INDEX idx_ymme_models_make ON ymme_models(make_id);
CREATE INDEX idx_ymme_models_active ON ymme_models(active);

-- ================================================================
-- 6. YMME ENGINES
-- ================================================================
CREATE TABLE ymme_engines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id UUID NOT NULL REFERENCES ymme_models(id) ON DELETE CASCADE,
  code TEXT,
  name TEXT,
  displacement_cc INTEGER,
  fuel_type TEXT,
  power_hp INTEGER,
  power_kw INTEGER,
  torque_nm INTEGER,
  year_from INTEGER,
  year_to INTEGER,
  active BOOLEAN DEFAULT TRUE,
  UNIQUE(model_id, name)
);
CREATE INDEX idx_ymme_engines_model ON ymme_engines(model_id);

-- ================================================================
-- 7. YMME ALIASES
-- ================================================================
CREATE TABLE ymme_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alias TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL
);
CREATE INDEX idx_ymme_aliases_type ON ymme_aliases(entity_type);
CREATE INDEX idx_ymme_aliases_alias ON ymme_aliases(alias);

-- ================================================================
-- 8. VEHICLE FITMENTS
-- ================================================================
CREATE TABLE vehicle_fitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  shop_id TEXT NOT NULL,
  shop_domain TEXT,
  make TEXT,
  model TEXT,
  variant TEXT,
  generation TEXT,
  year_from INTEGER,
  year_to INTEGER,
  engine TEXT,
  engine_code TEXT,
  fuel_type TEXT,
  extraction_method TEXT,
  confidence NUMERIC DEFAULT 0,
  confidence_score NUMERIC DEFAULT 0,
  source_text TEXT,
  method TEXT,
  ymme_make_id UUID REFERENCES ymme_makes(id),
  ymme_model_id UUID REFERENCES ymme_models(id),
  ymme_engine_id UUID REFERENCES ymme_engines(id),
  reviewed BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_vf_product ON vehicle_fitments(product_id);
CREATE INDEX idx_vf_shop ON vehicle_fitments(shop_id);
CREATE INDEX idx_vf_make_model ON vehicle_fitments(make, model);
CREATE INDEX idx_vf_years ON vehicle_fitments(year_from, year_to);

-- ================================================================
-- 9. WHEEL FITMENTS
-- ================================================================
CREATE TABLE wheel_fitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  shop_id TEXT NOT NULL,
  pcd TEXT,
  offset_min NUMERIC,
  offset_max NUMERIC,
  center_bore NUMERIC,
  diameter INTEGER,
  width NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_wf_product ON wheel_fitments(product_id);
CREATE INDEX idx_wf_shop ON wheel_fitments(shop_id);
CREATE INDEX idx_wf_pcd ON wheel_fitments(pcd);

-- ================================================================
-- 10. SYNC JOBS
-- ================================================================
CREATE TABLE sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER DEFAULT 0,
  total_items INTEGER,
  processed_items INTEGER DEFAULT 0,
  error TEXT,
  metadata JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_sync_jobs_shop ON sync_jobs(shop_id, status);
CREATE INDEX idx_sync_jobs_type ON sync_jobs(shop_id, type);

-- ================================================================
-- 11. EXTRACTION RESULTS
-- ================================================================
CREATE TABLE extraction_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  shop_id TEXT NOT NULL,
  extraction_method TEXT,
  signals JSONB,
  fused_fitments JSONB,
  overall_confidence NUMERIC DEFAULT 0,
  diagnostics JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_extraction_product ON extraction_results(product_id);
CREATE INDEX idx_extraction_shop ON extraction_results(shop_id);

-- ================================================================
-- 12. COLLECTION MAPPINGS
-- ================================================================
CREATE TABLE collection_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL,
  shopify_collection_id BIGINT,
  ymme_make_id UUID REFERENCES ymme_makes(id),
  ymme_model_id UUID REFERENCES ymme_models(id),
  type TEXT NOT NULL DEFAULT 'make',
  title TEXT,
  handle TEXT,
  strategy TEXT,
  make TEXT,
  model TEXT,
  image_url TEXT,
  seo_title TEXT,
  seo_description TEXT,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(shop_id, ymme_make_id, ymme_model_id, type)
);
CREATE INDEX idx_cm_shop ON collection_mappings(shop_id);

-- ================================================================
-- 13. APP SETTINGS
-- ================================================================
CREATE TABLE app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL UNIQUE,
  tag_prefix TEXT DEFAULT '_autosync_',
  collection_strategy TEXT DEFAULT 'make',
  push_tags BOOLEAN DEFAULT TRUE,
  push_metafields BOOLEAN DEFAULT TRUE,
  push_collections BOOLEAN DEFAULT TRUE,
  push_tags_enabled BOOLEAN DEFAULT TRUE,
  push_metafields_enabled BOOLEAN DEFAULT TRUE,
  auto_create_collections BOOLEAN DEFAULT FALSE,
  engine_display_format TEXT DEFAULT 'code',
  active_widgets JSONB DEFAULT '[]',
  notification_email TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ================================================================
-- 14. TENANT ACTIVE MAKES
-- ================================================================
CREATE TABLE tenant_active_makes (
  shop_id TEXT NOT NULL,
  ymme_make_id UUID NOT NULL,
  PRIMARY KEY (shop_id, ymme_make_id)
);
CREATE INDEX idx_tam_shop ON tenant_active_makes(shop_id);

-- ================================================================
-- 15. TENANT CUSTOM VEHICLES
-- ================================================================
CREATE TABLE tenant_custom_vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL,
  make TEXT NOT NULL,
  model TEXT NOT NULL,
  year_start INTEGER,
  year_end INTEGER,
  engine TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_tcv_shop ON tenant_custom_vehicles(shop_id);

-- ================================================================
-- 16. SEARCH EVENTS
-- ================================================================
CREATE TABLE search_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL,
  event_type TEXT NOT NULL DEFAULT 'ymme_search',
  search_make TEXT,
  search_model TEXT,
  search_year TEXT,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_se_shop ON search_events(shop_id);
CREATE INDEX idx_se_created ON search_events(created_at DESC);
CREATE INDEX idx_se_make_model ON search_events(shop_id, search_make, search_model);

-- ================================================================
-- Done! All 16 tables created.
-- ================================================================
SELECT 'Schema rebuild complete — 16 tables created' AS result;
