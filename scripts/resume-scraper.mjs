/**
 * Resume auto-data.net scraper using the existing scraper code.
 * Usage: npx tsx scripts/resume-scraper.mjs
 *
 * This script:
 * 1. Finds the last stalled scrape job
 * 2. Marks it as interrupted
 * 3. Starts a new job resuming from where it stopped
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

// Load env
const envContent = readFileSync(".env", "utf-8");
const getEnv = (key) => {
  const m = envContent.match(new RegExp(`${key}=(.+)`));
  return m ? m[1].trim() : process.env[key];
};

const db = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

async function main() {
  console.log("=== AutoSync YMME Scraper — Resume Check ===");
  console.log(`Time: ${new Date().toISOString()}`);

  // Find stalled job
  const { data: stalledJob } = await db
    .from("scrape_jobs")
    .select("*")
    .eq("status", "running")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (stalledJob) {
    console.log(`Found stalled job: ${stalledJob.id}`);
    console.log(`  Type: ${stalledJob.type}`);
    console.log(`  Processed: ${stalledJob.processed_items}/${stalledJob.total_items} items`);
    console.log(`  Last brand: ${stalledJob.current_item || "unknown"}`);
    console.log(`  Started: ${stalledJob.started_at}`);

    // Mark as interrupted
    await db.from("scrape_jobs").update({
      status: "interrupted",
      completed_at: new Date().toISOString(),
    }).eq("id", stalledJob.id);
    console.log("  -> Marked as interrupted");
  } else {
    console.log("No stalled jobs found. Starting fresh.");
  }

  // Get current DB stats
  const [makesRes, modelsRes, enginesRes] = await Promise.all([
    db.from("ymme_makes").select("id", { count: "exact", head: true }),
    db.from("ymme_models").select("id", { count: "exact", head: true }),
    db.from("ymme_engines").select("id", { count: "exact", head: true }),
  ]);

  console.log(`\nCurrent DB: ${makesRes.count} makes, ${modelsRes.count} models, ${enginesRes.count} engines`);
  console.log("\nTo start the scraper, use the Admin Panel in the Shopify app.");
  console.log("The scraper runs client-side (brand-by-brand API calls) to survive serverless timeouts.");
  console.log("\nAlternatively, use the full scraper via:");
  console.log("  npx tsx -e \"import { startScrapeJob } from './app/lib/scrapers/autodata.server'; startScrapeJob({ type: 'autodata_full', scrapeSpecs: true })\"");
}

main().catch(console.error);
