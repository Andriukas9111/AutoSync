import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db, { triggerEdgeFunction } from "../lib/db.server";
import { assertFeature } from "../lib/billing.server";

// ---------------------------------------------------------------------------
// POST — Create a push job (processed by Edge Function via pg_cron)
//
// This route returns INSTANTLY after creating the job record.
// The Supabase Edge Function `process-jobs` picks it up within 30 seconds.
// This avoids Vercel's serverless timeout (10s free / 60s pro).
// ---------------------------------------------------------------------------
export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Parse options from request body
  const body = await request.json();
  const pushTags = body.pushTags !== false; // default true
  const pushMetafields = body.pushMetafields !== false; // default true

  // Gate features behind billing
  try {
    if (pushTags) {
      await assertFeature(shopId, "pushTags");
    }
    if (pushMetafields) {
      await assertFeature(shopId, "pushMetafields");
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "BillingGateError") {
      const billingErr = err as Error & { feature?: string; currentPlan?: string; requiredPlan?: string };
      return data(
        {
          error: billingErr.message,
          feature: billingErr.feature,
          currentPlan: billingErr.currentPlan,
          requiredPlan: billingErr.requiredPlan,
        },
        { status: 403 },
      );
    }
    throw err;
  }

  // Concurrency guard — prevent push while cleanup or another push is running
  const { data: conflictingJob } = await db
    .from("sync_jobs")
    .select("id, type")
    .eq("shop_id", shopId)
    .in("type", ["push", "bulk_push", "cleanup"])
    .in("status", ["running", "pending", "processing"])
    .limit(1)
    .maybeSingle();

  if (conflictingJob) {
    const msg = conflictingJob.type === "push"
      ? "A push operation is already in progress"
      : `Cannot start push while a ${conflictingJob.type} job is running`;
    return data({ error: msg }, { status: 409 });
  }

  // Get the total count of pushable products — only products with REAL fitments
  // Exclude: unmapped (no fitments), no_match (extraction found nothing), flagged (needs review)
  const { count: mappedCount } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .neq("status", "staged")
    .in("fitment_status", ["auto_mapped", "smart_mapped", "manual_mapped"]);

  // Auto-select bulk push for plans that support it (Growth+)
  // Bulk operations are 10-20x faster for large catalogs
  let useBulk = false;
  try {
    await assertFeature(shopId, "bulkOperations");
    useBulk = true;
  } catch {
    // Plan doesn't support bulk ops — use regular push
  }

  const jobType = useBulk ? "bulk_push" : "push";
  const { data: job, error: jobError } = await db
    .from("sync_jobs")
    .insert({
      shop_id: shopId,
      type: jobType,
      status: useBulk ? "running" : "pending",
      progress: 0,
      total_items: mappedCount ?? 0,
      processed_items: 0,
      metadata: JSON.stringify({ pushTags, pushMetafields, method: useBulk ? "bulk_operations" : "individual" }),
      started_at: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (jobError || !job) {
    return data({ error: "Failed to create sync job" }, { status: 500 });
  }

  // Fire-and-forget: invoke Edge Function directly (no pg_cron dependency)
  triggerEdgeFunction(job.id, shopId);

  return data({
    success: true,
    jobId: job.id,
    totalItems: mappedCount ?? 0,
    message: "Push job created. Processing will begin shortly.",
  });
}

// ---------------------------------------------------------------------------
// GET — Return latest push job status
// ---------------------------------------------------------------------------
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const { data: job, error } = await db
    .from("sync_jobs")
    .select("*")
    .eq("shop_id", shopId)
    .eq("type", "push")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !job) {
    return data({ job: null });
  }

  return data({ job });
}
