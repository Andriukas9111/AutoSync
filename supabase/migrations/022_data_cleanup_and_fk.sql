-- Migration 022: Data cleanup + missing FK constraints
-- Fixes corrupt engine names (float values) and adds referential integrity

-- 1. Fix corrupt engine names that contain float values
UPDATE ymme_engines
SET name = NULL
WHERE name ~ '^[0-9]+\.[0-9]{10,}$';

-- 2. Fix corrupt modification fields
UPDATE ymme_engines
SET modification = NULL
WHERE modification ~ '^[0-9]+\.[0-9]{10,}$';

-- 3. Add missing FK: app_settings.shop_id -> tenants
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'app_settings' AND constraint_name = 'fk_app_settings_tenant') THEN
    ALTER TABLE app_settings ADD CONSTRAINT fk_app_settings_tenant FOREIGN KEY (shop_id) REFERENCES tenants(shop_id) ON DELETE CASCADE;
  END IF;
END $$;

-- 4. Add missing FK: tenant_custom_vehicles.shop_id -> tenants
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'tenant_custom_vehicles' AND constraint_name = 'fk_tcv_tenant') THEN
    ALTER TABLE tenant_custom_vehicles ADD CONSTRAINT fk_tcv_tenant FOREIGN KEY (shop_id) REFERENCES tenants(shop_id) ON DELETE CASCADE;
  END IF;
END $$;

-- 5. Add missing FK: provider_column_mappings.provider_id -> providers
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'provider_column_mappings' AND constraint_name = 'fk_pcm_provider') THEN
    ALTER TABLE provider_column_mappings ADD CONSTRAINT fk_pcm_provider FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 6. Add missing FK: provider_imports.provider_id -> providers
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'provider_imports' AND constraint_name = 'fk_pi_provider') THEN
    ALTER TABLE provider_imports ADD CONSTRAINT fk_pi_provider FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE CASCADE;
  END IF;
END $$;
