# YMME Engine Name Search Design

## Decision
Use engine `name` field as primary search key for auto-mapping and suggestions.
Accuracy over coverage. Direct engine variant matching.

## DB State (2026-03-19)
- 352 makes, 7,216 models, 73,213 engines, 38,719 specs
- Engine `code` field is junk — ignore it for matching
- Engine `name` is descriptive: "M440i (374 Hp) Mild Hybrid xDrive Steptronic"

## Implementation Plan

### Phase 1: Engine Name Search in suggest-fitments
- Extract model codes from product text (140i, 440i, M40i, etc.)
- Search `ymme_engines.name` containing those codes
- Join to model → make for full vehicle info
- Score by keyword overlap (power, fuel, displacement)
- Return top matches with Make → Model → Engine → Specs → Years

### Phase 2: Ensure engine display format flows everywhere
- Settings page: engine_display_format preference
- Suggestion cards: use format
- Manual mapping: use format
- Vehicle pages: use format
- Fitment list: use format
- Push to Shopify: use format

### Phase 3: Clean data
- Continue image backfill scraper
- Fill vehicle_specs gaps (57% coverage → target 90%+)
- Remove corrupt engine names (float values)

## User Requirements
- Accuracy first (fewer but correct suggestions)
- Match to engine variant directly
- All pages reflect engine display format setting
- Vehicle pages need images
- Everything must be consistent across the entire app
