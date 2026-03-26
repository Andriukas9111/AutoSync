/**
 * Incremental Scrape API
 * POST /app/api/scrape-incremental — runs incremental update (new brands + new models only)
 *
 * Admin-only. Creates a scrape_job, starts the scraper in the background
 * (fire-and-forget), and returns immediately with the jobId.
 * The admin panel polls scrape_jobs for progress.
 */

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import { isAdminShop } from "../lib/admin.server";
import { runIncrementalUpdate } from "../lib/scrapers/autodata.server";
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

    // Check for existing running scrape job
    const { data: existingJob } = await db
      .from("scrape_jobs")
      .select("id")
      .in("status", ["running", "pending"])
      .maybeSingle();

    if (existingJob) {
      return data(
        { ok: false, error: "A scrape job is already running. Wait for it to complete." },
        { status: 409 },
      );
    }

    // Create scrape_job record
    const { data: job, error: jobError } = await db
      .from("scrape_jobs")
      .insert({
        type: "incremental_update",
        status: "running",
        config: { delayMs, scrapeSpecs },
        started_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (jobError || !job) {
      return data(
        { ok: false, error: "Failed to create scrape job: " + (jobError?.message ?? "unknown") },
        { status: 500 },
      );
    }

    const jobId = job.id;

    // Fire-and-forget: start the scraper in the background
    // Don't await — return immediately so Vercel doesn't timeout
    runIncrementalUpdate({ jobId, delayMs, scrapeSpecs })
      .then(async (result) => {
        await db.from("scrape_jobs").update({
          status: "completed",
          completed_at: new Date().toISOString(),
          result,
        }).eq("id", jobId);
      })
      .catch(async (err) => {
        await db.from("scrape_jobs").update({
          status: "failed",
          completed_at: new Date().toISOString(),
          result: { error: err instanceof Error ? err.message : "Unknown error" },
        }).eq("id", jobId);
      });

    return data({ ok: true, jobId, message: "Incremental update started. Check progress in the YMME tab." });
  } catch (err) {
    return data(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
};
