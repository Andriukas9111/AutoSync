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
