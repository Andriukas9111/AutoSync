/**
 * Incremental Scrape API
 * POST /app/api/scrape-incremental — creates a scrape_job for the Edge Function to process
 *
 * Admin-only. Creates a scrape_job record and returns immediately.
 * The Supabase Edge Function `process-scrape` picks up the job via pg_cron
 * and processes brands in batches (no timeout issues).
 */

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import { isAdminShop } from "../lib/admin.server";
import db from "../lib/db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  if (!isAdminShop(session.shop)) {
    throw new Response("Forbidden", { status: 403 });
  }

  try {
    const formData = await request.formData();
    const delayMs = parseInt(formData.get("delay_ms") as string || "1500", 10);
    const scrapeSpecs = (formData.get("scrape_specs") as string) !== "false";

    // Clean up stuck jobs (>30min old)
    await db
      .from("scrape_jobs")
      .update({ status: "failed", completed_at: new Date().toISOString(), result: { error: "Timed out (stuck >30min)" } })
      .eq("status", "running")
      .lt("started_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());

    // Check for existing running jobs
    const { data: existingJobs } = await db
      .from("scrape_jobs")
      .select("id")
      .in("status", ["running", "pending"])
      .limit(1);

    if (existingJobs && existingJobs.length > 0) {
      return data(
        { ok: false, error: "A scrape job is already running. Wait for it to complete." },
        { status: 409 },
      );
    }

    // Create scrape_job record — Edge Function picks this up via pg_cron
    const { data: job, error: jobError } = await db
      .from("scrape_jobs")
      .insert({
        type: "incremental_update",
        status: "running",
        config: { delayMs, scrapeSpecs },
        started_at: new Date().toISOString(),
        processed_items: 0,
        progress: 0,
      })
      .select("id")
      .maybeSingle();

    if (jobError || !job) {
      return data(
        { ok: false, error: "Failed to create scrape job: " + (jobError?.message ?? "unknown") },
        { status: 500 },
      );
    }

    // No fire-and-forget! The Edge Function `process-scrape` handles
    // the actual scraping in batches via pg_cron (every 30s).
    return data({
      ok: true,
      jobId: job.id,
      message: "Incremental update started. The Edge Function will process brands in batches.",
    });
  } catch (err) {
    return data(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
};
