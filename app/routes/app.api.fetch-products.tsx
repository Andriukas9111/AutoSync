import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { fetchProductsFromShopify } from "../lib/pipeline/fetch.server";

export async function action({ request }: ActionFunctionArgs) {
  console.log("[fetch-products] Action started");

  let admin, session;
  try {
    const auth = await authenticate.admin(request);
    admin = auth.admin;
    session = auth.session;
    console.log("[fetch-products] Authenticated:", session.shop);
  } catch (authErr: any) {
    console.error("[fetch-products] Auth failed:", authErr.message);
    return data({ error: `Authentication failed: ${authErr.message}` }, { status: 401 });
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

  console.log("[fetch-products] Job created:", job.id);

  // Run the fetch
  try {
    const result = await fetchProductsFromShopify({
      admin,
      shopId,
      jobId: job.id,
    });

    console.log("[fetch-products] Complete:", result.fetched, "products fetched");

    return data({
      success: true,
      fetched: result.fetched,
      errors: result.errors,
      jobId: job.id,
    });
  } catch (err: any) {
    console.error("[fetch-products] Pipeline error:", err.message, err.stack);
    return data({ error: err.message ?? "Fetch failed" }, { status: 500 });
  }
}
