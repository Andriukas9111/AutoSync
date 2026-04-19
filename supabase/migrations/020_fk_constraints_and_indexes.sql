-- Migration 020: Add missing FK constraints + performance indexes
-- Addresses gaps found in 999_master_rebuild that dropped original FK constraints

-- ============================================================
-- 1. Add FK constraints on shop_id -> tenants(shop_id) where missing
-- ============================================================

-- providers.shop_id -> tenants
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'providers' AND constraint_name = 'fk_providers_tenant'
  ) THEN
    ALTER TABLE providers ADD CONSTRAINT fk_providers_tenant
      FOREIGN KEY (shop_id) REFERENCES tenants(shop_id) ON DELETE CASCADE;
  END IF;
END $$;

-- products.shop_id -> tenants
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'products' AND constraint_name = 'fk_products_tenant'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT fk_products_tenant
      FOREIGN KEY (shop_id) REFERENCES tenants(shop_id) ON DELETE CASCADE;
  END IF;
END $$;

-- vehicle_fitments.shop_id -> tenants
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'vehicle_fitments' AND constraint_name = 'fk_vehicle_fitments_tenant'
  ) THEN
    ALTER TABLE vehicle_fitments ADD CONSTRAINT fk_vehicle_fitments_tenant
      FOREIGN KEY (shop_id) REFERENCES tenants(shop_id) ON DELETE CASCADE;
  END IF;
END $$;

-- wheel_fitments.shop_id -> tenants
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'wheel_fitments' AND constraint_name = 'fk_wheel_fitments_tenant'
  ) THEN
    ALTER TABLE wheel_fitments ADD CONSTRAINT fk_wheel_fitments_tenant
      FOREIGN KEY (shop_id) REFERENCES tenants(shop_id) ON DELETE CASCADE;
  END IF;
END $$;

-- sync_jobs.shop_id -> tenants
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'sync_jobs' AND constraint_name = 'fk_sync_jobs_tenant'
  ) THEN
    ALTER TABLE sync_jobs ADD CONSTRAINT fk_sync_jobs_tenant
      FOREIGN KEY (shop_id) REFERENCES tenants(shop_id) ON DELETE CASCADE;
  END IF;
END $$;

-- extraction_results.shop_id -> tenants
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'extraction_results' AND constraint_name = 'fk_extraction_results_tenant'
  ) THEN
    ALTER TABLE extraction_results ADD CONSTRAINT fk_extraction_results_tenant
      FOREIGN KEY (shop_id) REFERENCES tenants(shop_id) ON DELETE CASCADE;
  END IF;
END $$;

-- collection_mappings.shop_id -> tenants
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'collection_mappings' AND constraint_name = 'fk_collection_mappings_tenant'
  ) THEN
    ALTER TABLE collection_mappings ADD CONSTRAINT fk_collection_mappings_tenant
      FOREIGN KEY (shop_id) REFERENCES tenants(shop_id) ON DELETE CASCADE;
  END IF;
END $$;

-- provider_column_mappings.shop_id -> tenants
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'provider_column_mappings' AND constraint_name = 'fk_pcm_tenant'
  ) THEN
    ALTER TABLE provider_column_mappings ADD CONSTRAINT fk_pcm_tenant
      FOREIGN KEY (shop_id) REFERENCES tenants(shop_id) ON DELETE CASCADE;
  END IF;
END $$;

-- provider_imports.shop_id -> tenants
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'provider_imports' AND constraint_name = 'fk_provider_imports_tenant'
  ) THEN
    ALTER TABLE provider_imports ADD CONSTRAINT fk_provider_imports_tenant
      FOREIGN KEY (shop_id) REFERENCES tenants(shop_id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- 2. Performance indexes for common query patterns
-- ============================================================

-- Composite index for storefront vehicle compatibility lookups
CREATE INDEX IF NOT EXISTS idx_vf_shop_make_model
  ON vehicle_fitments(shop_id, make, model);

-- Composite index for collection building queries
CREATE INDEX IF NOT EXISTS idx_vf_shop_ymme_ids
  ON vehicle_fitments(shop_id, ymme_make_id, ymme_model_id);

-- Composite index for sync job status queries
CREATE INDEX IF NOT EXISTS idx_sync_jobs_shop_type_status
  ON sync_jobs(shop_id, type, status);

-- Index for time-ordered sync job queries (dashboard recent activity)
CREATE INDEX IF NOT EXISTS idx_sync_jobs_shop_created
  ON sync_jobs(shop_id, created_at DESC);

-- Index for provider import history
CREATE INDEX IF NOT EXISTS idx_pi_provider_created
  ON provider_imports(provider_id, created_at DESC);

-- Tenants plan index (was in 001 but missing from 999)
CREATE INDEX IF NOT EXISTS idx_tenants_plan ON tenants(plan);

-- Products by source (used in product listing filter)
CREATE INDEX IF NOT EXISTS idx_products_source ON products(shop_id, source);
