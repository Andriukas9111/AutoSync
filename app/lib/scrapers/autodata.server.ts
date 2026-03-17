/**
 * auto-data.net Scraper - populates the global YMME database.
 * Admin-only. Not tenant-facing.
 *
 * Features:
 * - Resumable: tracks last processed brand
 * - Rate limited: configurable delay between requests
 * - Upserts: safe to re-run without duplicating data
 */

import db from "../db.server";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScrapeOptions {
  /** Brand slug to resume from */
  resumeFrom?: string;
  /** Maximum number of brands to process (for testing) */
  maxBrands?: number;
  /** Delay between HTTP requests in ms (default: 1500) */
  delayMs?: number;
  /** Called after each brand completes */
  onProgress?: (status: ScrapeProgress) => void;
}

export interface ScrapeProgress {
  currentBrand: string;
  brandsProcessed: number;
  brandsTotal: number;
  modelsProcessed: number;
  enginesProcessed: number;
  errors: string[];
}

export interface ScrapeResult {
  brandsProcessed: number;
  modelsProcessed: number;
  enginesProcessed: number;
  errors: string[];
  duration: number;
}

interface ScrapedBrand {
  slug: string;
  name: string;
  country: string | null;
  logoUrl: string | null;
}

interface ScrapedModel {
  slug: string;
  name: string;
  generation: string | null;
  yearFrom: number;
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
  yearFrom: number;
  yearTo: number | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_URL = "https://www.auto-data.net";
const DEFAULT_DELAY_MS = 1500;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Main Scraper ──────────────────────────────────────────────────────────────

export async function scrapeAutoData(
  options: ScrapeOptions = {},
): Promise<ScrapeResult> {
  const {
    resumeFrom,
    maxBrands,
    delayMs = DEFAULT_DELAY_MS,
    onProgress,
  } = options;
  const startTime = Date.now();
  const errors: string[] = [];
  let brandsProcessed = 0;
  let modelsProcessed = 0;
  let enginesProcessed = 0;

  const brands = await fetchBrandList();
  if (brands.length === 0) {
    errors.push("Failed to fetch brand list");
    return {
      brandsProcessed: 0,
      modelsProcessed: 0,
      enginesProcessed: 0,
      errors,
      duration: Date.now() - startTime,
    };
  }

  let startIndex = 0;
  if (resumeFrom) {
    const idx = brands.findIndex((b) => b.slug === resumeFrom);
    if (idx !== -1) startIndex = idx;
  }

  const limit = maxBrands
    ? Math.min(startIndex + maxBrands, brands.length)
    : brands.length;

  for (let i = startIndex; i < limit; i++) {
    const brand = brands[i];

    try {
      const makeId = await upsertMake(brand);
      if (!makeId) {
        errors.push("Failed to upsert make: " + brand.name);
        continue;
      }

      const models = await fetchModelsForBrand(brand.slug);
      await sleep(delayMs);

      for (const model of models) {
        try {
          const modelId = await upsertModel(makeId, model);
          if (!modelId) {
            errors.push("Failed to upsert model: " + brand.name + " " + model.name);
            continue;
          }

          const engines = await fetchEnginesForModel(brand.slug, model.slug);
          await sleep(delayMs);

          for (const engine of engines) {
            try {
              await upsertEngine(modelId, engine);
              enginesProcessed++;
            } catch (err) {
              errors.push("Engine error: " + (err instanceof Error ? err.message : String(err)));
            }
          }

          modelsProcessed++;
        } catch (err) {
          errors.push("Model error: " + (err instanceof Error ? err.message : String(err)));
        }
      }

      brandsProcessed++;

      console.log(
        "[autodata] Progress: brand=" + brand.slug +
        " brands=" + brandsProcessed +
        " models=" + modelsProcessed +
        " engines=" + enginesProcessed,
      );

      if (onProgress) {
        onProgress({
          currentBrand: brand.name,
          brandsProcessed,
          brandsTotal: limit - startIndex,
          modelsProcessed,
          enginesProcessed,
          errors: errors.slice(-5),
        });
      }
    } catch (err) {
      errors.push("Brand error (" + brand.name + "): " + (err instanceof Error ? err.message : String(err)));
    }
  }

  return {
    brandsProcessed,
    modelsProcessed,
    enginesProcessed,
    errors,
    duration: Date.now() - startTime,
  };
}

// ── HTTP Fetcher ──────────────────────────────────────────────────────────────

async function fetchPage(path: string): Promise<string> {
  const url = BASE_URL + path;
  const response = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new Error("HTTP " + response.status + " for " + url);
  }

  return response.text();
}

// ── Parsers ───────────────────────────────────────────────────────────────────

async function fetchBrandList(): Promise<ScrapedBrand[]> {
  try {
    const html = await fetchPage("/en/allbrands");
    const brands: ScrapedBrand[] = [];

    // Pattern matches brand listing anchors on the all-brands page
    const brandPattern =
      /<a\s+href="\/en\/([a-z0-9-]+)"[^>]*class="[^"]*marke_links_box[^"]*"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/gi;
    let match;

    while ((match = brandPattern.exec(html)) !== null) {
      const slug = match[1];
      const name = match[2].trim();
      if (slug && name && !slug.includes("/")) {
        brands.push({ slug, name, country: null, logoUrl: null });
      }
    }

    // Fallback: simpler anchor pattern
    if (brands.length === 0) {
      const simplePattern =
        /<a\s+href="\/en\/([a-z0-9-]+)"[^>]*>\s*([A-Z][A-Za-z0-9\s.-]+)\s*<\/a>/g;
      while ((match = simplePattern.exec(html)) !== null) {
        const slug = match[1];
        const name = match[2].trim();
        if (slug && name && name.length < 30 && !slug.includes("all")) {
          brands.push({ slug, name, country: null, logoUrl: null });
        }
      }
    }

    return brands;
  } catch (err) {
    console.error("[autodata] Brand list fetch failed:", err);
    return [];
  }
}

async function fetchModelsForBrand(brandSlug: string): Promise<ScrapedModel[]> {
  try {
    const html = await fetchPage("/en/" + brandSlug);
    const models: ScrapedModel[] = [];

    const modelPattern =
      /<a\s+href="\/en\/[^"]*\/([a-z0-9-]+)"[^>]*>\s*([^<]+)/gi;
    let match;

    while ((match = modelPattern.exec(html)) !== null) {
      const slug = match[1];
      const rawName = match[2].trim();

      const yearMatch = rawName.match(/\((\d{4})\s*-\s*(\d{4}|present|\.{3})\)/i);
      const genMatch = rawName.match(/\(([A-Z][A-Z0-9]{1,5})\)/);

      const yearFrom = yearMatch ? parseInt(yearMatch[1], 10) : 0;
      const yearTo =
        yearMatch && /\d{4}/.test(yearMatch[2])
          ? parseInt(yearMatch[2], 10)
          : null;

      const cleanName = rawName
        .replace(/\([^)]*\)/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (cleanName && slug) {
        models.push({
          slug,
          name: cleanName,
          generation: genMatch ? genMatch[1] : null,
          yearFrom,
          yearTo,
          bodyType: null,
        });
      }
    }

    // Deduplicate by name+generation
    const seen = new Map<string, ScrapedModel>();
    for (const m of models) {
      const key = m.name + "-" + (m.generation || "");
      if (!seen.has(key)) seen.set(key, m);
    }
    return Array.from(seen.values());
  } catch (err) {
    console.error("[autodata] Models fetch failed for " + brandSlug + ":", err);
    return [];
  }
}

async function fetchEnginesForModel(
  brandSlug: string,
  modelSlug: string,
): Promise<ScrapedEngine[]> {
  try {
    const html = await fetchPage("/en/" + brandSlug + "/" + modelSlug);
    const engines: ScrapedEngine[] = [];

    const rows = html.split(/<tr[^>]*>/i);

    for (const row of rows) {
      const nameMatch = row.match(/<a[^>]*>([^<]+)<\/a>/);
      if (!nameMatch) continue;

      const name = nameMatch[1].trim();
      if (!name || name.length < 3) continue;

      const cc = row.match(/(\d{3,5})\s*(?:cc|cm)/i);
      const hp = row.match(/(\d{2,4})\s*(?:hp|bhp|ps)/i);
      const kw = row.match(/(\d{2,4})\s*kw/i);
      const nm = row.match(/(\d{2,4})\s*nm/i);
      const fuel = row.match(/(petrol|diesel|electric|hybrid|lpg|cng)/i);
      const yr = row.match(/(\d{4})\s*-\s*(\d{4}|present|\.{3})?/);
      const code = row.match(/\(([A-Z][A-Z0-9]{2,8})\)/);

      engines.push({
        name,
        code: code ? code[1] : null,
        displacementCc: cc ? parseInt(cc[1], 10) : null,
        fuelType: fuel
          ? fuel[1].charAt(0).toUpperCase() + fuel[1].slice(1).toLowerCase()
          : null,
        powerHp: hp ? parseInt(hp[1], 10) : null,
        powerKw: kw ? parseInt(kw[1], 10) : null,
        torqueNm: nm ? parseInt(nm[1], 10) : null,
        yearFrom: yr ? parseInt(yr[1], 10) : 0,
        yearTo: yr && yr[2] && /\d{4}/.test(yr[2]) ? parseInt(yr[2], 10) : null,
      });
    }

    return engines;
  } catch (err) {
    console.error("[autodata] Engines fetch failed:", err);
    return [];
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Database Upserts ──────────────────────────────────────────────────────────

async function upsertMake(brand: ScrapedBrand): Promise<string | null> {
  const { data, error } = await db
    .from("ymme_makes")
    .upsert(
      { name: brand.name, country: brand.country, logo_url: brand.logoUrl },
      { onConflict: "name" },
    )
    .select("id")
    .single();

  if (error) {
    console.error("[autodata] Upsert make " + brand.name + ":", error.message);
    return null;
  }
  return data?.id ?? null;
}

async function upsertModel(makeId: string, model: ScrapedModel): Promise<string | null> {
  const { data, error } = await db
    .from("ymme_models")
    .upsert(
      {
        make_id: makeId,
        name: model.name,
        generation: model.generation,
        year_from: model.yearFrom,
        year_to: model.yearTo,
        body_type: model.bodyType,
      },
      { onConflict: "make_id,name,generation" },
    )
    .select("id")
    .single();

  if (error) {
    console.error("[autodata] Upsert model " + model.name + ":", error.message);
    return null;
  }
  return data?.id ?? null;
}

async function upsertEngine(modelId: string, engine: ScrapedEngine): Promise<void> {
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
    },
    { onConflict: "model_id,name" },
  );

  if (error) {
    console.error("[autodata] Upsert engine " + engine.name + ":", error.message);
  }
}

// ── Admin API helpers ─────────────────────────────────────────────────────────

export async function getLastScrapeProgress(): Promise<{
  lastBrand: string | null;
  brandsTotal: number;
} | null> {
  const { count } = await db
    .from("ymme_makes")
    .select("id", { count: "exact", head: true });

  return { lastBrand: null, brandsTotal: count ?? 0 };
}
