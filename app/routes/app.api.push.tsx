import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { assertFeature } from "../lib/billing.server";
import { pushToShopify } from "../lib/pipeline/push.server";

// ---------------------------------------------------------------------------
// POST — Start a push job
// ---------------------------------------------------------------------------
export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
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

  // Create a sync job record
  const { data: job, error: jobError } = await db
    .from("sync_jobs")
    .insert({
      shop_id: shopId,
      type: "push",
      status: "pending",
      progress: 0,
    })
    .select("id")
    .single();

  if (jobError || !job) {
    return data({ error: "Failed to create sync job" }, { status: 500 });
  }

  // Run the push
  try {
    const result = await pushToShopify(shopId, job.id, admin, {
      pushTags,
      pushMetafields,
    });

    return data({
      success: true,
      jobId: job.id,
      processed: result.processed,
      tagsPushed: result.tagsPushed,
      metafieldsPushed: result.metafieldsPushed,
      errors: result.errors,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Push failed";

    // Mark job as failed
    await db
      .from("sync_jobs")
      .update({
        status: "failed",
        error: message,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    return data({ error: message }, { status: 500 });
  }
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
