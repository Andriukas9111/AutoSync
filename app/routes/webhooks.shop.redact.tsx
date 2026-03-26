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

  // Explicit deletes for tables that might lack FK CASCADE
  const explicitTables = [
    "plate_lookups",
    "scrape_changelog",
    "admin_activity_log",
    "search_events",
    "conversion_events",
    "vehicle_page_sync",
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
