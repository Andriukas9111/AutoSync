/**
 * NHTSA vPIC API Integration — free US vehicle data source.
 *
 * Uses the NHTSA Vehicle Product Information Catalog (vPIC) API to
 * cross-reference and fill gaps in our YMME database. No auth required.
 *
 * API docs: https://vpic.nhtsa.dot.gov/api/
 *
 * Key endpoints used:
 *   - GetAllMakes — all US-market vehicle makes
 *   - GetModelsForMakeId — models for a specific make
 *   - GetModelsForMakeIdYear — models for a make in a specific year
 *   - GetVehicleTypesForMakeId — vehicle types (Car, Truck, MPV, etc.)
 *   - DecodeVin — full vehicle decode (for future VIN-based enrichment)
 */

import db from "../db.server";

// ── Constants ────────────────────────────────────────────────

const VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";
const RATE_LIMIT_MS = 500; // NHTSA is free but be polite
const CURRENT_YEAR = new Date().getFullYear();
const MIN_SCAN_YEAR = 1990; // Don't scan older than this

// ── Types ────────────────────────────────────────────────────

interface NHTSAMake {
  Make_ID: number;
  Make_Name: string;
}

interface NHTSAModel {
  Make_ID: number;
  Make_Name: string;
  Model_ID: number;
  Model_Name: string;
}

interface NHTSAVehicleType {
  VehicleTypeId: number;
  VehicleTypeName: string;
}

interface NHTSAResponse<T> {
  Count: number;
  Message: string;
  SearchCriteria: string | null;
  Results: T[];
}

export interface SyncResult {
  makesProcessed: number;
  newMakes: number;
  modelsProcessed: number;
  newModels: number;
  yearRangesUpdated: number;
  vehicleTypesUpdated: number;
  errors: string[];
}

// ── Helpers ──────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJSON<T>(url: string): Promise<NHTSAResponse<T>> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`NHTSA API error: HTTP ${response.status} for ${url}`);
  }

  return response.json() as Promise<NHTSAResponse<T>>;
}

/** Normalise a make/model name for consistent comparison. */
function normaliseName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s-]/g, "");
}

/** Generate a URL-safe slug from a name. */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

/** Map NHTSA vehicle type names to our body_type values. */
function mapVehicleType(nhtsaType: string): string {
  const t = nhtsaType.toLowerCase();
  if (t.includes("passenger car")) return "Sedan";
  if (t.includes("multipurpose")) return "SUV/MPV";
  if (t.includes("truck")) return "Truck";
  if (t.includes("bus")) return "Bus";
  if (t.includes("trailer")) return "Trailer";
  if (t.includes("motorcycle")) return "Motorcycle";
  if (t.includes("low speed")) return "LSV";
  return nhtsaType;
}

// ── Well-Known Makes ─────────────────────────────────────────

const PRIORITY_MAKES = new Set([
  "acura", "alfa romeo", "aston martin", "audi", "bentley", "bmw", "bugatti",
  "buick", "cadillac", "chevrolet", "chrysler", "citroen", "cupra", "dacia",
  "daewoo", "daihatsu", "dodge", "ds", "ferrari", "fiat", "fisker", "ford",
  "genesis", "gmc", "honda", "hummer", "hyundai", "infiniti", "isuzu", "jaguar",
  "jeep", "kia", "lamborghini", "land rover", "lexus", "lincoln", "lotus",
  "lucid", "maserati", "mazda", "mclaren", "mercedes-benz", "mercury", "mg",
  "mini", "mitsubishi", "nissan", "oldsmobile", "opel", "pagani", "peugeot",
  "plymouth", "polestar", "pontiac", "porsche", "ram", "renault", "rivian",
  "rolls-royce", "saab", "saturn", "scion", "seat", "skoda", "smart",
  "subaru", "suzuki", "tesla", "toyota", "vauxhall", "volkswagen", "volvo",
]);

// ── NHTSA API Functions ──────────────────────────────────────

/**
 * Fetch all makes from the NHTSA vPIC API and upsert into ymme_makes.
 */
export async function fetchNHTSAMakes(): Promise<{
  makesProcessed: number;
  newMakes: number;
}> {
  console.log("[nhtsa] Fetching all makes from NHTSA vPIC...");

  const response = await fetchJSON<NHTSAMake>(
    `${VPIC_BASE}/GetAllMakes?format=json`,
  );

  const nhtsMakes = response.Results;
  console.log(`[nhtsa] Received ${nhtsMakes.length} makes from NHTSA`);

  // Filter to well-known automotive brands
  const relevantMakes = nhtsMakes.filter((m) =>
    PRIORITY_MAKES.has(m.Make_Name.toLowerCase().trim()),
  );
  console.log(`[nhtsa] Filtered to ${relevantMakes.length} priority automotive makes`);

  // Get existing makes from our DB
  const { data: existingMakes } = await db
    .from("ymme_makes")
    .select("name")
    .eq("active", true);

  const existingNameSet = new Set(
    (existingMakes ?? []).map((m: { name: string }) => m.name.toLowerCase()),
  );

  const newMakeRows: Array<{
    name: string;
    slug: string;
    country: string;
    nhtsa_make_id: number;
    source: string;
    active: boolean;
  }> = [];

  for (const make of relevantMakes) {
    const name = normaliseName(make.Make_Name);
    if (!name || name.length < 2) continue;
    if (existingNameSet.has(name.toLowerCase())) {
      // Update nhtsa_make_id if missing
      await db
        .from("ymme_makes")
        .update({ nhtsa_make_id: make.Make_ID })
        .ilike("name", name)
        .is("nhtsa_make_id", null);
      continue;
    }

    newMakeRows.push({
      name,
      slug: toSlug(name),
      country: "US",
      nhtsa_make_id: make.Make_ID,
      source: "nhtsa",
      active: true,
    });

    existingNameSet.add(name.toLowerCase());
  }

  if (newMakeRows.length > 0) {
    for (let i = 0; i < newMakeRows.length; i += 50) {
      const chunk = newMakeRows.slice(i, i + 50);
      const { error } = await db.from("ymme_makes").upsert(chunk, { onConflict: "slug" });
      if (error) {
        console.warn(`[nhtsa] Batch upsert error (chunk ${i}):`, error.message);
        for (const row of chunk) {
          await db.from("ymme_makes").upsert(row, { onConflict: "slug" });
        }
      }
    }
  }

  console.log(
    `[nhtsa] Processed ${relevantMakes.length} priority makes, ${newMakeRows.length} new makes added`,
  );

  return { makesProcessed: relevantMakes.length, newMakes: newMakeRows.length };
}

/**
 * Fetch vehicle types for a make from NHTSA and update body_type on models.
 */
export async function fetchVehicleTypesForMake(nhtsaMakeId: number): Promise<string[]> {
  try {
    const response = await fetchJSON<NHTSAVehicleType>(
      `${VPIC_BASE}/GetVehicleTypesForMakeId/${nhtsaMakeId}?format=json`,
    );
    return response.Results
      .map((vt) => mapVehicleType(vt.VehicleTypeName))
      .filter((t) => t !== "Trailer" && t !== "Bus"); // Exclude non-automotive
  } catch {
    return [];
  }
}

/**
 * Fetch models for a specific NHTSA make ID and upsert into ymme_models.
 */
export async function fetchNHTSAModelsForMake(makeId: number): Promise<{
  modelsProcessed: number;
  newModels: number;
}> {
  const response = await fetchJSON<NHTSAModel>(
    `${VPIC_BASE}/GetModelsForMakeId/${makeId}?format=json`,
  );

  const nhtsaModels = response.Results;

  if (nhtsaModels.length === 0) {
    return { modelsProcessed: 0, newModels: 0 };
  }

  // Find the corresponding make in our DB
  const makeName = normaliseName(nhtsaModels[0].Make_Name);
  const { data: dbMake } = await db
    .from("ymme_makes")
    .select("id")
    .ilike("name", makeName)
    .maybeSingle();

  if (!dbMake) {
    console.warn(`[nhtsa] Make "${makeName}" not found in DB, skipping models`);
    return { modelsProcessed: 0, newModels: 0 };
  }

  // Get existing models for this make
  const { data: existingModels } = await db
    .from("ymme_models")
    .select("name, generation")
    .eq("make_id", dbMake.id);

  const existingModelSet = new Set(
    (existingModels ?? []).map(
      (m: { name: string; generation: string | null }) =>
        `${m.name.toLowerCase()}|${(m.generation ?? "").toLowerCase()}`,
    ),
  );

  let newModels = 0;

  for (const model of nhtsaModels) {
    const name = normaliseName(model.Model_Name);
    if (!name || name.length < 1) continue;

    const key = `${name.toLowerCase()}|`;
    if (existingModelSet.has(key)) continue;

    const { error } = await db.from("ymme_models").upsert(
      {
        make_id: dbMake.id,
        name,
        generation: null,
        year_from: null,
        year_to: null,
        body_type: null,
        nhtsa_model_id: model.Model_ID,
        source: "nhtsa",
        active: true,
      },
      { onConflict: "make_id,name,generation" },
    );

    if (!error) {
      newModels++;
      existingModelSet.add(key);
    }
  }

  return { modelsProcessed: nhtsaModels.length, newModels };
}

/**
 * Fetch models for a specific make and year from NHTSA.
 */
export async function fetchNHTSAModelsForMakeYear(
  makeId: number,
  year: number,
): Promise<NHTSAModel[]> {
  const response = await fetchJSON<NHTSAModel>(
    `${VPIC_BASE}/GetModelsForMakeIdYear/makeId/${makeId}/modelyear/${year}?format=json`,
  );
  return response.Results;
}

/**
 * Scan year ranges for models of a given make.
 * Uses binary-search-like approach to determine year_from and year_to.
 */
export async function scanYearRangesForMake(
  nhtsaMakeId: number,
  dbMakeId: string,
  options?: { delayMs?: number; onProgress?: (msg: string) => void },
): Promise<number> {
  const delayMs = options?.delayMs ?? RATE_LIMIT_MS;
  const log = options?.onProgress ?? console.log;

  // Get models for this make that need year ranges
  const { data: models } = await db
    .from("ymme_models")
    .select("id, name, year_from, year_to, nhtsa_model_id")
    .eq("make_id", dbMakeId)
    .eq("active", true);

  if (!models || models.length === 0) return 0;

  // Models that need year range scanning (year_from is null)
  const needsYears = models.filter((m: any) => m.year_from === null);
  if (needsYears.length === 0) return 0;

  // Scan in 5-year chunks to find which years each model was available
  // Start from CURRENT_YEAR and go back
  const modelYears = new Map<string, Set<number>>();

  // Initialize
  for (const model of needsYears) {
    modelYears.set(model.id, new Set());
  }

  // Build a set of model names for fast lookup
  const modelNameToId = new Map<string, string>();
  for (const model of needsYears) {
    modelNameToId.set(model.name.toLowerCase(), model.id);
  }

  // Scan years: check current year, then go back in 5-year steps for overview,
  // then fill gaps around found years
  const checkYears = [CURRENT_YEAR, CURRENT_YEAR + 1];
  for (let y = CURRENT_YEAR; y >= MIN_SCAN_YEAR; y -= 5) {
    checkYears.push(y);
  }
  // Deduplicate
  const uniqueYears = [...new Set(checkYears)].sort((a, b) => b - a);

  for (const year of uniqueYears) {
    try {
      await sleep(delayMs);
      const yearModels = await fetchNHTSAModelsForMakeYear(nhtsaMakeId, year);

      for (const ym of yearModels) {
        const name = normaliseName(ym.Model_Name).toLowerCase();
        const modelId = modelNameToId.get(name);
        if (modelId) {
          modelYears.get(modelId)!.add(year);
        }
      }
    } catch (err) {
      // Skip year on error
    }
  }

  // For models that were found, do a finer scan around the boundaries
  let updated = 0;
  for (const [modelId, years] of modelYears) {
    if (years.size === 0) continue;

    const sortedYears = [...years].sort((a, b) => a - b);
    let minYear = sortedYears[0];
    let maxYear = sortedYears[sortedYears.length - 1];

    // Refine: scan individual years around boundaries
    // Scan backwards from min
    for (let y = minYear - 1; y >= Math.max(MIN_SCAN_YEAR, minYear - 5); y--) {
      try {
        await sleep(delayMs);
        const yearModels = await fetchNHTSAModelsForMakeYear(nhtsaMakeId, y);
        const model = models.find((m: any) => m.id === modelId);
        if (model) {
          const found = yearModels.some(
            (ym) => normaliseName(ym.Model_Name).toLowerCase() === model.name.toLowerCase(),
          );
          if (found) {
            minYear = y;
          } else {
            break; // Stop scanning backwards
          }
        }
      } catch {
        break;
      }
    }

    // Scan forwards from max
    for (let y = maxYear + 1; y <= CURRENT_YEAR + 1; y++) {
      try {
        await sleep(delayMs);
        const yearModels = await fetchNHTSAModelsForMakeYear(nhtsaMakeId, y);
        const model = models.find((m: any) => m.id === modelId);
        if (model) {
          const found = yearModels.some(
            (ym) => normaliseName(ym.Model_Name).toLowerCase() === model.name.toLowerCase(),
          );
          if (found) {
            maxYear = y;
          } else {
            break;
          }
        }
      } catch {
        break;
      }
    }

    // Update the model with discovered year range
    const { error } = await db
      .from("ymme_models")
      .update({ year_from: minYear, year_to: maxYear })
      .eq("id", modelId);

    if (!error) {
      updated++;
      const model = models.find((m: any) => m.id === modelId);
      if (model) {
        log(`[nhtsa]     ${model.name}: ${minYear}–${maxYear}`);
      }
    }
  }

  return updated;
}

/**
 * Full sync: fetch all NHTSA makes, models, year ranges, and vehicle types.
 * Enhanced version that saves ALL available data.
 */
export async function syncNHTSAToYMME(options?: {
  maxMakes?: number;
  delayMs?: number;
  scanYears?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<SyncResult> {
  const maxMakes = options?.maxMakes ?? Infinity;
  const delayMs = options?.delayMs ?? RATE_LIMIT_MS;
  const scanYears = options?.scanYears ?? false;
  const log = options?.onProgress ?? console.log;

  const result: SyncResult = {
    makesProcessed: 0,
    newMakes: 0,
    modelsProcessed: 0,
    newModels: 0,
    yearRangesUpdated: 0,
    vehicleTypesUpdated: 0,
    errors: [],
  };

  // Step 1: Sync all makes
  log("[nhtsa] Step 1: Syncing makes...");
  try {
    const makesResult = await fetchNHTSAMakes();
    result.makesProcessed = makesResult.makesProcessed;
    result.newMakes = makesResult.newMakes;
    log(
      `[nhtsa] Makes done: ${makesResult.makesProcessed} processed, ${makesResult.newMakes} new`,
    );
  } catch (err) {
    const msg = `Failed to fetch NHTSA makes: ${err instanceof Error ? err.message : String(err)}`;
    result.errors.push(msg);
    log(`[nhtsa] ERROR: ${msg}`);
    return result;
  }

  // Step 2: Get makes from our DB that have nhtsa_make_id
  log("[nhtsa] Step 2: Syncing models for each make...");

  const { data: makesWithNhtsaId } = await db
    .from("ymme_makes")
    .select("id, name, nhtsa_make_id")
    .not("nhtsa_make_id", "is", null)
    .eq("active", true)
    .order("name")
    .limit(maxMakes);

  const makesToProcess = makesWithNhtsaId ?? [];

  if (makesToProcess.length === 0) {
    log("[nhtsa] No makes with NHTSA IDs found — trying to match by name...");

    // Fallback: fetch all NHTSA makes and match by name
    const response = await fetchJSON<NHTSAMake>(
      `${VPIC_BASE}/GetAllMakes?format=json`,
    );

    const { data: ourMakes } = await db
      .from("ymme_makes")
      .select("id, name")
      .eq("active", true)
      .order("name")
      .limit(maxMakes);

    if (!ourMakes) return result;

    const nhtsaByName = new Map<string, number>();
    for (const m of response.Results) {
      nhtsaByName.set(m.Make_Name.toLowerCase(), m.Make_ID);
    }

    let processedCount = 0;
    for (const make of ourMakes) {
      if (processedCount >= maxMakes) break;

      const nhtsaId = nhtsaByName.get(make.name.toLowerCase());
      if (!nhtsaId) continue;

      // Update nhtsa_make_id on the make
      await db
        .from("ymme_makes")
        .update({ nhtsa_make_id: nhtsaId })
        .eq("id", make.id);

      try {
        await sleep(delayMs);
        const modResult = await fetchNHTSAModelsForMake(nhtsaId);
        result.modelsProcessed += modResult.modelsProcessed;
        result.newModels += modResult.newModels;

        if (modResult.newModels > 0) {
          log(`[nhtsa]   ${make.name}: ${modResult.newModels} new models added`);
        }

        // Scan year ranges if enabled
        if (scanYears) {
          const yearUpdates = await scanYearRangesForMake(nhtsaId, make.id, {
            delayMs,
            onProgress: log,
          });
          result.yearRangesUpdated += yearUpdates;
        }

        processedCount++;
      } catch (err) {
        const msg = `Models fetch failed for ${make.name}: ${err instanceof Error ? err.message : String(err)}`;
        result.errors.push(msg);
      }
    }
  } else {
    // Use stored nhtsa_make_id for direct lookups
    for (const make of makesToProcess) {
      const nhtsaId = make.nhtsa_make_id as number;

      try {
        await sleep(delayMs);

        // Fetch models
        const modResult = await fetchNHTSAModelsForMake(nhtsaId);
        result.modelsProcessed += modResult.modelsProcessed;
        result.newModels += modResult.newModels;

        if (modResult.newModels > 0) {
          log(`[nhtsa]   ${make.name}: ${modResult.newModels} new models added`);
        }

        // Fetch vehicle types
        try {
          await sleep(delayMs);
          const vehicleTypes = await fetchVehicleTypesForMake(nhtsaId);
          if (vehicleTypes.length > 0) {
            // Update models that don't have body_type yet
            const primaryType = vehicleTypes[0];
            const { count } = await db
              .from("ymme_models")
              .update({ body_type: primaryType })
              .eq("make_id", make.id)
              .is("body_type", null);

            if (count && count > 0) {
              result.vehicleTypesUpdated += count;
              log(`[nhtsa]   ${make.name}: updated ${count} models with body_type "${primaryType}"`);
            }
          }
        } catch {
          // Non-critical, skip
        }

        // Scan year ranges if enabled
        if (scanYears) {
          log(`[nhtsa]   ${make.name}: scanning year ranges...`);
          const yearUpdates = await scanYearRangesForMake(nhtsaId, make.id, {
            delayMs,
            onProgress: log,
          });
          result.yearRangesUpdated += yearUpdates;
          if (yearUpdates > 0) {
            log(`[nhtsa]   ${make.name}: ${yearUpdates} models got year ranges`);
          }
        }
      } catch (err) {
        const msg = `Models fetch failed for ${make.name}: ${err instanceof Error ? err.message : String(err)}`;
        result.errors.push(msg);
      }
    }
  }

  log("[nhtsa] Sync complete.");
  log(
    `[nhtsa] Results: ${result.makesProcessed} makes (${result.newMakes} new), ` +
    `${result.modelsProcessed} models (${result.newModels} new), ` +
    `${result.yearRangesUpdated} year ranges updated, ` +
    `${result.vehicleTypesUpdated} vehicle types updated, ` +
    `${result.errors.length} errors`,
  );

  return result;
}
