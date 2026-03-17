/**
 * Auto-data.net Scraper -- populates the global YMME database.
 *
 * Admin-only tool. Scrapes all brands, models, generations, and engines
 * from auto-data.net and upserts into ymme_makes / ymme_models / ymme_engines.
 *
 * Features:
 *   - Resumable: tracks progress in `scrape_progress` table
 *   - Rate-limited: configurable delay between requests (default 1500ms)
 *   - Idempotent: uses upsert with slug-based conflict resolution
 *   - Downloads brand logos and model images (stores URLs)
 */

import db from "../db.server";

// ── Constants ────────────────────────────────────────────────

const BASE_URL = "https://www.auto-data.net";
const ALL_BRANDS_URL = `${BASE_URL}/en/allbrands`;
const DEFAULT_DELAY_MS = 1500;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Types ────────────────────────────────────────────────────

interface ScrapedBrand {
  name: string;
  slug: string;
  url: string;
  logoUrl: string | null;
  country: string | null;
}

interface ScrapedModel {
  name: string;
  slug: string;
  url: string;
  imageUrl: string | null;
}

interface ScrapedGeneration {
  name: string;
  slug: string;
  url: string;
  yearFrom: number | null;
  yearTo: number | null;
  bodyType: string | null;
}

interface ScrapedEngine {
  name: string;
  code: string | null;
  displacementCc: number | null;
  fuelType: string | null;
  powerHp: number | null;
  powerKw: number | null;
  torqueNm: number | null;
  yearFrom: number | null;
  yearTo: number | null;
}

export interface ScrapeResult {
  brandsProcessed: number;
  modelsProcessed: number;
  enginesProcessed: number;
  errors: string[];
}

interface ScrapeOptions {
  resumeFrom?: string; // brand slug to resume from
  maxBrands?: number; // limit for testing
  delayMs?: number; // rate limit delay (default 1500ms)
  onProgress?: (msg: string) => void; // optional progress callback
}

// ── Helpers ──────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }

  return response.text();
}

/** Extract a slug from a URL path (last segment). */
function slugFromUrl(url: string): string {
  const parts = url.replace(/\/$/, "").split("/");
  return parts[parts.length - 1] || "";
}

/**
 * Lightweight HTML parser helpers.
 * We avoid full DOM parsing to keep dependencies at zero -- the auto-data.net
 * HTML structure is predictable enough for regex-based extraction.
 */

function extractAll(
  html: string,
  pattern: RegExp,
): Array<Record<string, string>> {
  const results: Array<Record<string, string>> = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    results.push({ ...match.groups } as Record<string, string>);
  }
  return results;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .trim();
}

// ── Progress Tracking ────────────────────────────────────────

async function ensureProgressTable(): Promise<void> {
  // We use a simple key-value table for scrape state.
  // If the table doesn't exist yet, the first call will fail gracefully
  // and we'll just start from the beginning.
  const { error } = await db.from("scrape_progress").select("key").limit(1);

  if (error?.code === "42P01") {
    // Table doesn't exist -- caller should create it via migration:
    // CREATE TABLE scrape_progress (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ DEFAULT now());
    console.warn(
      "[autodata-scraper] scrape_progress table not found. " +
        "Create it with: CREATE TABLE scrape_progress (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMPTZ DEFAULT now());",
    );
  }
}

async function getProgress(): Promise<{
  lastBrandSlug: string | null;
  completedBrands: string[];
}> {
  const { data } = await db
    .from("scrape_progress")
    .select("value")
    .eq("key", "autodata_scraper")
    .single();

  if (!data) {
    return { lastBrandSlug: null, completedBrands: [] };
  }

  const value = data.value as {
    lastBrandSlug?: string;
    completedBrands?: string[];
  };
  return {
    lastBrandSlug: value.lastBrandSlug ?? null,
    completedBrands: value.completedBrands ?? [],
  };
}

async function saveProgress(
  brandSlug: string,
  completedBrands: string[],
): Promise<void> {
  await db.from("scrape_progress").upsert(
    {
      key: "autodata_scraper",
      value: { lastBrandSlug: brandSlug, completedBrands },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
}

// ── Scrapers ─────────────────────────────────────────────────

/** Scrape the all-brands page to get a list of brands with links. */
async function scrapeBrandList(): Promise<ScrapedBrand[]> {
  const html = await fetchPage(ALL_BRANDS_URL);
  const brands: ScrapedBrand[] = [];

  // Auto-data.net lists brands in structured blocks.
  // Each brand has an <a> with href and an <img> for the logo.
  const brandPattern =
    /<a[^>]+href="(?<url>\/en\/[^"]+)"[^>]*>\s*(?:<img[^>]+src="(?<logo>[^"]*)"[^>]*>)?\s*<span[^>]*>(?<name>[^<]+)<\/span>/gi;

  const matches = extractAll(html, brandPattern);

  for (const m of matches) {
    const url = m.url ?? "";
    const name = decodeHtmlEntities(m.name ?? "");
    if (!url || !name) continue;

    brands.push({
      name,
      slug: slugFromUrl(url),
      url: url.startsWith("http") ? url : `${BASE_URL}${url}`,
      logoUrl: m.logo
        ? m.logo.startsWith("http")
          ? m.logo
          : `${BASE_URL}${m.logo}`
        : null,
      country: null,
    });
  }

  // Fallback: if the pattern didn't match, try a more generic approach
  if (brands.length === 0) {
    const fallbackPattern =
      /<a[^>]+href="(?<url>\/en\/allbrands\/(?<slug>[^"\/]+))"[^>]*>[^<]*?(?:<img[^>]+src="(?<logo>[^"]*)")?[^<]*?(?<name>[A-Z][^<]{1,40})/gi;

    const fallbackMatches = extractAll(html, fallbackPattern);
    for (const m of fallbackMatches) {
      const name = decodeHtmlEntities(m.name ?? "");
      const url = m.url ?? "";
      if (!name || !url) continue;

      brands.push({
        name,
        slug: m.slug ?? slugFromUrl(url),
        url: `${BASE_URL}${url}`,
        logoUrl: m.logo ? `${BASE_URL}${m.logo}` : null,
        country: null,
      });
    }
  }

  return brands;
}

/** Scrape a brand page to get its models. */
async function scrapeModelsForBrand(brandUrl: string): Promise<ScrapedModel[]> {
  const html = await fetchPage(brandUrl);
  const models: ScrapedModel[] = [];

  // Models are listed as links, typically in content blocks with images
  const modelPattern =
    /<a[^>]+href="(?<url>\/en\/[^"]*model[^"]*)"[^>]*>\s*(?:<img[^>]+src="(?<img>[^"]*)"[^>]*>)?\s*(?:<span[^>]*>)?(?<name>[^<]+)/gi;

  const matches = extractAll(html, modelPattern);

  for (const m of matches) {
    const name = decodeHtmlEntities(m.name ?? "");
    const url = m.url ?? "";
    if (!name || !url || name.length > 100) continue;

    models.push({
      name,
      slug: slugFromUrl(url),
      url: url.startsWith("http") ? url : `${BASE_URL}${url}`,
      imageUrl: m.img
        ? m.img.startsWith("http")
          ? m.img
          : `${BASE_URL}${m.img}`
        : null,
    });
  }

  return dedupeBySlug(models);
}

/** Scrape a model page to get its generations/variants. */
async function scrapeGenerationsForModel(
  modelUrl: string,
): Promise<ScrapedGeneration[]> {
  const html = await fetchPage(modelUrl);
  const generations: ScrapedGeneration[] = [];

  // Generations typically show year ranges and body types
  const genPattern =
    /<a[^>]+href="(?<url>\/en\/[^"]*)"[^>]*>[^<]*?(?<name>[^<]+?)\s*(?:\((?<years>[^)]+)\))?<\/a>/gi;

  const matches = extractAll(html, genPattern);

  for (const m of matches) {
    const name = decodeHtmlEntities(m.name ?? "");
    const url = m.url ?? "";
    if (!name || !url || name.length > 100) continue;

    // Parse year range (e.g., "2018 - 2023" or "2020 - present")
    const { yearFrom, yearTo } = parseYearRange(m.years ?? "");

    // Try to extract body type from the name or context
    const bodyType = extractBodyType(name);

    generations.push({
      name: name.replace(/\s*\(\d{4}\s*-\s*(?:\d{4}|present)\)\s*/i, ""),
      slug: slugFromUrl(url),
      url: url.startsWith("http") ? url : `${BASE_URL}${url}`,
      yearFrom,
      yearTo,
      bodyType,
    });
  }

  return dedupeBySlug(generations);
}

/** Scrape an engine/specifications page for a generation. */
async function scrapeEnginesForGeneration(
  generationUrl: string,
): Promise<ScrapedEngine[]> {
  const html = await fetchPage(generationUrl);
  const engines: ScrapedEngine[] = [];

  // Engine specs are typically in table rows or structured lists.
  // Look for links to individual engine pages or spec tables.
  const enginePattern =
    /<a[^>]+href="(?<url>\/en\/[^"]*)"[^>]*>\s*(?<name>[^<]+)<\/a>/gi;

  const matches = extractAll(html, enginePattern);

  for (const m of matches) {
    const name = decodeHtmlEntities(m.name ?? "");
    if (!name || name.length > 200) continue;

    // Skip non-engine links
    if (
      !/\d+\.\d+|\d+\s*(?:hp|kw|ps|bhp|cv)|(?:diesel|petrol|electric|hybrid|turbo)/i.test(
        name,
      )
    ) {
      continue;
    }

    const engine = parseEngineFromName(name);
    engines.push(engine);
  }

  // Also try table-based extraction
  const tableEngines = extractEnginesFromTables(html);
  engines.push(...tableEngines);

  return engines;
}

// ── Parse Helpers ────────────────────────────────────────────

function parseYearRange(text: string): {
  yearFrom: number | null;
  yearTo: number | null;
} {
  const yearMatch = text.match(/(\d{4})\s*[-\u2013]\s*(\d{4}|present|\.{3})/i);
  if (!yearMatch)
    return { yearFrom: null, yearTo: null };

  const yearFrom = parseInt(yearMatch[1], 10);
  const yearToRaw = yearMatch[2].toLowerCase();
  const yearTo =
    yearToRaw === "present" || yearToRaw === "..."
      ? null
      : parseInt(yearToRaw, 10);

  return {
    yearFrom: isNaN(yearFrom) ? null : yearFrom,
    yearTo: yearTo !== null && isNaN(yearTo) ? null : yearTo,
  };
}

function extractBodyType(text: string): string | null {
  const types = [
    "sedan",
    "saloon",
    "hatchback",
    "estate",
    "wagon",
    "coupe",
    "convertible",
    "cabriolet",
    "suv",
    "crossover",
    "pickup",
    "truck",
    "van",
    "mpv",
    "minivan",
    "roadster",
    "targa",
    "shooting brake",
    "liftback",
    "fastback",
    "touring",
    "sportback",
    "gran turismo",
    "gt",
  ];

  const lower = text.toLowerCase();
  for (const t of types) {
    if (lower.includes(t)) return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return null;
}

function parseEngineFromName(name: string): ScrapedEngine {
  // Try to extract displacement (e.g., "2.0", "1.8", "3.0")
  const dispMatch = name.match(/(\d+\.\d+)\s*(?:L|l)?/);
  const displacementLitres = dispMatch ? parseFloat(dispMatch[1]) : null;
  const displacementCc = displacementLitres
    ? Math.round(displacementLitres * 1000)
    : null;

  // Try to extract power (e.g., "300 hp", "220 kW", "250 PS")
  const hpMatch = name.match(/(\d+)\s*(?:hp|bhp|ps|cv)/i);
  const kwMatch = name.match(/(\d+)\s*kw/i);
  const powerHp = hpMatch ? parseInt(hpMatch[1], 10) : null;
  const powerKw = kwMatch
    ? parseInt(kwMatch[1], 10)
    : powerHp
      ? Math.round(powerHp * 0.7457)
      : null;

  // Try to extract torque
  const torqueMatch = name.match(/(\d+)\s*(?:nm|n\u00b7m)/i);
  const torqueNm = torqueMatch ? parseInt(torqueMatch[1], 10) : null;

  // Fuel type
  let fuelType: string | null = null;
  if (/diesel|tdi|cdi|hdi|dci|jtd|crdi|d4d/i.test(name)) fuelType = "Diesel";
  else if (/electric|ev|bev|e-tron/i.test(name)) fuelType = "Electric";
  else if (/hybrid|phev|mhev/i.test(name)) fuelType = "Hybrid";
  else if (/lpg/i.test(name)) fuelType = "LPG";
  else if (/cng/i.test(name)) fuelType = "CNG";
  else if (/petrol|gasoline|tfsi|tsi|gdi|mpi|vtec|vvt/i.test(name))
    fuelType = "Petrol";

  // Engine code (e.g., "EA888", "N54B30")
  const codeMatch = name.match(
    /\b([A-Z]{1,3}\d{2,3}[A-Z]?\d{0,2})\b/,
  );
  const code = codeMatch ? codeMatch[1] : null;

  // Year range from the name
  const { yearFrom, yearTo } = parseYearRange(name);

  return {
    name: name.trim(),
    code,
    displacementCc,
    fuelType,
    powerHp,
    powerKw,
    torqueNm,
    yearFrom,
    yearTo,
  };
}

function extractEnginesFromTables(html: string): ScrapedEngine[] {
  const engines: ScrapedEngine[] = [];

  // Look for specification tables with engine data.
  // Common pattern: <table> with rows containing displacement, power, etc.
  const tablePattern =
    /<tr[^>]*>[\s\S]*?<td[^>]*>(?<label>[^<]+)<\/td>\s*<td[^>]*>(?<value>[^<]+)<\/td>[\s\S]*?<\/tr>/gi;

  const rows = extractAll(html, tablePattern);

  let currentEngine: Partial<ScrapedEngine> = {};
  let hasEngineData = false;

  for (const row of rows) {
    const label = (row.label ?? "").trim().toLowerCase();
    const value = (row.value ?? "").trim();

    if (label.includes("engine") && label.includes("type")) {
      // Start a new engine entry if we already have data
      if (hasEngineData && currentEngine.name) {
        engines.push(buildScrapedEngine(currentEngine));
        currentEngine = {};
        hasEngineData = false;
      }
      currentEngine.name = value;
      hasEngineData = true;
    } else if (label.includes("displacement") || label.includes("capacity")) {
      const cc = parseInt(value.replace(/[^\d]/g, ""), 10);
      if (!isNaN(cc)) currentEngine.displacementCc = cc;
      hasEngineData = true;
    } else if (label.includes("power") && label.includes("hp")) {
      const hp = parseInt(value.replace(/[^\d]/g, ""), 10);
      if (!isNaN(hp)) currentEngine.powerHp = hp;
      hasEngineData = true;
    } else if (label.includes("power") && label.includes("kw")) {
      const kw = parseInt(value.replace(/[^\d]/g, ""), 10);
      if (!isNaN(kw)) currentEngine.powerKw = kw;
      hasEngineData = true;
    } else if (label.includes("torque")) {
      const nm = parseInt(value.replace(/[^\d]/g, ""), 10);
      if (!isNaN(nm)) currentEngine.torqueNm = nm;
      hasEngineData = true;
    } else if (label.includes("fuel")) {
      currentEngine.fuelType = value;
      hasEngineData = true;
    } else if (label.includes("engine code")) {
      currentEngine.code = value;
      hasEngineData = true;
    } else if (label.includes("year") || label.includes("production")) {
      const { yearFrom, yearTo } = parseYearRange(value);
      if (yearFrom) currentEngine.yearFrom = yearFrom;
      if (yearTo) currentEngine.yearTo = yearTo;
      hasEngineData = true;
    }
  }

  // Don't forget the last engine
  if (hasEngineData && currentEngine.name) {
    engines.push(buildScrapedEngine(currentEngine));
  }

  return engines;
}

function buildScrapedEngine(partial: Partial<ScrapedEngine>): ScrapedEngine {
  return {
    name: partial.name ?? "Unknown",
    code: partial.code ?? null,
    displacementCc: partial.displacementCc ?? null,
    fuelType: partial.fuelType ?? null,
    powerHp: partial.powerHp ?? null,
    powerKw: partial.powerKw ?? null,
    torqueNm: partial.torqueNm ?? null,
    yearFrom: partial.yearFrom ?? null,
    yearTo: partial.yearTo ?? null,
  };
}

function dedupeBySlug<T extends { slug: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.slug)) return false;
    seen.add(item.slug);
    return true;
  });
}

// ── Database Upserts ─────────────────────────────────────────

async function upsertMake(
  brand: ScrapedBrand,
): Promise<{ id: string } | null> {
  const { data, error } = await db
    .from("ymme_makes")
    .upsert(
      {
        name: brand.name,
        slug: brand.slug,
        country: brand.country,
        logo_url: brand.logoUrl,
        source: "auto-data.net",
        active: true,
      },
      { onConflict: "slug" },
    )
    .select("id")
    .single();

  if (error) {
    // If slug conflict column doesn't exist, try name-based upsert
    const { data: fallback, error: err2 } = await db
      .from("ymme_makes")
      .upsert(
        {
          name: brand.name,
          country: brand.country,
          logo_url: brand.logoUrl,
          source: "auto-data.net",
          active: true,
        },
        { onConflict: "name" },
      )
      .select("id")
      .single();

    if (err2) {
      console.error(`[autodata] Failed to upsert make ${brand.name}:`, err2);
      return null;
    }
    return fallback;
  }

  return data;
}

async function upsertModel(
  makeId: string,
  model: ScrapedModel,
  generation: ScrapedGeneration | null,
): Promise<{ id: string } | null> {
  const row: Record<string, unknown> = {
    make_id: makeId,
    name: model.name,
    generation: generation?.name ?? null,
    year_from: generation?.yearFrom ?? null,
    year_to: generation?.yearTo ?? null,
    body_type: generation?.bodyType ?? null,
    image_url: model.imageUrl,
    source: "auto-data.net",
    active: true,
  };

  const { data, error } = await db
    .from("ymme_models")
    .upsert(row, { onConflict: "make_id,name,generation" })
    .select("id")
    .single();

  if (error) {
    console.error(
      `[autodata] Failed to upsert model ${model.name}:`,
      error.message,
    );
    return null;
  }

  return data;
}

async function upsertEngine(
  modelId: string,
  engine: ScrapedEngine,
): Promise<void> {
  const { error } = await db.from("ymme_engines").upsert(
    {
      model_id: modelId,
      name: engine.name,
      code: engine.code,
      displacement_cc: engine.displacementCc,
      fuel_type: engine.fuelType,
      power_hp: engine.powerHp,
      power_kw: engine.powerKw,
      torque_nm: engine.torqueNm,
      year_from: engine.yearFrom,
      year_to: engine.yearTo,
      source: "auto-data.net",
      active: true,
    },
    { onConflict: "model_id,name" },
  );

  if (error) {
    console.error(
      `[autodata] Failed to upsert engine ${engine.name}:`,
      error.message,
    );
  }
}

// ── Main Entry Point ─────────────────────────────────────────

/**
 * Scrape auto-data.net and populate the YMME database.
 *
 * This is a long-running operation. For a full scrape of all brands,
 * expect several hours. Use `maxBrands` for testing.
 *
 * The scraper is resumable: if interrupted, call again and it will
 * pick up from the last completed brand (or pass `resumeFrom` to
 * start from a specific brand slug).
 */
export async function scrapeAutoData(
  options?: ScrapeOptions,
): Promise<ScrapeResult> {
  const delayMs = options?.delayMs ?? DEFAULT_DELAY_MS;
  const maxBrands = options?.maxBrands ?? Infinity;
  const log = options?.onProgress ?? console.log;

  const result: ScrapeResult = {
    brandsProcessed: 0,
    modelsProcessed: 0,
    enginesProcessed: 0,
    errors: [],
  };

  await ensureProgressTable();

  // Step 1: Get all brands
  log("[autodata] Fetching brand list...");
  let brands: ScrapedBrand[];
  try {
    brands = await scrapeBrandList();
    log(`[autodata] Found ${brands.length} brands`);
  } catch (err) {
    const msg = `Failed to fetch brand list: ${err instanceof Error ? err.message : String(err)}`;
    result.errors.push(msg);
    log(`[autodata] ERROR: ${msg}`);
    return result;
  }

  if (brands.length === 0) {
    result.errors.push(
      "No brands found -- the page structure may have changed",
    );
    return result;
  }

  // Step 2: Determine resume point
  let startIndex = 0;
  const resumeSlug = options?.resumeFrom;

  if (resumeSlug) {
    const idx = brands.findIndex((b) => b.slug === resumeSlug);
    if (idx >= 0) {
      startIndex = idx;
      log(`[autodata] Resuming from brand: ${brands[idx].name} (index ${idx})`);
    } else {
      log(
        `[autodata] Resume slug "${resumeSlug}" not found, starting from beginning`,
      );
    }
  } else {
    // Check saved progress
    const progress = await getProgress();
    if (progress.lastBrandSlug) {
      const idx = brands.findIndex(
        (b) => b.slug === progress.lastBrandSlug,
      );
      if (idx >= 0) {
        startIndex = idx + 1; // Start from the NEXT brand
        log(
          `[autodata] Resuming after brand: ${brands[idx].name} (index ${idx})`,
        );
      }
    }
  }

  // Step 3: Process brands
  const completedBrands: string[] = [];
  const endIndex = Math.min(brands.length, startIndex + maxBrands);

  for (let i = startIndex; i < endIndex; i++) {
    const brand = brands[i];
    log(
      `[autodata] Processing brand ${i + 1}/${brands.length}: ${brand.name}`,
    );

    try {
      // Upsert the make
      const make = await upsertMake(brand);
      if (!make) {
        result.errors.push(`Failed to upsert make: ${brand.name}`);
        continue;
      }

      await sleep(delayMs);

      // Get models for this brand
      const models = await scrapeModelsForBrand(brand.url);
      log(`[autodata]   Found ${models.length} models for ${brand.name}`);

      for (const model of models) {
        try {
          await sleep(delayMs);

          // Get generations for this model
          const generations = await scrapeGenerationsForModel(model.url);

          if (generations.length === 0) {
            // No generations found -- insert model without generation info
            const dbModel = await upsertModel(make.id, model, null);
            if (dbModel) result.modelsProcessed++;
            continue;
          }

          for (const gen of generations) {
            const dbModel = await upsertModel(make.id, model, gen);
            if (!dbModel) continue;
            result.modelsProcessed++;

            await sleep(delayMs);

            // Get engines for this generation
            try {
              const engines = await scrapeEnginesForGeneration(gen.url);
              for (const engine of engines) {
                await upsertEngine(dbModel.id, engine);
                result.enginesProcessed++;
              }
              log(
                `[autodata]     ${model.name} ${gen.name}: ${engines.length} engines`,
              );
            } catch (err) {
              const msg = `Engine scrape failed for ${brand.name} > ${model.name} > ${gen.name}: ${err instanceof Error ? err.message : String(err)}`;
              result.errors.push(msg);
              log(`[autodata]     ERROR: ${msg}`);
            }
          }
        } catch (err) {
          const msg = `Model scrape failed for ${brand.name} > ${model.name}: ${err instanceof Error ? err.message : String(err)}`;
          result.errors.push(msg);
          log(`[autodata]   ERROR: ${msg}`);
        }
      }

      result.brandsProcessed++;
      completedBrands.push(brand.slug);

      // Save progress after each brand
      await saveProgress(brand.slug, completedBrands);
      log(
        `[autodata] Completed ${brand.name} (${result.brandsProcessed} brands, ${result.modelsProcessed} models, ${result.enginesProcessed} engines)`,
      );
    } catch (err) {
      const msg = `Brand scrape failed for ${brand.name}: ${err instanceof Error ? err.message : String(err)}`;
      result.errors.push(msg);
      log(`[autodata] ERROR: ${msg}`);
    }
  }

  log("[autodata] Scrape complete.");
  log(
    `[autodata] Results: ${result.brandsProcessed} brands, ${result.modelsProcessed} models, ${result.enginesProcessed} engines, ${result.errors.length} errors`,
  );

  return result;
}

/**
 * Reset scrape progress to start over from the beginning.
 */
export async function resetScrapeProgress(): Promise<void> {
  await db.from("scrape_progress").delete().eq("key", "autodata_scraper");
}
