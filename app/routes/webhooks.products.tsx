import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";

/**
 * Product webhooks handler — MUST return 200 within 500ms. NO EXCEPTIONS.
 *
 * Rules:
 * 1. ALWAYS return 200 — even if DB fails
 * 2. ALL DB operations wrapped in try/catch — never crash
 * 3. NO heavy processing — only lightweight DB updates
 * 4. NO job creation in webhook — use pg_cron hourly sync instead
 * 5. BulkOperations trigger thousands of webhooks — handler MUST be instant
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  // Return 200 immediately if no payload
  if (!payload?.id) return new Response("OK", { status: 200 });

  try {
    switch (topic) {
      case "PRODUCTS_CREATE":
      case "PRODUCTS_UPDATE": {
        // Lightweight sync — only update title/handle/image/price
        // Skip entirely during bulk ops to avoid thundering herd
        await db
          .from("products")
          .update({
            title: payload.title,
            handle: payload.handle,
            image_url: payload.image?.src ?? undefined,
            price: payload.variants?.[0]?.price ?? undefined,
            updated_at: new Date().toISOString(),
          })
          .eq("shop_id", shop)
          .eq("shopify_product_id", String(payload.id));
        break;
      }

      case "PRODUCTS_DELETE": {
        // Delete product from DB — CASCADE handles fitments automatically
        // The hourly sync_stale_tenant_data() pg_cron job will:
        // - Recount tenant product/fitment counts
        // - Deactivate makes with 0 fitments
        // - Mark stale vehicle pages for deletion
        // NO sync_after_delete job created here — that caused 100% webhook failures
        await db
          .from("products")
          .delete()
          .eq("shop_id", shop)
          .eq("shopify_product_id", String(payload.id));
        break;
      }
    }
  } catch (_e) {
    // NEVER crash — silently fail, data will self-correct via hourly pg_cron sync
  }

  // ALWAYS return 200 — Shopify counts anything else as a failure
  return new Response("OK", { status: 200 });
};
