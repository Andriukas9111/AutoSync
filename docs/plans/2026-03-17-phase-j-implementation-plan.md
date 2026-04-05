# Phase J: Global Vehicle Database Expansion — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expand the YMME database from 66 to 387+ makes by scraping all auto-data.net brands with full vehicle specs, logos, and background job support.

**Architecture:** Enhanced 4-level auto-data.net scraper (brands → models → engines → full spec pages) with a new `ymme_vehicle_specs` table storing 45+ typed columns per variant. Background `scrape_jobs` table tracks long-running operations. Admin panel UI provides start/pause/resume controls with real-time progress. Make logos resolved via GitHub CDN with auto-data.net fallback.

**Tech Stack:** Supabase PostgreSQL, React Router 7, Shopify Polaris, Node.js fetch for scraping, regex-based HTML parsing (no AI).

---

## Task 1: Database Migration — New Tables & Schema Updates

**Files:**
- Create: `supabase/migrations/013_phase_j_vehicle_specs.sql`

**Step 1: Write the migration SQL**

Create the migration file with three changes:
1. `ymme_vehicle_specs` table (45+ typed columns + JSONB overflow)
2. `scrape_jobs` table (background job tracking)
3. `ALTER TABLE ymme_makes` to add `region` and `autodata_slug` columns

Schema details are in the design doc at `docs/plans/2026-03-17-phase-j-global-vehicle-database-design.md`.

Key constraints:
- `ymme_vehicle_specs.engine_id` is `UNIQUE` (one-to-one with engines)
- `scrape_jobs` is NOT tenant-scoped (admin-only global operations)
- Indexes on `engine_id`, `body_type`, `drive_type` for specs table

**Step 2: Apply migration to Supabase**

Run the migration SQL directly against the Supabase database using the dashboard SQL editor or `supabase db push`.

**Step 3: Verify tables exist**

Query `information_schema.tables` to confirm all three changes applied.

**Step 4: Commit**

```bash
git add supabase/migrations/013_phase_j_vehicle_specs.sql
git commit -m "feat: add ymme_vehicle_specs and scrape_jobs tables for Phase J"
```

---

## Task 2: Enhanced Auto-Data.net Scraper — Brand List & Logos

**Files:**
- Modify: `app/lib/scrapers/autodata.server.ts`

**Step 1: Update `fetchBrandList()` to extract logos**

The current regex pattern matches `marke_links_box` class. Update to also extract:
- Logo URL from `<img src="/img/logos/{BrandName}.png">`
- Country info if available on the page
- The brand page URL pattern `/en/{brand}-brand-{id}`

Add a `resolveLogoUrl(slug: string)` function that:
1. Tries GitHub CDN: `https://raw.githubusercontent.com/filippofilip95/car-logos-dataset/master/logos/optimized/${slug}.png`
2. Falls back to auto-data.net: `https://www.auto-data.net/img/logos/${Name}.png`
3. Returns null if neither works

**Step 2: Update `upsertMake()` to save logo_url, region, autodata_slug**

Add the new fields to the upsert call:
```typescript
{
  name: brand.name,
  slug: toSlug(brand.name),
  country: brand.country,
  logo_url: brand.logoUrl,    // resolved via resolveLogoUrl()
  region: brand.region,        // derived from country
  autodata_slug: brand.slug,   // original auto-data.net slug
  source: "auto-data.net",
  active: true,
}
```

**Step 3: Add `ScrapedBrand` interface updates**

Extend `ScrapedBrand` to include `logoUrl`, `region`, `pageUrl`.

**Step 4: Build and verify**

```bash
npx react-router build
```

**Step 5: Commit**

```bash
git add app/lib/scrapers/autodata.server.ts
git commit -m "feat: enhance brand scraper with logo extraction and region mapping"
```

---

## Task 3: Enhanced Scraper — Full Spec Page Parser

**Files:**
- Modify: `app/lib/scrapers/autodata.server.ts`

**Step 1: Add `ScrapedVehicleSpecs` interface**

Define a TypeScript interface matching all 45+ columns from `ymme_vehicle_specs`. Include every field: performance, engine details, fuel/emissions, electric, transmission, dimensions, weight, capacity, suspension, wheels, plus `rawSpecs: Record<string, string>` for overflow.

**Step 2: Add `fetchSpecsForEngine()` function**

New function that:
1. Takes a spec page URL path (e.g., `/en/bmw-3-series-sedan-g20-330e-292-hp-46498`)
2. Fetches the HTML page
3. Parses all spec rows from the data table
4. Maps each label → value into the typed `ScrapedVehicleSpecs` fields
5. Anything not recognized goes into `rawSpecs`

The spec page uses a consistent table format with label-value rows. Parse with regex:
```typescript
// Pattern for spec rows: <th>Label</th><td>Value</td>
const specRowPattern = /<t[hd][^>]*>([^<]+)<\/t[hd]>\s*<td[^>]*>([^<]+)<\/td>/gi;
```

Map labels to fields using a lookup object:
```typescript
const LABEL_MAP: Record<string, keyof ScrapedVehicleSpecs> = {
  "Top speed": "topSpeedKmh",
  "Acceleration 0 - 100 km/h": "acceleration0100",
  "Acceleration 0 - 62 mph": "acceleration060mph",
  "Length": "lengthMm",
  "Width": "widthMm",
  "Height": "heightMm",
  "Wheelbase": "wheelbaseMm",
  "Kerb Weight": "kerbWeightKg",
  "Fuel tank capacity": "fuelTankLiters",
  "Boot - Loss space": "trunkLiters",
  "Number of cylinders": "cylinders",
  "Position of cylinders": "cylinderConfig",
  "Valves per cylinder": "valvesPerCylinder",
  "Aspiration": "aspiration",
  "Number of gears": "gears",
  "Drivetrain": "driveType",
  // ... all 45+ mappings
};
```

**Step 3: Add `upsertVehicleSpecs()` function**

```typescript
async function upsertVehicleSpecs(
  engineId: string,
  specs: ScrapedVehicleSpecs,
  sourceUrl: string,
): Promise<void>
```

Upserts into `ymme_vehicle_specs` with `onConflict: "engine_id"`. Maps camelCase interface fields to snake_case DB columns.

**Step 4: Build and verify**

```bash
npx react-router build
```

**Step 5: Commit**

```bash
git add app/lib/scrapers/autodata.server.ts
git commit -m "feat: add full vehicle spec page parser with 45+ field extraction"
```

---

## Task 4: Enhanced Scraper — 4-Level Crawl with Spec Pages

**Files:**
- Modify: `app/lib/scrapers/autodata.server.ts`

**Step 1: Update `fetchEnginesForModel()` to capture spec page URLs**

The engine list page contains links to each engine's detail page. Extend `ScrapedEngine` with `specPageUrl: string | null` and extract the href from each engine row.

**Step 2: Update main `scrapeAutoData()` loop to include Level 4**

After upserting each engine, if `engine.specPageUrl` exists:
1. Sleep for rate limit delay
2. Call `fetchSpecsForEngine(engine.specPageUrl)`
3. Call `upsertVehicleSpecs(engineDbId, specs, engine.specPageUrl)`
4. Increment `specsProcessed` counter

Update `ScrapeResult` to include `specsProcessed: number`.

**Step 3: Update `fetchModelsForBrand()` to capture model page URLs**

Extract the full href pattern for each model so Level 3 can navigate directly.

**Step 4: Build and verify**

```bash
npx react-router build
```

**Step 5: Commit**

```bash
git add app/lib/scrapers/autodata.server.ts
git commit -m "feat: implement 4-level deep crawl with full spec page scraping"
```

---

## Task 5: Background Job System

**Files:**
- Modify: `app/lib/scrapers/autodata.server.ts`

**Step 1: Add job management functions**

```typescript
export async function startScrapeJob(config: {
  type: "autodata_full" | "autodata_brand" | "nhtsa";
  maxBrands?: number;
  delayMs?: number;
  resumeFrom?: string;
}): Promise<string>  // returns job ID

export async function pauseScrapeJob(jobId: string): Promise<void>

export async function resumeScrapeJob(jobId: string): Promise<void>

export async function getScrapeJobStatus(jobId: string): Promise<ScrapeJobStatus>

export async function listScrapeJobs(): Promise<ScrapeJobStatus[]>
```

**Step 2: Integrate job tracking into `scrapeAutoData()`**

Add `jobId` parameter. Between each brand:
1. Update `scrape_jobs.processed_items` and `scrape_jobs.progress`
2. Check if status has been set to `"paused"` — if so, save `resume_from` and return early
3. On completion, set status to `"completed"` with full result in `scrape_jobs.result`
4. On error, set status to `"failed"` with error message

**Step 3: Add resume logic**

When `resumeFrom` is set (from paused job or manual input):
- Skip brands alphabetically before the resume point
- Continue from that brand onwards

**Step 4: Build and verify**

```bash
npx react-router build
```

**Step 5: Commit**

```bash
git add app/lib/scrapers/autodata.server.ts
git commit -m "feat: add background job system with pause/resume for scraper"
```

---

## Task 6: Admin Panel — Auto-Data Sync UI

**Files:**
- Modify: `app/routes/app.admin._index.tsx`

**Step 1: Add imports for scraper functions**

```typescript
import {
  scrapeAutoData,
  startScrapeJob,
  pauseScrapeJob,
  resumeScrapeJob,
  listScrapeJobs,
} from "../lib/scrapers/autodata.server";
```

**Step 2: Update loader to fetch scrape job data**

Add parallel queries:
- `listScrapeJobs()` — recent scrape jobs
- Count of `ymme_vehicle_specs` rows

**Step 3: Add action handlers**

New intent cases:
- `"start-autodata-sync"` — calls `startScrapeJob({ type: "autodata_full", ... })`
- `"pause-autodata-sync"` — calls `pauseScrapeJob(jobId)`
- `"resume-autodata-sync"` — calls `resumeScrapeJob(jobId)`

**Step 4: Add Auto-Data.net sync card to YMME Database tab**

Replace the existing "Coming to Admin UI" badge with full sync controls:
- Start Full Sync button (with batch size and delay selectors)
- Pause / Resume buttons (shown based on active job status)
- Progress bar with current brand name
- Stats: brands, models, engines, specs processed
- Error count with expandable error list

**Step 5: Add Scrape Job History section**

DataTable showing all scrape_jobs:
- Columns: Type, Status, Progress, Brands, Models, Engines, Specs, Duration, Started
- Color-coded status badges

**Step 6: Build and verify**

```bash
npx react-router build
```

**Step 7: Commit**

```bash
git add app/routes/app.admin._index.tsx
git commit -m "feat: add auto-data.net sync controls to admin panel"
```

---

## Task 7: Admin Panel — Scrape Status Polling API

**Files:**
- Create: `app/routes/app.api.scrape-status.tsx`

**Step 1: Create the API route**

GET endpoint that returns the current active scrape job status:
```typescript
export const loader = async ({ request }: LoaderFunctionArgs) => {
  // Admin auth check
  // Query scrape_jobs WHERE status IN ('running', 'paused') ORDER BY created_at DESC LIMIT 1
  // Return { job, ymmeCounts }
};
```

This allows the admin UI to poll for progress updates every 5-10 seconds while a scrape is running.

**Step 2: Add polling in admin panel**

Use `useEffect` + `setInterval` to poll `/app/api/scrape-status` while a job is running. Update the progress bar and stats in real-time.

**Step 3: Build and verify**

```bash
npx react-router build
```

**Step 4: Commit**

```bash
git add app/routes/app.api.scrape-status.tsx app/routes/app.admin._index.tsx
git commit -m "feat: add scrape status polling API for real-time progress"
```

---

## Task 8: Vehicles Browser — Show Real Logos

**Files:**
- Modify: `app/routes/app.vehicles.tsx`

**Step 1: Update make rendering to use logo_url**

The vehicles browser already has a fallback initials system. Update the make row rendering:
- If `make.logo_url` exists, render `<img>` with the URL (32x32 or 36x36, object-fit contain)
- If no logo, keep the existing initials circle fallback
- Add `loading="lazy"` for performance
- Add `onError` handler to fall back to initials if image fails to load

**Step 2: Update loader to include logo_url in make query**

Ensure the makes query selects `logo_url` field.

**Step 3: Build and verify**

```bash
npx react-router build
```

**Step 4: Commit**

```bash
git add app/routes/app.vehicles.tsx
git commit -m "feat: display real make logos in vehicles browser with lazy loading"
```

---

## Task 9: Dashboard — Show Vehicle Specs Count

**Files:**
- Modify: `app/routes/app._index.tsx`

**Step 1: Add vehicle specs count to dashboard loader**

Add a parallel query for `ymme_vehicle_specs` count.

**Step 2: Display specs count in YMME stats section**

Add a "Vehicle Specs" stat card showing the count alongside existing makes/models/engines counts.

**Step 3: Build and verify**

```bash
npx react-router build
```

**Step 4: Commit**

```bash
git add app/routes/app._index.tsx
git commit -m "feat: show vehicle specs count on dashboard"
```

---

## Task 10: NHTSA Merger — Gap Filling

**Files:**
- Modify: `app/lib/scrapers/nhtsa.server.ts`

**Step 1: Update `fetchNHTSAMakes()` to skip brands already from auto-data**

After fetching NHTSA makes, check against existing `ymme_makes` entries. Only insert makes that don't already exist (auto-data takes priority for data quality).

**Step 2: Update `syncNHTSAToYMME()` to backfill `nhtsa_make_id` on auto-data makes**

For makes that exist in both NHTSA and auto-data.net, store the `nhtsa_make_id` for future VIN decoding without duplicating the make.

**Step 3: Remove the `PRIORITY_MAKES` filter**

Since auto-data now covers all major brands, NHTSA's role is gap-filling. Remove the hardcoded priority set and let it process ALL NHTSA makes that aren't already in the DB.

**Step 4: Build and verify**

```bash
npx react-router build
```

**Step 5: Commit**

```bash
git add app/lib/scrapers/nhtsa.server.ts
git commit -m "feat: update NHTSA to gap-fill after auto-data, remove priority filter"
```

---

## Task 11: Update Memory Files

**Files:**
- Modify: `C:\Users\feara\.claude\projects\C--Users-feara-Desktop-PHQ-PRODUCT\memory\project_roadmap.md`
- Modify: `C:\Users\feara\.claude\projects\C--Users-feara-Desktop-PHQ-PRODUCT\memory\database_audit.md`
- Modify: `C:\Users\feara\.claude\projects\C--Users-feara-Desktop-PHQ-PRODUCT\memory\vehicle-data-sources.md`

**Step 1: Update project_roadmap.md**

Mark Phase J as completed. Update YMME database stats.

**Step 2: Update database_audit.md**

Add `ymme_vehicle_specs` and `scrape_jobs` to the active tables list.

**Step 3: Update vehicle-data-sources.md**

Update status of auto-data.net from "need to integrate" to "fully integrated with 4-level scraper". Update current database counts.

**Step 4: Commit**

```bash
git add -A  # memory files
git commit -m "docs: update memory files for Phase J completion"
```

---

## Task 12: Final Build & Verification

**Step 1: Full build**

```bash
npx react-router build
```

**Step 2: Verify all routes load**

Check that admin panel, vehicles browser, and dashboard render without errors.

**Step 3: Run initial scrape test**

From admin panel, start a scrape with `maxBrands: 3` to verify the full 4-level pipeline works end-to-end.

**Step 4: Verify data in Supabase**

Check that `ymme_makes` has logos, `ymme_vehicle_specs` has full specs, `scrape_jobs` has a completed job.

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: Phase J complete — global vehicle database with 387 brands, full specs, logos, background sync"
```
