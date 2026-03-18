import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { fetchProductsFromShopify } from "../lib/pipeline/fetch.server";

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

  // Create a sync job record
  const { data: job, error: jobError } = await db
    .from("sync_jobs")
    .insert({
      shop_id: shopId,
      type: "fetch",
      status: "pending",
      progress: 0,
    })
    .select("id")
    .single();

  if (jobError || !job) {
    console.error("[fetch-products] Job creation failed:", jobError?.message);
    return data({ error: `Failed to create sync job: ${jobError?.message ?? "unknown"}` }, { status: 500 });
  }

  // Run the fetch
  try {
    const result = await fetchProductsFromShopify({
      admin,
      shopId,
      jobId: job.id,
    });

    return data({
      success: true,
      fetched: result.fetched,
      errors: result.errors,
      jobId: job.id,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Fetch failed";
    const stack = err instanceof Error ? err.stack : undefined;
    console.error("[fetch-products] Pipeline error:", message, stack);

    // Mark job as failed so dashboard shows accurate status
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
