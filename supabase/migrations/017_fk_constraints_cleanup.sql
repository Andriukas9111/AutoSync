-- FK constraints cleanup — adds missing foreign keys and unique constraints
-- Fixes issues identified in schema audit (search_events, conversion_events, providers)

-- 1. search_events: add FK to tenants with CASCADE delete
-- (silently skip if constraint already exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_search_events_tenant'
  ) THEN
    ALTER TABLE search_events
      ADD CONSTRAINT fk_search_events_tenant
      FOREIGN KEY (shop_id) REFERENCES tenants(shop_id) ON DELETE CASCADE;
  END IF;
END $$;

-- 2. conversion_events: add FK to tenants with CASCADE delete
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_conversion_events_tenant'
  ) THEN
    ALTER TABLE conversion_events
      ADD CONSTRAINT fk_conversion_events_tenant
      FOREIGN KEY (shop_id) REFERENCES tenants(shop_id) ON DELETE CASCADE;
  END IF;
END $$;

-- 3. providers: add unique constraint on (shop_id, name) to prevent duplicates
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_providers_shop_name'
  ) THEN
    ALTER TABLE providers
      ADD CONSTRAINT uq_providers_shop_name UNIQUE (shop_id, name);
  END IF;
END $$;

-- Comment
COMMENT ON CONSTRAINT fk_search_events_tenant ON search_events IS 'Cascade delete search events when tenant is removed';
COMMENT ON CONSTRAINT fk_conversion_events_tenant ON conversion_events IS 'Cascade delete conversion events when tenant is removed';
