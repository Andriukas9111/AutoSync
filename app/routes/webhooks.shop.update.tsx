import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";

/**
 * SHOP_UPDATE webhook — fires when shop domain, email, or settings change.
 * Required by Shopify for App Store compliance.
 * Updates tenant record with latest shop info.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic} for ${shop}`);

  // Update tenant with latest shop info if available
  if (payload) {
    const updates: Record<string, string | null> = {};

    // Shop may change its myshopify domain
    if (payload.myshopify_domain && typeof payload.myshopify_domain === "string") {
      updates.shop_id = payload.myshopify_domain;
    }

    // Store the shop name if provided
    if (payload.name && typeof payload.name === "string") {
      updates.shop_name = payload.name;
    }

    // Store email if provided
    if (payload.email && typeof payload.email === "string") {
      updates.shop_email = payload.email;
    }

    // Only update if we have fields to update
    if (Object.keys(updates).length > 0) {
      // Don't update shop_id (primary key) — just log domain changes
      const { shop_id: _newDomain, ...safeUpdates } = updates;

      if (Object.keys(safeUpdates).length > 0) {
        await db
          .from("tenants")
          .update(safeUpdates)
          .eq("shop_id", shop);
      }

      // Log domain change if it happened (critical event)
      if (updates.shop_id && updates.shop_id !== shop) {
        console.warn(
          `[webhook] Shop domain change detected: ${shop} → ${updates.shop_id}. ` +
          `Manual migration may be needed.`
        );
      }
    }
  }

  return new Response("OK", { status: 200 });
};
