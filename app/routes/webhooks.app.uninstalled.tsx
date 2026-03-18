import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import db from "../lib/db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic}: ${shop}`);

  // Clean up Prisma sessions (Shopify session storage)
  if (session) {
    await prisma.session.deleteMany({ where: { shop } });
  }

  // ── Clean up vehicle pages from Shopify ────────────────────────────
  // When app is uninstalled, delete all vehicle spec pages created by our app.
  // We use the REST Admin API with the session's access token since
  // admin.graphql is not available in webhook context.
  try {
    const { data: syncRows } = await db
      .from("vehicle_page_sync")
      .select("page_gid")
      .eq("shop_id", shop)
      .not("page_gid", "is", null);

    if (syncRows && syncRows.length > 0 && session?.accessToken) {
      const shopDomain = shop.replace(".myshopify.com", "");
      for (const row of syncRows) {
        if (!row.page_gid) continue;
        // Extract numeric ID from GID (gid://shopify/Page/12345 -> 12345)
        const numericId = row.page_gid.split("/").pop();
        if (!numericId) continue;
        try {
          await fetch(
            `https://${shop}/admin/api/2024-10/pages/${numericId}.json`,
            {
              method: "DELETE",
              headers: {
                "X-Shopify-Access-Token": session.accessToken,
                "Content-Type": "application/json",
              },
            },
          );
        } catch {
          // Best effort — page might already be gone
        }
      }
    }

    // Clean up vehicle page sync records
    await db.from("vehicle_page_sync").delete().eq("shop_id", shop);
  } catch (err) {
    console.error(`[webhook] Vehicle page cleanup failed for ${shop}:`, err);
  }

  // Mark tenant as uninstalled in Supabase (preserve data — they might reinstall)
  await db
    .from("tenants")
    .update({
      uninstalled_at: new Date().toISOString(),
      plan_status: "cancelled",
    })
    .eq("shop_id", shop);

  return new Response("OK", { status: 200 });
};
