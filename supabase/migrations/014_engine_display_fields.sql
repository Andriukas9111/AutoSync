-- ================================================================
-- Migration 014: Engine Display Fields
-- Denormalize key spec fields from ymme_vehicle_specs onto ymme_engines
-- for fast display name generation without JOINs.
-- Also adds display_name column for cached formatted names.
-- ================================================================

-- ── Add display-critical fields to ymme_engines ───────────────
ALTER TABLE ymme_engines ADD COLUMN IF NOT EXISTS cylinders INTEGER;
ALTER TABLE ymme_engines ADD COLUMN IF NOT EXISTS cylinder_config TEXT;    -- "Inline", "V", "Flat/Boxer", "W", "Rotary"
ALTER TABLE ymme_engines ADD COLUMN IF NOT EXISTS aspiration TEXT;         -- "NA", "Turbo", "Supercharged", "Twin-turbo"
ALTER TABLE ymme_engines ADD COLUMN IF NOT EXISTS drive_type TEXT;         -- "FWD", "RWD", "AWD", "4WD"
ALTER TABLE ymme_engines ADD COLUMN IF NOT EXISTS transmission_type TEXT;  -- "Manual", "Automatic", "DCT", "CVT"
ALTER TABLE ymme_engines ADD COLUMN IF NOT EXISTS body_type TEXT;          -- "Sedan", "SUV", "Hatchback", etc.
ALTER TABLE ymme_engines ADD COLUMN IF NOT EXISTS display_name TEXT;       -- Cached formatted display name

-- ── Backfill from ymme_vehicle_specs (if data exists) ─────────
UPDATE ymme_engines e
SET
  cylinders = s.cylinders,
  cylinder_config = s.cylinder_config,
  aspiration = s.aspiration,
  drive_type = s.drive_type,
  transmission_type = s.transmission_type,
  body_type = s.body_type
FROM ymme_vehicle_specs s
WHERE s.engine_id = e.id
  AND (e.cylinders IS NULL OR e.cylinder_config IS NULL OR e.aspiration IS NULL);

-- ── Add engine_display_format to app_settings ─────────────────
-- Tenants can choose their preferred engine display format
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS engine_display_format TEXT DEFAULT 'full';

-- ── Index for fast lookup by engine code ──────────────────────
CREATE INDEX IF NOT EXISTS idx_ymme_engines_code ON ymme_engines (code) WHERE code IS NOT NULL;

-- ── Index for display_name existence check ────────────────────
CREATE INDEX IF NOT EXISTS idx_ymme_engines_display_name ON ymme_engines (display_name) WHERE display_name IS NOT NULL;
