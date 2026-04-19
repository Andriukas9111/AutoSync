-- Migration 019: Provider System Upgrade
-- Adds import tracking, column mapping memory, provider metadata, product traceability

-- ============================================================
-- 1. provider_column_mappings — remembers user mapping decisions
-- ============================================================
CREATE TABLE IF NOT EXISTS provider_column_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL,
  provider_id UUID NOT NULL,
  source_column TEXT NOT NULL,
  target_field TEXT,
  transform_rule TEXT,
  is_user_edited BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(provider_id, source_column)
);
CREATE INDEX IF NOT EXISTS idx_pcm_provider ON provider_column_mappings(provider_id);
CREATE INDEX IF NOT EXISTS idx_pcm_shop ON provider_column_mappings(shop_id);

-- ============================================================
-- 2. provider_imports — full audit trail per import
-- ============================================================
CREATE TABLE IF NOT EXISTS provider_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id TEXT NOT NULL,
  provider_id UUID NOT NULL,
  file_name TEXT,
  file_size_bytes BIGINT,
  file_type TEXT,
  total_rows INTEGER NOT NULL DEFAULT 0,
  imported_rows INTEGER DEFAULT 0,
  skipped_rows INTEGER DEFAULT 0,
  duplicate_rows INTEGER DEFAULT 0,
  error_rows INTEGER DEFAULT 0,
  column_mapping JSONB,
  errors JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pi_provider ON provider_imports(provider_id);
CREATE INDEX IF NOT EXISTS idx_pi_shop ON provider_imports(shop_id);
CREATE INDEX IF NOT EXISTS idx_pi_status ON provider_imports(shop_id, status);

-- ============================================================
-- 3. Alter providers table — add metadata columns
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='providers' AND column_name='description') THEN
    ALTER TABLE providers ADD COLUMN description TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='providers' AND column_name='logo_url') THEN
    ALTER TABLE providers ADD COLUMN logo_url TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='providers' AND column_name='website_url') THEN
    ALTER TABLE providers ADD COLUMN website_url TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='providers' AND column_name='contact_email') THEN
    ALTER TABLE providers ADD COLUMN contact_email TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='providers' AND column_name='notes') THEN
    ALTER TABLE providers ADD COLUMN notes TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='providers' AND column_name='import_count') THEN
    ALTER TABLE providers ADD COLUMN import_count INTEGER DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='providers' AND column_name='last_import_id') THEN
    ALTER TABLE providers ADD COLUMN last_import_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='providers' AND column_name='duplicate_strategy') THEN
    ALTER TABLE providers ADD COLUMN duplicate_strategy TEXT DEFAULT 'skip';
  END IF;
END $$;

-- ============================================================
-- 4. Alter products table — add traceability columns
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='import_id') THEN
    ALTER TABLE products ADD COLUMN import_id UUID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='cost_price') THEN
    ALTER TABLE products ADD COLUMN cost_price NUMERIC;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='map_price') THEN
    ALTER TABLE products ADD COLUMN map_price NUMERIC;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='provider_sku') THEN
    ALTER TABLE products ADD COLUMN provider_sku TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='weight') THEN
    ALTER TABLE products ADD COLUMN weight TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='products' AND column_name='weight_unit') THEN
    ALTER TABLE products ADD COLUMN weight_unit TEXT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_import ON products(import_id);
CREATE INDEX IF NOT EXISTS idx_products_provider_sku ON products(shop_id, provider_sku);
