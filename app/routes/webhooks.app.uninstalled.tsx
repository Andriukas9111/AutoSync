import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import db from "../lib/db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic}`);

  // Clean up Prisma sessions (Shopify session storage)
  if (session) {
    await prisma.session.deleteMany({ where: { shop } });
  }

  // Clean up vehicle page sync records from our DB
  // Note: Shopify Pages persist after uninstall but our pages include a JS
  // heartbeat check — if the app proxy is unreachable (app uninstalled),
  // the page content is replaced with a "reinstall AutoSync" message.
  // App-owned metaobjects ($app:vehicle_spec) are auto-deleted by Shopify.
  // App-owned metafields ($app:autosync.*) are auto-deleted by Shopify.
  try {
    await db.from("vehicle_page_sync").delete().eq("shop_id", shop);
  } catch (err) {
    console.error(`[webhook] Vehicle page sync cleanup failed for ${shop}:`, err);
  }

  // Cancel any active sync jobs (prevents Edge Function from making API calls with revoked token)
  try {
    await db
      .from("sync_jobs")
      .update({ status: "failed", error: "App uninstalled", completed_at: new Date().toISOString(), locked_at: null })
      .eq("shop_id", shop)
      .in("status", ["running", "pending"]);
  } catch (err) {
    console.error(`[webhook] Job cancellation failed for ${shop}:`, err);
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
