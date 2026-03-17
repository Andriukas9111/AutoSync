/**
 * API Route: Auto Extraction
 *
 * POST (action)  — Trigger auto-extraction pipeline (Growth+ plans only)
 * GET  (loader)  — Return latest extraction job status for this shop
 */

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { assertFeature, BillingGateError } from "../lib/billing.server";
import { runAutoExtraction } from "../lib/pipeline/extract.server";

// ── Loader: return latest extract job status ──────────────────

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const { data: job } = await db
    .from("sync_jobs")
    .select("*")
    .eq("shop_id", shopId)
    .eq("type", "extract")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data({ job });
}

// ── Action: trigger auto-extraction ───────────────────────────

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Plan gate: Growth+ only
  try {
    await assertFeature(shopId, "autoExtraction");
  } catch (err) {
    if (err instanceof BillingGateError) {
      return data(
        {
          error: err.message,
          requiredPlan: err.requiredPlan,
          currentPlan: err.currentPlan,
        },
        { status: 403 },
      );
    }
    throw err;
  }

  // Check for an already-running extract job
  const { data: running } = await db
    .from("sync_jobs")
    .select("id")
    .eq("shop_id", shopId)
    .eq("type", "extract")
    .eq("status", "running")
    .limit(1)
    .maybeSingle();

  if (running) {
    return data(
      { error: "An extraction job is already running", jobId: running.id },
      { status: 409 },
    );
  }

  // Create sync_jobs record
  const { data: job, error: jobError } = await db
    .from("sync_jobs")
    .insert({
      shop_id: shopId,
      type: "extract",
      status: "pending",
      processed_items: 0,
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return data({ error: "Failed to create extraction job" }, { status: 500 });
  }

  // Run the extraction pipeline
  try {
    const result = await runAutoExtraction(shopId, job.id);

    return data({
      success: true,
      jobId: job.id,
      processed: result.processed,
      autoMapped: result.autoMapped,
      flagged: result.flagged,
      unmapped: result.unmapped,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : "Extraction failed";

    // Mark job as failed
    await db
      .from("sync_jobs")
      .update({
        status: "failed",
        error: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return data({ error: message, jobId: job.id }, { status: 500 });
  }
}
