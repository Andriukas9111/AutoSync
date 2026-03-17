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
 */

import db from "../db.server";

// ── Constants ────────────────────────────────────────────────

const VPIC_BASE = "https://vpic.nhtsa.dot.gov/api/vehicles";
const RATE_LIMIT_MS = 500; // NHTSA is free but be polite

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
  errors: string[];
}

// ── Helpers ──────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJSON<T>(url: string): Promise<NHTSAResponse<T>> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
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

// ── NHTSA API Functions ──────────────────────────────────────

/**
 * Fetch all makes from the NHTSA vPIC API and upsert into ymme_makes.
 * Only adds makes that don't already exist (by name match).
 */
/**
 * Well-known automotive makes to prioritise. NHTSA returns ~10,000 makes
 * including obscure trailers, motorcycles, etc. We only want real car/truck brands.
 */
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

  // Filter to well-known automotive brands only
  const relevantMakes = nhtsMakes.filter((m) =>
    PRIORITY_MAKES.has(m.Make_Name.toLowerCase().trim()),
  );
  console.log(`[nhtsa] Filtered to ${relevantMakes.length} priority automotive makes`);

  // Get existing makes from our DB for deduplication
  const { data: existingMakes } = await db
    .from("ymme_makes")
    .select("name")
    .eq("active", true);

  const existingNameSet = new Set(
    (existingMakes ?? []).map((m: { name: string }) => m.name.toLowerCase()),
  );

  // Batch upsert — build array of new makes, insert in one call
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
    if (existingNameSet.has(name.toLowerCase())) continue;

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
    // Batch upsert in chunks of 50
    for (let i = 0; i < newMakeRows.length; i += 50) {
      const chunk = newMakeRows.slice(i, i + 50);
      const { error } = await db.from("ymme_makes").upsert(chunk, { onConflict: "slug" });
      if (error) {
        console.warn(`[nhtsa] Batch upsert error (chunk ${i}):`, error.message);
        // Fallback: insert one-by-one for this chunk
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
 * Fetch all models for a specific NHTSA make ID and upsert into ymme_models.
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
    .single();

  if (!dbMake) {
    console.warn(
      `[nhtsa] Make "${makeName}" not found in DB, skipping models`,
    );
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
 * Useful for confirming which models were available in specific years.
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
 * Full sync: fetch all NHTSA makes and their models, cross-reference
 * with our YMME database, and fill gaps.
 *
 * This is a long-running operation for a full sync. Use `maxMakes`
 * to limit for testing.
 */
export async function syncNHTSAToYMME(options?: {
  maxMakes?: number;
  delayMs?: number;
  onProgress?: (msg: string) => void;
}): Promise<SyncResult> {
  const maxMakes = options?.maxMakes ?? Infinity;
  const delayMs = options?.delayMs ?? RATE_LIMIT_MS;
  const log = options?.onProgress ?? console.log;

  const result: SyncResult = {
    makesProcessed: 0,
    newMakes: 0,
    modelsProcessed: 0,
    newModels: 0,
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

  // Step 2: Get NHTSA makes from our DB that have nhtsa_make_id
  log("[nhtsa] Step 2: Syncing models for each make...");

  const { data: makesWithNhtsaId } = await db
    .from("ymme_makes")
    .select("id, name, nhtsa_make_id")
    .not("nhtsa_make_id", "is", null)
    .eq("active", true)
    .order("name")
    .limit(maxMakes);

  if (!makesWithNhtsaId || makesWithNhtsaId.length === 0) {
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

      try {
        await sleep(delayMs);
        const modResult = await fetchNHTSAModelsForMake(nhtsaId);
        result.modelsProcessed += modResult.modelsProcessed;
        result.newModels += modResult.newModels;

        if (modResult.newModels > 0) {
          log(
            `[nhtsa]   ${make.name}: ${modResult.newModels} new models added`,
          );
        }

        processedCount++;
      } catch (err) {
        const msg = `Models fetch failed for ${make.name}: ${err instanceof Error ? err.message : String(err)}`;
        result.errors.push(msg);
      }
    }
  } else {
    // Use stored nhtsa_make_id for direct lookups
    for (const make of makesWithNhtsaId) {
      try {
        await sleep(delayMs);
        const modResult = await fetchNHTSAModelsForMake(
          make.nhtsa_make_id as number,
        );
        result.modelsProcessed += modResult.modelsProcessed;
        result.newModels += modResult.newModels;

        if (modResult.newModels > 0) {
          log(
            `[nhtsa]   ${make.name}: ${modResult.newModels} new models added`,
          );
        }
      } catch (err) {
        const msg = `Models fetch failed for ${make.name}: ${err instanceof Error ? err.message : String(err)}`;
        result.errors.push(msg);
      }
    }
  }

  log("[nhtsa] Sync complete.");
  log(
    `[nhtsa] Results: ${result.makesProcessed} makes (${result.newMakes} new), ${result.modelsProcessed} models (${result.newModels} new), ${result.errors.length} errors`,
  );

  return result;
}
