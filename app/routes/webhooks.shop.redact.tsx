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

  console.log(`[webhook] ${topic} — Redacting all shop data`);

  // GDPR compliance: delete ALL tenant data.
  // Strategy: delete tenant row with FK CASCADE to handle most child tables,
  // plus explicit deletes for tables that may not have FK constraints.
  const errors: string[] = [];

  // Explicit deletes for ALL tables with shop_id — belt-and-suspenders approach.
  // Even if FK CASCADE handles most, explicit deletion ensures no data leaks
  // if any migration failed to create FK constraints.
  const explicitTables = [
    "vehicle_fitments",
    "extraction_results",
    "plate_lookups",
    "search_events",
    "conversion_events",
    "vehicle_page_sync",
    "tenant_active_makes",
    "tenant_custom_vehicles",
    "collection_mappings",
    "provider_column_mappings",
    "provider_imports",
    "pricing_rules",
    "price_history",
    "price_alerts",
    "app_settings",
    "sync_jobs",
    "products",
    "providers",
    "scrape_changelog",
    "admin_activity_log",
  ] as const;

  for (const table of explicitTables) {
    const { error } = await db.from(table).delete().eq("shop_id", shop);
    if (error) errors.push(`${table}: ${error.message}`);
  }

  // Delete tenant row — FK CASCADE handles products, providers, fitments, etc.
  const { error: tenantErr } = await db.from("tenants").delete().eq("shop_id", shop);
  if (tenantErr) errors.push(`tenants: ${tenantErr.message}`);

  if (errors.length > 0) {
    console.error(`[webhook] ${topic}: Partial redaction failures:`, errors.join("; "));
  }

  return new Response(JSON.stringify({ message: "Shop data redacted" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};
