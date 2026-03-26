/**
 * Supabase Edge Function: process-scrape
 *
 * Background worker for incremental YMME database scraping.
 * Triggered by pg_cron every 30 seconds.
 *
 * Each invocation processes a batch of brands (BRANDS_PER_BATCH),
 * then returns. pg_cron fires again 30s later and processes the next batch.
 * This avoids any timeouts — works with Supabase Free/Pro tier limits.
 *
 * Flow:
 * 1. Find a running scrape_job
 * 2. Resume from where it left off (processed_items = brand index)
 * 3. Process BRANDS_PER_BATCH brands
 * 4. Update progress + result counts
 * 5. If all brands done → mark completed
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.38/deno-dom-wasm.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BRANDS_PER_BATCH = 5; // Brands per invocation (conservative — ~30s per brand with delay)
const AUTO_DATA_BASE = "https://www.auto-data.net";

const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ─── HTML Fetching ───────────────────────────────────────────────────────

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return await res.text();
}

function parseHTML(html: string) {
  return new DOMParser().parseFromString(html, "text/html");
}

// ─── Brand List ──────────────────────────────────────────────────────────

interface Brand {
  name: string;
  slug: string;
  pageUrl: string;
}

async function fetchAllBrands(): Promise<Brand[]> {
  const html = await fetchPage(`${AUTO_DATA_BASE}/en/allbrands`);
  const doc = parseHTML(html);
  if (!doc) return [];

  const brands: Brand[] = [];
  const links = doc.querySelectorAll("a.marki_blok");
  for (const link of links) {
    const href = (link as any).getAttribute("href") || "";
    const name = (link as any).textContent?.trim() || "";
    if (!name || !href) continue;
    const slug = href.split("/").filter(Boolean).pop() || "";
    brands.push({ name, slug, pageUrl: `${AUTO_DATA_BASE}${href}` });
  }
  return brands;
}

// ─── Model Scraping ──────────────────────────────────────────────────────

interface ScrapedModel {
  name: string;
  generation: string | null;
  slug: string;
  pageUrl: string;
  yearFrom: number | null;
  yearTo: string | null;
}

async function fetchModelsForBrand(brandUrl: string): Promise<ScrapedModel[]> {
  const html = await fetchPage(brandUrl);
  const doc = parseHTML(html);
  if (!doc) return [];

  const models: ScrapedModel[] = [];
  const links = doc.querySelectorAll("a.modeli_blok");
  for (const link of links) {
    const href = (link as any).getAttribute("href") || "";
    const nameEl = (link as any).querySelector(".tit");
    const yearEl = (link as any).querySelector(".years");
    const name = nameEl?.textContent?.trim() || "";
    if (!name || !href) continue;

    const yearText = yearEl?.textContent?.trim() || "";
    const yearMatch = yearText.match(/(\d{4})\s*[-–]\s*(.*)/);
    const yearFrom = yearMatch ? parseInt(yearMatch[1], 10) : null;
    const yearTo = yearMatch?.[2]?.trim() || null;

    // Extract generation from parentheses in name
    const genMatch = name.match(/\(([^)]+)\)/);
    const generation = genMatch ? genMatch[1] : null;
    const cleanName = name.replace(/\s*\([^)]*\)\s*$/, "").trim();

    const slug = href.split("/").filter(Boolean).pop() || "";
    models.push({ name: cleanName, generation, slug, pageUrl: `${AUTO_DATA_BASE}${href}`, yearFrom, yearTo });
  }
  return models;
}

// ─── Engine Scraping ─────────────────────────────────────────────────────

interface ScrapedEngine {
  name: string;
  specPageUrl: string;
}

async function fetchEnginesForModel(modelUrl: string): Promise<ScrapedEngine[]> {
  const html = await fetchPage(modelUrl);
  const doc = parseHTML(html);
  if (!doc) return [];

  const engines: ScrapedEngine[] = [];
  const rows = doc.querySelectorAll("a.position");
  for (const row of rows) {
    const href = (row as any).getAttribute("href") || "";
    const name = (row as any).textContent?.trim()?.replace(/\s+/g, " ") || "";
    if (!name || !href) continue;
    engines.push({ name, specPageUrl: `${AUTO_DATA_BASE}${href}` });
  }
  return engines;
}

// ─── Log Changes ─────────────────────────────────────────────────────────

async function logChange(entry: {
  entity_type: string;
  entity_id: string;
  action: string;
  entity_name: string;
  parent_name: string | null;
}) {
  await db.from("scrape_changelog").insert({
    ...entry,
    created_at: new Date().toISOString(),
  });
}

// ─── Upsert Functions ────────────────────────────────────────────────────

async function upsertModel(makeId: string, model: ScrapedModel): Promise<string | null> {
  const { data, error } = await db
    .from("ymme_models")
    .upsert({
      make_id: makeId,
      name: model.name,
      generation: model.generation,
      year_from: model.yearFrom || null,
      year_to: model.yearTo,
      autodata_slug: model.slug,
      autodata_url: model.pageUrl,
      source: "auto-data.net",
      active: true,
    }, { onConflict: "make_id,name,generation" })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(`[scrape] Upsert model ${model.name}: ${error.message}`);
    return null;
  }
  return data?.id ?? null;
}

async function upsertEngine(modelId: string, engine: ScrapedEngine): Promise<string | null> {
  const { data, error } = await db
    .from("ymme_engines")
    .upsert({
      model_id: modelId,
      name: engine.name,
      autodata_url: engine.specPageUrl,
      active: true,
    }, { onConflict: "model_id,name" })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(`[scrape] Upsert engine ${engine.name}: ${error.message}`);
    return null;
  }
  return data?.id ?? null;
}

// ─── Main Handler ────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  try {
    // 1. Find a running scrape_job
    const { data: job } = await db
      .from("scrape_jobs")
      .select("*")
      .eq("status", "running")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!job) {
      return new Response(JSON.stringify({ ok: true, message: "No running scrape jobs" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const jobId = job.id;
    const config = (job.config as Record<string, unknown>) ?? {};
    const delayMs = (config.delayMs as number) ?? 1500;
    const existingResult = (job.result as Record<string, number>) ?? {};
    const startIndex = job.processed_items ?? 0;

    console.log(`[scrape] Processing job ${jobId}, starting from brand index ${startIndex}`);

    // 2. Fetch all brands from auto-data.net
    const allBrands = await fetchAllBrands();
    const totalBrands = allBrands.length;

    if (startIndex >= totalBrands) {
      // All done
      await db.from("scrape_jobs").update({
        status: "completed",
        progress: 100,
        completed_at: new Date().toISOString(),
        result: existingResult,
      }).eq("id", jobId);

      return new Response(JSON.stringify({ ok: true, message: "Scrape completed" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 3. Load existing makes from DB
    const { data: existingMakes } = await db
      .from("ymme_makes")
      .select("id, name, slug, autodata_slug");

    const makeBySlug = new Map<string, { id: string; name: string }>();
    const makeByAutodataSlug = new Map<string, { id: string; name: string }>();
    for (const m of existingMakes ?? []) {
      if (m.slug) makeBySlug.set(m.slug, { id: m.id, name: m.name });
      if (m.autodata_slug) makeByAutodataSlug.set(m.autodata_slug, { id: m.id, name: m.name });
    }

    // 4. Process this batch
    const endIndex = Math.min(startIndex + BRANDS_PER_BATCH, totalBrands);
    let newModelsCount = existingResult.newModels ?? 0;
    let newEnginesCount = existingResult.newEngines ?? 0;
    let newSpecsCount = existingResult.newSpecs ?? 0;
    let newBrandsCount = existingResult.newBrands ?? 0;
    const errors: string[] = [];

    for (let i = startIndex; i < endIndex; i++) {
      const brand = allBrands[i];

      // Check if job was paused
      if (i > startIndex && i % 3 === 0) {
        const { data: jobCheck } = await db
          .from("scrape_jobs")
          .select("status")
          .eq("id", jobId)
          .maybeSingle();
        if (jobCheck?.status !== "running") {
          console.log(`[scrape] Job ${jobId} status changed to ${jobCheck?.status}, stopping`);
          break;
        }
      }

      try {
        const makeSlug = brand.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-+$/, "");
        const existing = makeByAutodataSlug.get(brand.slug) ?? makeBySlug.get(makeSlug);

        if (!existing) {
          // NEW BRAND — skip for incremental (full scrape needed)
          console.log(`[scrape] NEW brand detected: ${brand.name} (skipping — needs full scrape)`);
          newBrandsCount++;
          continue;
        }

        // EXISTING BRAND — check for new models
        const makeId = existing.id;

        // Load existing model names (name only — case insensitive)
        const { data: existingModels } = await db
          .from("ymme_models")
          .select("name")
          .eq("make_id", makeId);

        const existingModelNames = new Set(
          (existingModels ?? []).map((m: { name: string }) => m.name.toLowerCase().trim())
        );

        // Fetch live models
        await sleep(delayMs);
        const liveModels = await fetchModelsForBrand(brand.pageUrl);

        for (const model of liveModels) {
          if (existingModelNames.has(model.name.toLowerCase().trim())) continue;

          // NEW MODEL found
          try {
            const modelId = await upsertModel(makeId, model);
            if (!modelId) continue;

            newModelsCount++;
            console.log(`[scrape] NEW model: ${brand.name} ${model.name}`);

            await logChange({
              entity_type: "model",
              entity_id: modelId,
              action: "added",
              entity_name: model.name,
              parent_name: brand.name,
            });

            // Scrape engines for new model
            await sleep(delayMs);
            const engines = await fetchEnginesForModel(model.pageUrl);

            for (const engine of engines) {
              const engineId = await upsertEngine(modelId, engine);
              if (!engineId) continue;

              newEnginesCount++;
              await logChange({
                entity_type: "engine",
                entity_id: engineId,
                action: "added",
                entity_name: engine.name,
                parent_name: `${brand.name} ${model.name}`,
              });
            }
          } catch (err) {
            const msg = `Model error (${brand.name} ${model.name}): ${err instanceof Error ? err.message : String(err)}`;
            console.error(`[scrape] ${msg}`);
            errors.push(msg);
          }
        }

        // Update last_scraped_at
        await db.from("ymme_makes").update({ last_scraped_at: new Date().toISOString() }).eq("id", makeId);

      } catch (err) {
        const msg = `Brand error (${brand.name}): ${err instanceof Error ? err.message : String(err)}`;
        console.error(`[scrape] ${msg}`);
        errors.push(msg);
      }

      // Update progress after each brand
      const progress = Math.round(((i + 1) / totalBrands) * 100);
      await db.from("scrape_jobs").update({
        processed_items: i + 1,
        total_items: totalBrands,
        progress,
        current_item: brand.name,
        result: {
          brandsChecked: i + 1,
          newBrands: newBrandsCount,
          newModels: newModelsCount,
          newEngines: newEnginesCount,
          newSpecs: newSpecsCount,
          errors: errors.length,
        },
      }).eq("id", jobId);
    }

    // 5. Check if all brands are done
    if (endIndex >= totalBrands) {
      await db.from("scrape_jobs").update({
        status: "completed",
        progress: 100,
        completed_at: new Date().toISOString(),
        processed_items: totalBrands,
        result: {
          brandsChecked: totalBrands,
          newBrands: newBrandsCount,
          newModels: newModelsCount,
          newEngines: newEnginesCount,
          newSpecs: newSpecsCount,
          errors: errors.length,
        },
      }).eq("id", jobId);
      console.log(`[scrape] Job ${jobId} COMPLETED — all ${totalBrands} brands processed`);
    } else {
      console.log(`[scrape] Job ${jobId} batch done — processed brands ${startIndex}-${endIndex - 1}, resuming next invocation`);
    }

    return new Response(JSON.stringify({
      ok: true,
      processed: endIndex - startIndex,
      total: totalBrands,
      remaining: totalBrands - endIndex,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error("[scrape] Fatal error:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
