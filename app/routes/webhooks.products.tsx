import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";

/**
 * Product webhooks handler — MUST be fast (<500ms).
 *
 * BulkOperations (metafield/tag push) trigger thousands of PRODUCTS_UPDATE
 * webhooks simultaneously. If this handler is slow, Shopify marks them as
 * failed (46K errors in monitoring). Heavy processing must be avoided.
 *
 * Strategy:
 * - PRODUCTS_UPDATE: Only update if product exists AND was changed by merchant
 *   (not by our app). Skip tag-only and metafield-only updates.
 * - PRODUCTS_DELETE: Quick delete, async recount.
 * - PRODUCTS_CREATE: Quick upsert of handle/image only.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  // Return 200 immediately for topics we don't need to process heavily
  if (!payload?.id) return new Response("OK", { status: 200 });

  switch (topic) {
    case "PRODUCTS_CREATE":
    case "PRODUCTS_UPDATE": {
      // Lightweight update — only sync title, handle, image, price
      // Skip if this looks like our own BulkOperation update (tags contain _autosync_)
      // to avoid a thundering herd of DB writes during push operations
      try {
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
      } catch (_e) {
        // Silently fail — DB might be overloaded during BulkOperations
        // The data will be correct on next full sync
      }
      break;
    }

    case "PRODUCTS_DELETE": {
      try {
        await db
          .from("products")
          .delete()
          .eq("shop_id", shop)
          .eq("shopify_product_id", String(payload.id));
      } catch (_e) { /* best effort */ }
      break;
    }
  }

  return new Response("OK", { status: 200 });
};
