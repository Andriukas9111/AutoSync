-- ================================================================
-- Phase J: Global Vehicle Database Expansion
-- 1. Clean slate — delete ALL existing YMME data
-- 2. Add new columns to ymme_makes
-- 3. Create ymme_vehicle_specs table (90+ typed fields)
-- 4. Create scrape_jobs table (background job tracking)
-- ================================================================

-- ════════════════════════════════════════════════════════════════
-- STEP 1: Clean slate — remove ALL existing YMME data
-- Order matters: engines → models → aliases → makes (FK deps)
-- ════════════════════════════════════════════════════════════════
TRUNCATE TABLE ymme_engines CASCADE;
TRUNCATE TABLE ymme_models CASCADE;
TRUNCATE TABLE ymme_aliases CASCADE;
TRUNCATE TABLE ymme_makes CASCADE;

-- Also clear vehicle_fitments ymme references (SET NULL on FK)
UPDATE vehicle_fitments SET ymme_make_id = NULL, ymme_model_id = NULL, ymme_engine_id = NULL;

-- ════════════════════════════════════════════════════════════════
-- STEP 2: Add new columns to ymme_makes
-- ════════════════════════════════════════════════════════════════
ALTER TABLE ymme_makes ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE ymme_makes ADD COLUMN IF NOT EXISTS autodata_slug TEXT;
ALTER TABLE ymme_makes ADD COLUMN IF NOT EXISTS autodata_id INTEGER;

-- ════════════════════════════════════════════════════════════════
-- STEP 3: Add new columns to ymme_models
-- ════════════════════════════════════════════════════════════════
ALTER TABLE ymme_models ADD COLUMN IF NOT EXISTS autodata_slug TEXT;
ALTER TABLE ymme_models ADD COLUMN IF NOT EXISTS autodata_url TEXT;
ALTER TABLE ymme_models ADD COLUMN IF NOT EXISTS power_range TEXT;
ALTER TABLE ymme_models ADD COLUMN IF NOT EXISTS dimensions_summary TEXT;

-- ════════════════════════════════════════════════════════════════
-- STEP 4: Add new columns to ymme_engines
-- ════════════════════════════════════════════════════════════════
ALTER TABLE ymme_engines ADD COLUMN IF NOT EXISTS autodata_url TEXT;
ALTER TABLE ymme_engines ADD COLUMN IF NOT EXISTS modification TEXT;
ALTER TABLE ymme_engines ADD COLUMN IF NOT EXISTS powertrain_type TEXT;

-- ════════════════════════════════════════════════════════════════
-- STEP 5: Create ymme_vehicle_specs (90+ typed fields)
-- One row per engine variant (1:1 with ymme_engines)
-- ════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS ymme_vehicle_specs CASCADE;

CREATE TABLE ymme_vehicle_specs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_id UUID NOT NULL REFERENCES ymme_engines(id) ON DELETE CASCADE,

  -- ── General ────────────────────────────────────────────────────
  body_type TEXT,
  doors INTEGER,
  seats INTEGER,
  powertrain_type TEXT,             -- ICE, MHEV, HEV, PHEV, BEV, FCEV
  start_of_production TEXT,
  end_of_production TEXT,

  -- ── Performance ────────────────────────────────────────────────
  top_speed_kmh INTEGER,
  top_speed_mph INTEGER,
  acceleration_0_100 DECIMAL(4,1),  -- seconds
  acceleration_0_62mph DECIMAL(4,1),
  acceleration_0_60mph DECIMAL(4,1),
  weight_to_power_ratio DECIMAL(5,1), -- kg/Hp
  weight_to_torque_ratio DECIMAL(5,1), -- kg/Nm

  -- ── Engine (ICE) ───────────────────────────────────────────────
  engine_model_code TEXT,            -- e.g. "EA839 / CZSE" or "B48A20E"
  engine_layout TEXT,                -- Front Transverse, Front Longitudinal, Rear, Mid
  cylinders INTEGER,
  cylinder_config TEXT,              -- Inline, V, Flat/Boxer, W, Rotary
  valves_per_cylinder INTEGER,
  valvetrain TEXT,                   -- SOHC, DOHC, OHV
  aspiration TEXT,                   -- NA, Turbo, Supercharged, Twin-turbo, Twin-scroll
  fuel_injection TEXT,               -- Direct, Multi-port, Common rail
  compression_ratio TEXT,            -- e.g. "11.2:1"
  bore_mm DECIMAL(5,1),
  stroke_mm DECIMAL(5,1),
  power_per_litre DECIMAL(5,1),     -- Hp/l
  power_rpm TEXT,                    -- e.g. "5000-6250 rpm"
  torque_rpm TEXT,                   -- e.g. "1750-4500 rpm"
  engine_oil_capacity DECIMAL(5,2), -- liters
  coolant_capacity DECIMAL(5,2),    -- liters
  engine_systems TEXT,               -- e.g. "Start & Stop System, Particulate filter"

  -- ── Electric / Hybrid ──────────────────────────────────────────
  battery_capacity_kwh DECIMAL(6,1),      -- gross
  battery_capacity_net_kwh DECIMAL(6,1),  -- usable
  battery_voltage INTEGER,
  battery_technology TEXT,                 -- Lithium-ion, NiMH, Solid-state
  battery_weight_kg INTEGER,
  battery_location TEXT,                   -- Under floor, Under trunk, etc.
  electric_range_km INTEGER,              -- WLTP
  electric_range_nedc_km INTEGER,
  electric_range_epa_km INTEGER,
  charging_time_ac_hours DECIMAL(5,1),    -- 0-100% normal charger
  fast_charge_dc_minutes INTEGER,         -- 0-80% DC fast charge
  max_charge_power_ac_kw DECIMAL(5,1),
  max_charge_power_dc_kw DECIMAL(5,1),
  recuperation_output_kw DECIMAL(5,1),
  electric_motor_1_hp INTEGER,
  electric_motor_1_kw INTEGER,
  electric_motor_1_torque_nm INTEGER,
  electric_motor_1_location TEXT,
  electric_motor_2_hp INTEGER,
  electric_motor_2_kw INTEGER,
  electric_motor_2_torque_nm INTEGER,
  electric_motor_2_location TEXT,
  system_combined_hp INTEGER,             -- total system output for hybrids
  system_combined_torque_nm INTEGER,

  -- ── Fuel & Emissions ───────────────────────────────────────────
  fuel_type_detail TEXT,                  -- Petrol 95, Diesel, E85, LPG, Hydrogen
  fuel_system TEXT,
  fuel_tank_liters DECIMAL(5,1),
  co2_emissions_gkm INTEGER,             -- WLTP
  co2_emissions_nedc_gkm INTEGER,
  emission_standard TEXT,                 -- Euro 6, Euro 6d, etc.
  urban_consumption_l100 DECIMAL(5,1),
  extra_urban_consumption_l100 DECIMAL(5,1),
  combined_consumption_l100 DECIMAL(5,1),
  combined_consumption_wltp_l100 DECIMAL(5,1),
  fuel_consumption_wltp_text TEXT,        -- raw range text "7.6-8.3 l/100 km"

  -- ── Transmission ───────────────────────────────────────────────
  transmission_type TEXT,                 -- Manual, Automatic, CVT, DCT, AMT, Steptronic
  gears INTEGER,
  drive_type TEXT,                        -- FWD, RWD, AWD, 4WD
  drivetrain_description TEXT,            -- full text from auto-data

  -- ── Dimensions (mm) ────────────────────────────────────────────
  length_mm INTEGER,
  width_mm INTEGER,
  width_with_mirrors_mm INTEGER,
  height_mm INTEGER,
  wheelbase_mm INTEGER,
  front_track_mm INTEGER,
  rear_track_mm INTEGER,
  front_overhang_mm INTEGER,
  rear_overhang_mm INTEGER,
  ground_clearance_mm INTEGER,
  turning_diameter_m DECIMAL(4,1),
  drag_coefficient DECIMAL(3,2),          -- e.g. 0.27
  approach_angle DECIMAL(4,1),            -- degrees
  departure_angle DECIMAL(4,1),           -- degrees

  -- ── Weight (kg) ────────────────────────────────────────────────
  kerb_weight_kg INTEGER,
  max_weight_kg INTEGER,
  max_load_kg INTEGER,
  max_roof_load_kg INTEGER,

  -- ── Towing ─────────────────────────────────────────────────────
  trailer_load_braked_kg INTEGER,
  trailer_load_unbraked_kg INTEGER,
  towbar_download_kg INTEGER,

  -- ── Capacity ───────────────────────────────────────────────────
  trunk_liters INTEGER,
  trunk_max_liters INTEGER,               -- with rear seats folded

  -- ── Suspension & Brakes ────────────────────────────────────────
  front_suspension TEXT,
  rear_suspension TEXT,
  front_brakes TEXT,
  rear_brakes TEXT,
  steering_type TEXT,
  power_steering TEXT,                    -- Electric, Hydraulic
  assist_systems TEXT,                    -- ABS, ESP, etc.

  -- ── Wheels & Tyres ─────────────────────────────────────────────
  tyre_size TEXT,                          -- can be multiple sizes
  wheel_rims TEXT,

  -- ── Overflow ───────────────────────────────────────────────────
  raw_specs JSONB DEFAULT '{}',           -- any fields not mapped above

  -- ── Metadata ───────────────────────────────────────────────────
  source TEXT DEFAULT 'auto-data.net',
  source_url TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(engine_id)
);

CREATE INDEX idx_vehicle_specs_engine ON ymme_vehicle_specs(engine_id);
CREATE INDEX idx_vehicle_specs_body ON ymme_vehicle_specs(body_type);
CREATE INDEX idx_vehicle_specs_drive ON ymme_vehicle_specs(drive_type);
CREATE INDEX idx_vehicle_specs_powertrain ON ymme_vehicle_specs(powertrain_type);
CREATE INDEX idx_vehicle_specs_fuel ON ymme_vehicle_specs(fuel_type_detail);

-- ════════════════════════════════════════════════════════════════
-- STEP 6: Create scrape_jobs table (background job tracking)
-- NOT tenant-scoped — admin-only global operations
-- ════════════════════════════════════════════════════════════════
DROP TABLE IF EXISTS scrape_jobs CASCADE;

CREATE TABLE scrape_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,                     -- autodata_full, autodata_brand, nhtsa
  status TEXT NOT NULL DEFAULT 'pending', -- pending, running, paused, completed, failed
  progress INTEGER DEFAULT 0,            -- 0-100
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  current_item TEXT,                      -- current brand name being processed
  resume_from TEXT,                       -- brand slug to resume from
  config JSONB DEFAULT '{}',             -- { delayMs, maxBrands, ... }
  result JSONB DEFAULT '{}',             -- { brandsProcessed, modelsProcessed, ... }
  errors JSONB DEFAULT '[]',             -- array of error strings
  error TEXT,                            -- fatal error message
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_scrape_jobs_status ON scrape_jobs(status);
CREATE INDEX idx_scrape_jobs_type ON scrape_jobs(type);

-- ════════════════════════════════════════════════════════════════
-- Done!
-- ════════════════════════════════════════════════════════════════
SELECT 'Phase J migration complete — YMME data cleared, vehicle_specs + scrape_jobs created' AS result;
