/**
 * Standalone scrape runner — bypasses Shopify auth entirely.
 * Calls the autodata.server.ts scraper functions directly.
 *
 * Usage:
 *   npx tsx scripts/run-scrape.ts                    # Full scrape (all brands, with specs)
 *   npx tsx scripts/run-scrape.ts --max 5            # First 5 brands only
 *   npx tsx scripts/run-scrape.ts --resume bmw       # Resume from BMW
 *   npx tsx scripts/run-scrape.ts --no-specs         # Skip Level 4 spec pages
 *   npx tsx scripts/run-scrape.ts --delay 2000       # 2s delay between requests
 *   npx tsx scripts/run-scrape.ts --brands-only      # Level 1 only: just fetch brand list
 */

// ── Load .env BEFORE any app imports (dynamic imports below) ────────────────
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env");
try {
  const envFile = readFileSync(envPath, "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = val;
    }
  }
  console.log("[env] Loaded .env — SUPABASE_URL:", process.env.SUPABASE_URL?.slice(0, 30) + "...");
} catch {
  console.warn("Warning: Could not load .env file from", envPath);
}

// ── Dynamic imports (AFTER env is loaded, so db.server.ts sees the vars) ────
const { scrapeAutoData, fetchBrandList } = await import(
  "../app/lib/scrapers/autodata.server"
);
const { createClient } = await import("@supabase/supabase-js");
const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// ── Parse CLI args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

const maxBrands = getArg("--max") ? parseInt(getArg("--max")!, 10) : undefined;
const resumeFrom = getArg("--resume");
const delayMs = getArg("--delay") ? parseInt(getArg("--delay")!, 10) : 1500;
const scrapeSpecs = !args.includes("--no-specs");
const brandsOnly = args.includes("--brands-only");

// ── Banner ──────────────────────────────────────────────────────────────────

console.log(`
╔════════════════════════════════════════════════════════════╗
║  AutoSync — auto-data.net Scraper (standalone runner)     ║
╠════════════════════════════════════════════════════════════╣
║  Max brands:   ${String(maxBrands ?? "ALL").padEnd(40)}║
║  Resume from:  ${String(resumeFrom ?? "(start)").padEnd(40)}║
║  Delay:        ${String(delayMs + "ms").padEnd(40)}║
║  Scrape specs: ${String(scrapeSpecs ? "YES (Level 4)" : "NO (skip)").padEnd(40)}║
║  Brands only:  ${String(brandsOnly ? "YES" : "NO").padEnd(40)}║
╚════════════════════════════════════════════════════════════╝
`);

// ── Run ─────────────────────────────────────────────────────────────────────

async function main() {
  // Quick mode: just list brands
  if (brandsOnly) {
    console.log("[run-scrape] Fetching brand list from auto-data.net...");
    const brands = await fetchBrandList();
    console.log(`[run-scrape] Found ${brands.length} brands:`);
    brands.forEach((b: { name: string; country: string | null; pageUrl: string }, i: number) =>
      console.log(
        `  ${String(i + 1).padStart(3)}. ${b.name} (${b.country ?? "?"}) — ${b.pageUrl}`,
      ),
    );
    process.exit(0);
  }

  // Create a scrape job record for tracking (but don't use startScrapeJob
  // which internally calls scrapeAutoData — we call it ourselves below)
  const { data: job } = await db
    .from("scrape_jobs")
    .insert({
      type: "autodata_full",
      status: "running",
      config: { maxBrands, resumeFrom, delayMs, scrapeSpecs },
      resume_from: resumeFrom ?? null,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  const jobId = job?.id;
  console.log(`[run-scrape] Created scrape job: ${jobId}`);
  console.log("[run-scrape] Starting full scrape...\n");

  const result = await scrapeAutoData({
    jobId: jobId ?? undefined,
    resumeFrom: resumeFrom ?? undefined,
    maxBrands,
    delayMs,
    scrapeSpecs,
    onProgress: (p: {
      currentBrand: string;
      brandsProcessed: number;
      brandsTotal: number;
      modelsProcessed: number;
      enginesProcessed: number;
      specsProcessed: number;
      errors: string[];
    }) => {
      const pct = Math.round(
        (p.brandsProcessed / Math.max(p.brandsTotal, 1)) * 100,
      );
      console.log(
        `[${pct}%] ${p.currentBrand} — brands=${p.brandsProcessed}/${p.brandsTotal} models=${p.modelsProcessed} engines=${p.enginesProcessed} specs=${p.specsProcessed}`,
      );
      if (p.errors.length > 0) {
        p.errors.forEach((e: string) => console.log(`  ⚠ ${e}`));
      }
    },
  });

  console.log(`\n${"═".repeat(60)}`);
  console.log("SCRAPE COMPLETE");
  console.log(`${"═".repeat(60)}`);
  console.log(`  Brands:  ${result.brandsProcessed}`);
  console.log(`  Models:  ${result.modelsProcessed}`);
  console.log(`  Engines: ${result.enginesProcessed}`);
  console.log(`  Specs:   ${result.specsProcessed}`);
  console.log(`  Logos:   ${result.logosResolved}`);
  console.log(`  Errors:  ${result.errors.length}`);
  console.log(
    `  Duration: ${Math.round(result.duration / 1000)}s (${Math.round(result.duration / 60000)}m)`,
  );
  if (result.errors.length > 0) {
    console.log("\nErrors (last 20):");
    result.errors.slice(-20).forEach((e: string) => console.log(`  • ${e}`));
  }
  console.log();
}

main().catch((err) => {
  console.error("[run-scrape] Fatal error:", err);
  process.exit(1);
});
