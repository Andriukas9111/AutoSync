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

  // Delete all tenant-scoped data in order (child tables first).
  // GDPR compliance: must delete ALL tables with shop_id column.
  const tables = [
    "extraction_results",
    "vehicle_fitments",
    "wheel_fitments",
    "vehicle_page_sync",
    "search_events",
    "conversion_events",
    "plate_lookups",
    "scrape_changelog",
    "admin_activity_log",
    "sync_jobs",
    "provider_column_mappings",
    "provider_imports",
    "pricing_rules",
    "price_history",
    "price_alerts",
    "products",
    "providers",
    "collection_mappings",
    "tenant_active_makes",
    "tenant_custom_vehicles",
    "app_settings",
    "tenants",  // Delete tenants LAST (parent table with FK CASCADE)
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
