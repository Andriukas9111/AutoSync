import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";

/**
 * Mandatory GDPR webhook: shop/redact
 *
 * Shopify sends this 48 hours after app uninstall, requesting
 * all merchant data be deleted. We hard-delete all tenant data.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic}: ${shop} — Redacting all shop data`);

  // Delete all tenant-scoped data in order (child tables first)
  const tables = [
    "vehicle_fitments",
    "sync_jobs",
    "products",
    "providers",
    "collection_mappings",
    "tenant_active_makes",
    "tenants",
  ] as const;

  for (const table of tables) {
    const { error } = await db
      .from(table)
      .delete()
      .eq("shop_id", shop);

    if (error) {
      console.error(`[webhook] ${topic}: Failed to delete from ${table}: ${error.message}`);
    }
  }

  console.log(`[webhook] ${topic}: ${shop} — All data redacted successfully`);

  return new Response(JSON.stringify({ message: "Shop data redacted" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
