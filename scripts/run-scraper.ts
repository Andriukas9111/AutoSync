/**
 * Run the auto-data.net scraper directly from CLI.
 * Usage: node --import=dotenv/config node_modules/.bin/tsx scripts/run-scraper.ts
 * Or:    npx tsx --require dotenv/config scripts/run-scraper.ts
 */

// dotenv must be loaded before any app imports
// Use: npx tsx -r dotenv/config scripts/run-scraper.ts

import { startScrapeJob } from "../app/lib/scrapers/autodata.server";

async function main() {
  console.log("=== Starting Auto-Data.net Full Scraper ===");
  console.log(`Time: ${new Date().toISOString()}`);
  console.log("This will scrape ALL brands with full specs.");
  console.log("Uses upserts — safe to re-run, no duplicates.");
  console.log("---");

  try {
    const { jobId, result } = await startScrapeJob({
      type: "autodata_full",
      scrapeSpecs: true,
      delayMs: 500,
    });

    console.log("\n=== SCRAPE COMPLETE ===");
    console.log(`Job ID: ${jobId}`);
    console.log(`Brands: ${result.brandsProcessed}`);
    console.log(`Models: ${result.modelsProcessed}`);
    console.log(`Engines: ${result.enginesProcessed}`);
    console.log(`Specs: ${result.specsProcessed}`);
    console.log(`Logos: ${result.logosResolved}`);
    console.log(`Errors: ${result.errors.length}`);
    if (result.errors.length > 0) {
      console.log("First 10 errors:");
      result.errors.slice(0, 10).forEach((e: string) => console.log(`  - ${e}`));
    }
  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();
