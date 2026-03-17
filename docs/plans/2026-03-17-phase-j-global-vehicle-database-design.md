# Phase J: Global Vehicle Database Expansion — Design Document

**Date**: 2026-03-17
**Status**: Approved
**Goal**: Scale from 66 makes to 387+ makes with full vehicle specs, logos, and background sync

---

## Overview

Expand the YMME database by scraping ALL 387 brands from auto-data.net with full 4-level depth (brands → models → engines → full spec pages). Store 45+ typed vehicle spec fields per engine variant. Add make logos via GitHub CDN. Implement background job system for long-running scrapes.

---

## 1. Database Schema

### New table: `ymme_vehicle_specs`

One row per engine variant. 45+ typed columns for queryable data, plus JSONB overflow.

```sql
CREATE TABLE ymme_vehicle_specs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  engine_id UUID NOT NULL REFERENCES ymme_engines(id) ON DELETE CASCADE,

  -- General
  body_type TEXT,
  doors INTEGER,
  seats INTEGER,
  powertrain_type TEXT,       -- ICE, Hybrid, PHEV, BEV, FCEV

  -- Performance
  top_speed_kmh INTEGER,
  acceleration_0_100 DECIMAL(4,1),
  acceleration_0_60mph DECIMAL(4,1),

  -- Engine details (beyond ymme_engines)
  cylinders INTEGER,
  cylinder_config TEXT,        -- Inline, V, Flat/Boxer, W, Rotary
  valves_per_cylinder INTEGER,
  valvetrain TEXT,             -- SOHC, DOHC, OHV
  aspiration TEXT,             -- NA, Turbo, Supercharged, Twin-turbo
  fuel_injection TEXT,         -- Direct, Multi-port, Common rail
  engine_layout TEXT,          -- Front Transverse, Front Longitudinal, Rear, Mid
  compression_ratio TEXT,
  bore_mm DECIMAL(5,1),
  stroke_mm DECIMAL(5,1),
  oil_capacity_liters DECIMAL(4,1),

  -- Fuel & Emissions
  fuel_type_detail TEXT,       -- Petrol 95, Diesel, E85, LPG
  fuel_system TEXT,
  fuel_tank_liters DECIMAL(5,1),
  co2_emissions_gkm INTEGER,
  emission_standard TEXT,      -- Euro 6, Euro 5
  urban_consumption_l100 DECIMAL(4,1),
  extra_urban_consumption_l100 DECIMAL(4,1),
  combined_consumption_l100 DECIMAL(4,1),

  -- Electric (BEV/PHEV)
  battery_capacity_kwh DECIMAL(5,1),
  electric_range_km INTEGER,
  charging_time_hours DECIMAL(4,1),
  fast_charge_minutes INTEGER,
  electric_motor_hp INTEGER,
  electric_motor_kw INTEGER,

  -- Transmission
  transmission_type TEXT,      -- Manual, Automatic, CVT, DCT, AMT
  gears INTEGER,
  drive_type TEXT,             -- FWD, RWD, AWD, 4WD

  -- Dimensions (mm)
  length_mm INTEGER,
  width_mm INTEGER,
  width_with_mirrors_mm INTEGER,
  height_mm INTEGER,
  wheelbase_mm INTEGER,
  ground_clearance_mm INTEGER,
  front_track_mm INTEGER,
  rear_track_mm INTEGER,
  turning_diameter_m DECIMAL(4,1),

  -- Weight (kg)
  kerb_weight_kg INTEGER,
  max_weight_kg INTEGER,
  max_trunk_load_kg INTEGER,

  -- Capacity
  trunk_liters INTEGER,
  trunk_max_liters INTEGER,   -- With rear seats folded

  -- Suspension & Brakes
  front_suspension TEXT,
  rear_suspension TEXT,
  front_brakes TEXT,
  rear_brakes TEXT,
  steering_type TEXT,
  has_abs BOOLEAN,

  -- Wheels & Tyres
  tyre_size TEXT,
  wheel_rims TEXT,

  -- Overflow
  raw_specs JSONB DEFAULT '{}',

  -- Metadata
  source TEXT DEFAULT 'auto-data.net',
  source_url TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(engine_id)
);
CREATE INDEX idx_vehicle_specs_engine ON ymme_vehicle_specs(engine_id);
CREATE INDEX idx_vehicle_specs_body ON ymme_vehicle_specs(body_type);
CREATE INDEX idx_vehicle_specs_drive ON ymme_vehicle_specs(drive_type);
```

### New table: `scrape_jobs`

Background job tracking for admin-only scrape operations.

```sql
CREATE TABLE scrape_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,            -- autodata_full, autodata_brand, nhtsa
  status TEXT DEFAULT 'pending', -- pending, running, paused, completed, failed
  progress INTEGER DEFAULT 0,   -- 0-100
  total_items INTEGER DEFAULT 0,
  processed_items INTEGER DEFAULT 0,
  resume_from TEXT,              -- brand slug to resume from
  config JSONB DEFAULT '{}',    -- delay_ms, max_brands, etc.
  result JSONB DEFAULT '{}',    -- final counts and errors
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Schema updates to `ymme_makes`

```sql
ALTER TABLE ymme_makes ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE ymme_makes ADD COLUMN IF NOT EXISTS autodata_slug TEXT;
-- logo_url column already exists
```

---

## 2. Enhanced Scraper

### 4-Level Deep Crawl

```
Level 1: /en/allbrands
  → 387 brands + logo URLs + country
  → Upsert ymme_makes (name, slug, logo_url, country, region, autodata_slug)

Level 2: /en/{brand}-brand-{id}
  → Models with generation, years, body_type
  → Upsert ymme_models

Level 3: /en/{brand}-{model}-{generation}-{id}
  → Engine variants list (code, displacement, fuel, power, torque)
  → Upsert ymme_engines

Level 4: /en/{brand}-{model}-{engine}-{id}  ← NEW
  → Full spec page (40+ fields)
  → Upsert ymme_vehicle_specs
```

### Key Functions

| Function | Purpose |
|----------|---------|
| `fetchBrandList()` | Parse allbrands page, extract logos + slugs |
| `fetchModelsForBrand()` | Parse brand page for models |
| `fetchEnginesForModel()` | Parse model page for engine list |
| `fetchSpecsForEngine()` | **NEW** — Parse engine detail page for full specs |
| `parseBrandPage()` | Extract country/region from brand page |
| `resolveLogoUrl()` | GitHub CDN → auto-data fallback → null |

### Background Job System

- `startScrapeJob(type, config)` — creates job, begins scrape
- `pauseScrapeJob(jobId)` — sets status to paused, scraper checks between brands
- `resumeScrapeJob(jobId)` — sets status to running, resumes from last brand
- Progress updated after each brand completes
- Errors accumulated but don't stop the job

### Rate Limiting

- 1.5s between requests (default, configurable)
- Estimated ~32 hours for full 387-brand crawl
- Resumable at brand level

---

## 3. Make Logos Strategy

### Priority order:
1. **GitHub CDN** — `https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/{slug}.png` (387 logos, slug-based naming)
2. **Auto-data.net** — `/img/logos/{BrandName}.png` (fallback)
3. **Styled initials** — Colored circle with brand initials (ultimate fallback, already built)

### Implementation:
- During scrape, resolve logo URL using GitHub CDN slug matching
- Store resolved URL in `ymme_makes.logo_url`
- Vehicles browser already renders `logo_url` when available

---

## 4. Admin Panel UI

### New controls on YMME Database tab:

**Auto-Data.net Sync Card:**
- Start Full Sync / Resume button
- Pause / Stop button
- Progress bar with % and current brand name
- Stats: brands, models, engines, specs scraped
- Batch selector: 10 / 50 / 100 / All brands
- Delay selector: 1s / 1.5s / 2s / 3s

**Scrape Job History:**
- DataTable showing all jobs with type, status, progress, duration, results
- Click to view error details

---

## 5. NHTSA Integration

After auto-data.net scrape completes:
- Run NHTSA sync to fill gaps (brands auto-data doesn't cover)
- NHTSA provides US-only makes that auto-data may miss
- Merge: if brand exists in both, auto-data takes priority (richer data)
- NHTSA backfills `nhtsa_make_id` on matching makes

---

## 6. Data Volume Estimates

| Entity | Current | After Phase J |
|--------|---------|--------------|
| Makes | 66 | 387+ |
| Models | 2,229 | ~15,000+ |
| Engines | 20,397 | ~50,000+ |
| Vehicle Specs | 0 | ~50,000+ |
| Logos | 0 | ~350+ |

---

## 7. Future Use Cases (enabled by this data)

- **Vehicle info pages** on Shopify storefronts (specs, dimensions, performance)
- **Spec comparison widgets** (compare two vehicles side-by-side)
- **Advanced search filters** (by body type, drive type, fuel type, power range)
- **SEO-rich collection descriptions** (auto-generated from real specs)
- **Electric vehicle filtering** (battery capacity, range, charging time)

---

## Architecture Decisions

1. **Separate specs table** (not JSONB on engines) — enables SQL filtering on typed columns
2. **One-to-one with engines** — each variant gets exactly one spec row
3. **JSONB overflow** — future-proofs against new fields without migrations
4. **Scrape jobs table** — separate from tenant sync_jobs (admin-only, not tenant-scoped)
5. **GitHub CDN logos** — reliable, free, slug-matched, no hotlinking concerns
6. **Resumable by brand** — long scrape can be paused/resumed across sessions
