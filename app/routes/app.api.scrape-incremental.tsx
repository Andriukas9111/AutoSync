/**
 * Incremental Scrape API
 * POST /app/api/scrape-incremental — runs incremental update (new brands + new models only)
 *
 * Admin-only. Creates a scrape_job with type "incremental_update",
 * then runs the incremental scraper which:
 * - Checks all brands for new additions
 * - Compares model counts to detect new models
 * - Deep-scrapes only NEW content (engines + specs)
 * - Logs every addition to scrape_changelog
 *
 * Body (FormData, all optional):
 * - delay_ms: number (delay between requests, default 1500)
 * - scrape_specs: "true" | "false" (default true)
 *
 * Returns: { ok, jobId, result }
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

    // Run incremental update
    const result = await runIncrementalUpdate({ jobId, delayMs, scrapeSpecs });

    return data({ ok: true, jobId, result });
  } catch (err) {
    return data(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
};
