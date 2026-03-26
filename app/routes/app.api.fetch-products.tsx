import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { fetchProductsFromShopify } from "../lib/pipeline/fetch.server";
import { assertProductLimit, BillingGateError } from "../lib/billing.server";

// TODO: Move to Edge Function for true background processing.
// Currently runs synchronously with a timeout guard.
// The Edge Function (process-jobs) should handle this in the future.
const FETCH_TIMEOUT_MS = 55_000; // 55s guard — Vercel serverless has 60s limit

export async function action({ request }: ActionFunctionArgs) {
  let admin, session;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
  } catch (authErr: unknown) {
    const msg = authErr instanceof Error ? authErr.message : "Unknown auth error";
    console.error("[fetch-products] Auth failed:", msg);
    return data({ error: `Authentication failed: ${msg}` }, { status: 401 });
  }

  const shopId = session.shop;

  // Plan gate: check product limit
  try {
    await assertProductLimit(shopId);
  } catch (err: unknown) {
    if (err instanceof BillingGateError) {
      return data({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  // Duplicate job prevention
  const { data: existingJob } = await db
    .from("sync_jobs")
    .select("id")
    .eq("shop_id", shopId)
    .eq("type", "fetch")
    .in("status", ["running", "pending"])
    .maybeSingle();

  if (existingJob) {
    return data({ error: "A fetch operation is already in progress" }, { status: 409 });
  }

  // Create a sync job record
  const { data: job, error: jobError } = await db
    .from("sync_jobs")
    .insert({
      shop_id: shopId,
      type: "fetch",
      status: "processing",  // NOT "running" or "pending" — prevents cron worker from claiming this
      progress: 0,
      started_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (jobError || !job) {
    console.error("[fetch-products] Job creation failed:", jobError?.message);
    return data({ error: `Failed to create sync job: ${jobError?.message ?? "unknown"}` }, { status: 500 });
  }

  // Run the fetch with AbortController for proper timeout cancellation.
  // When timeout fires, the signal aborts in-flight GraphQL calls and DB writes.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const result = await fetchProductsFromShopify({
      admin,
      shopId,
      jobId: job.id,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    // Mark job as completed
    await db
      .from("sync_jobs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return data({
      success: true,
      fetched: result.fetched,
      errors: result.errors,
      jobId: job.id,
    });
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    const isAborted = err instanceof DOMException && err.name === "AbortError";
    const isTimeout = isAborted; // Only treat explicit abort as partial success
    const message = isTimeout
      ? "Fetch timed out — partial results saved"
      : (err instanceof Error ? err.message : "Fetch failed");
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[fetch-products] Pipeline error:", message, stack);

    // Mark job as failed (or partial if timed out) so dashboard shows accurate status
    await db
      .from("sync_jobs")
      .update({
        status: isTimeout ? "completed" : "failed",
        error: isTimeout ? "Timed out — partial results saved" : message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    if (isTimeout) {
      // Return real progress from persisted data, not hardcoded 0
      const { data: refreshedJob } = await db
        .from("sync_jobs")
        .select("processed_items")
        .eq("id", job.id)
        .maybeSingle();
      return data({ success: true, fetched: refreshedJob?.processed_items ?? 0, errors: [message], jobId: job.id, partial: true });
    }

    return data({ error: message }, { status: 500 });
  }
}
