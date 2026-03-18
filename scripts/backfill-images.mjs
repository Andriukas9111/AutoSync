/**
 * Backfill Vehicle Images from auto-data.net
 *
 * Lightweight script that ONLY scrapes images for engines that already have
 * specs in ymme_vehicle_specs but are missing hero_image_url. Much faster
 * than backfill-engine-specs since it skips spec table parsing.
 *
 * Usage:
 *   node scripts/backfill-images.mjs
 *   node scripts/backfill-images.mjs --delay=1500 --batch=50 --limit=1000
 *   node scripts/backfill-images.mjs --dry-run
 *
 * Resumable: skips rows that already have hero_image_url populated.
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// ── Config ───────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// Parse CLI args
const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace(/^--/, "").split("=");
  acc[key] = val ?? "true";
  return acc;
}, {});

const DELAY_MS = parseInt(args.delay ?? "800", 10);
const BATCH_SIZE = parseInt(args.batch ?? "50", 10);
const MAX_ROWS = parseInt(args.limit ?? "0", 10); // 0 = no limit
const DRY_RUN = args["dry-run"] === "true";
const BASE_URL = "https://www.auto-data.net";
const IMAGE_BASE = "https://www.auto-data.net/images/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// ── Stats ────────────────────────────────────────────────────────────────────

let totalProcessed = 0;
let totalImagesFound = 0;
let totalSkipped = 0;
let totalErrors = 0;
const startTime = Date.now();

// ── HTTP Fetcher ─────────────────────────────────────────────────────────────

async function fetchPage(url) {
  const fullUrl = url.startsWith("http") ? url : BASE_URL + url;
  const response = await fetch(fullUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    },
  });

  if (!response.ok) {
    throw new Error("HTTP " + response.status + " for " + fullUrl);
  }

  return response.text();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Image Extractor ──────────────────────────────────────────────────────────

/**
 * Extracts vehicle images from an auto-data.net engine detail page.
 * Images are stored in JavaScript arrays: bigs[] (full-size) and smalls[] (thumbnails).
 * Also looks for <img> tags with /images/ src paths as fallback.
 *
 * Returns { heroImageUrl, galleryImages } where galleryImages is an array of
 * full-size image URLs (excludes the hero to avoid duplication).
 */
function extractImages(html) {
  const allFullUrls = [];

  // Strategy 1: Parse bigs[] JavaScript array (most reliable, full-size images)
  const bigsPattern = /bigs\[\d+\]\s*=\s*"([^"]+)"/g;
  let bigsMatch;
  while ((bigsMatch = bigsPattern.exec(html)) !== null) {
    const relPath = bigsMatch[1].trim();
    if (relPath) {
      allFullUrls.push(IMAGE_BASE + relPath);
    }
  }

  // Strategy 2: Fallback — parse <img> tags with /images/ src (if no JS arrays found)
  if (allFullUrls.length === 0) {
    const imgPattern = /<img[^>]+src="(\/images\/[^"]+)"/gi;
    let imgMatch;
    while ((imgMatch = imgPattern.exec(html)) !== null) {
      const src = imgMatch[1].trim();
      // Skip thumbnails — we want full-size only
      if (src.includes("_thumb.")) continue;
      const fullUrl = "https://www.auto-data.net" + src;
      if (!allFullUrls.includes(fullUrl)) {
        allFullUrls.push(fullUrl);
      }
    }
  }

  if (allFullUrls.length === 0) {
    return { heroImageUrl: null, galleryImages: [] };
  }

  // First image is the hero; rest are gallery
  const heroImageUrl = allFullUrls[0];
  const galleryImages = allFullUrls.slice(1);

  return { heroImageUrl, galleryImages };
}

// ── Database ─────────────────────────────────────────────────────────────────

async function getRowCount() {
  // Count vehicle_specs rows that have a source_url but no hero_image_url
  const { count, error } = await db
    .from("ymme_vehicle_specs")
    .select("engine_id", { count: "exact", head: true })
    .not("source_url", "is", null)
    .is("hero_image_url", null);

  if (error) {
    console.error("Failed to count rows:", error.message);
    return 0;
  }
  return count ?? 0;
}

async function fetchBatch(limit) {
  // Always fetch from top: updated rows no longer match hero_image_url IS NULL
  const { data, error } = await db
    .from("ymme_vehicle_specs")
    .select("engine_id, source_url")
    .not("source_url", "is", null)
    .is("hero_image_url", null)
    .order("engine_id", { ascending: true })
    .range(0, limit - 1);

  if (error) {
    console.error("Failed to fetch batch:", error.message);
    return [];
  }
  return data ?? [];
}

async function updateImages(engineId, images) {
  const update = {
    hero_image_url: images.heroImageUrl,
    gallery_images: images.galleryImages.length ? images.galleryImages : null,
    image_scraped_at: new Date().toISOString(),
  };

  const { error } = await db
    .from("ymme_vehicle_specs")
    .update(update)
    .eq("engine_id", engineId);

  if (error) {
    console.error("  [ERROR] Image update " + engineId + ": " + error.message);
    return false;
  }
  return true;
}

// ── Processing ───────────────────────────────────────────────────────────────

async function processRow(row) {
  const url = row.source_url;
  try {
    const html = await fetchPage(url);
    const images = extractImages(html);

    if (!images.heroImageUrl) {
      totalSkipped++;
      return;
    }

    const imageCount = 1 + images.galleryImages.length;

    if (DRY_RUN) {
      console.log(
        "  [DRY RUN] engine=" + row.engine_id +
        ": " + imageCount + " images found" +
        " | hero=" + images.heroImageUrl
      );
      totalImagesFound++;
      return;
    }

    const ok = await updateImages(row.engine_id, images);
    if (ok) {
      totalImagesFound++;
    }
  } catch (err) {
    totalErrors++;
    const msg = err.message || String(err);
    if (msg.includes("HTTP 429")) {
      console.warn("  [RATE LIMITED] engine=" + row.engine_id + " -- backing off 30s");
      await sleep(30000);
    } else if (msg.includes("HTTP 403")) {
      console.warn("  [BLOCKED] engine=" + row.engine_id + " -- backing off 60s");
      await sleep(60000);
    } else if (msg.includes("HTTP 5")) {
      console.warn("  [SERVER ERROR] engine=" + row.engine_id + ": " + msg + " -- backing off 10s");
      await sleep(10000);
    } else {
      console.error("  [ERROR] engine=" + row.engine_id + ": " + msg);
    }
  }
}

// ── Utilities ────────────────────────────────────────────────────────────────

function formatDuration(ms) {
  const secs = Math.floor(ms / 1000);
  const mins = Math.floor(secs / 60);
  const hours = Math.floor(mins / 60);
  if (hours > 0) return hours + "h " + (mins % 60) + "m " + (secs % 60) + "s";
  if (mins > 0) return mins + "m " + (secs % 60) + "s";
  return secs + "s";
}

function estimateRemaining(processed, total) {
  if (processed === 0) return "calculating...";
  const elapsed = Date.now() - startTime;
  const perRow = elapsed / processed;
  const remaining = (total - processed) * perRow;
  return formatDuration(remaining);
}

// ── Main Loop ────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Vehicle Image Backfill ===");
  console.log(
    "Delay: " + DELAY_MS + "ms | " +
    "Batch: " + BATCH_SIZE + " | " +
    "Limit: " + (MAX_ROWS || "none") + " | " +
    "Dry run: " + DRY_RUN
  );
  console.log("");

  const totalCount = await getRowCount();
  console.log("Found " + totalCount + " specs rows with source_url but missing hero_image_url");

  if (totalCount === 0) {
    console.log("Nothing to do!");
    return;
  }

  const effectiveTotal = MAX_ROWS > 0 ? Math.min(totalCount, MAX_ROWS) : totalCount;
  console.log("Will process " + effectiveTotal + " rows\n");

  let processed = 0;

  while (processed < effectiveTotal) {
    const batchSize = Math.min(BATCH_SIZE, effectiveTotal - processed);
    const batch = await fetchBatch(batchSize);

    if (batch.length === 0) {
      console.log("No more rows to process.");
      break;
    }

    for (const row of batch) {
      if (MAX_ROWS > 0 && processed >= MAX_ROWS) break;

      await processRow(row);
      processed++;

      // Progress log every 10 rows
      if (processed % 10 === 0 || processed === effectiveTotal) {
        const elapsed = formatDuration(Date.now() - startTime);
        const eta = estimateRemaining(processed, effectiveTotal);
        console.log(
          "Processed " + processed + "/" + effectiveTotal + ", " +
          totalImagesFound + " with images, " +
          totalSkipped + " no images, " +
          totalErrors + " errors | " +
          "Elapsed: " + elapsed + " | ETA: " + eta
        );
      }

      await sleep(DELAY_MS);
    }
  }

  // Final summary
  const elapsed = formatDuration(Date.now() - startTime);
  console.log("\n=== COMPLETE ===");
  console.log("Total processed:  " + processed);
  console.log("Images found:     " + totalImagesFound);
  console.log("No images on page: " + totalSkipped);
  console.log("Errors:           " + totalErrors);
  console.log("Duration:         " + elapsed);
}

// ── Run ──────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
