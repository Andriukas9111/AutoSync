import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { fetchProductsFromShopify } from "../lib/pipeline/fetch.server";

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
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
    return data({ error: "Failed to create sync job" }, { status: 500 });
  }

  // Run the fetch (synchronous for now — will be optimized later)
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
  } catch (err: any) {
    return data({ error: err.message ?? "Fetch failed" }, { status: 500 });
  }
}
