/**
 * API Route: Bulk Push to Shopify
 *
 * Uses Shopify Bulk Operations API for 25x faster push.
 * Creates two concurrent bulk operations (tags + metafields).
 * Growth+ plan required.
 */

import type { ActionFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { assertFeature } from "../lib/billing.server";
import { runBulkPush } from "../lib/pipeline/bulk-push.server";
import { ensureMetafieldDefinitions } from "../lib/pipeline/metafield-definitions.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopId = session.shop;

  try {
    // Gate: Growth+ required for bulk push
    await assertFeature(shopId, "bulkOperations");
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "BillingGateError") {
      return data({ error: "Bulk push requires Growth plan or above" }, { status: 403 });
    }
    throw err;
  }

  // Ensure metafield definitions exist
  await ensureMetafieldDefinitions(shopId, admin);

  // Get access token
  const { data: tenant } = await db
    .from("tenants")
    .select("shopify_access_token")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!tenant?.shopify_access_token) {
    return data({ error: "No access token. Open the app first." }, { status: 400 });
  }

  // Create sync job for tracking
  const { data: job } = await db
    .from("sync_jobs")
    .insert({
      shop_id: shopId,
      type: "bulk_push",
      status: "running",
      progress: 0,
      total_items: 0,
      processed_items: 0,
      started_at: new Date().toISOString(),
      metadata: JSON.stringify({ method: "bulk_operations" }),
    })
    .select("id")
    .single();

  try {
    // Run bulk push (generates JSONL, uploads, starts operations)
    const result = await runBulkPush({
      shopId,
      accessToken: tenant.shopify_access_token,
      pushTags: true,
      pushMetafields: true,
    });

    if (result.error) {
      await db.from("sync_jobs").update({
        status: "failed",
        error: result.error,
      }).eq("id", job?.id);
      return data({ error: result.error }, { status: 500 });
    }

    // Update job with bulk operation IDs for polling
    await db.from("sync_jobs").update({
      total_items: result.totalProducts,
      metadata: JSON.stringify({
        method: "bulk_operations",
        metafieldsOperationId: result.metafieldsOperationId,
        tagsOperationId: result.tagsOperationId,
      }),
    }).eq("id", job?.id);

    return data({
      success: true,
      jobId: job?.id,
      totalProducts: result.totalProducts,
      metafieldsOperationId: result.metafieldsOperationId,
      tagsOperationId: result.tagsOperationId,
    });
  } catch (err) {
    await db.from("sync_jobs").update({
      status: "failed",
      error: err instanceof Error ? err.message : "Bulk push failed",
    }).eq("id", job?.id);
    return data({ error: err instanceof Error ? err.message : "Bulk push failed" }, { status: 500 });
  }
};
