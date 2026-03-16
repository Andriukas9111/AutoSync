import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import type { PlanTier } from "../lib/types";

const CHARGE_NAME_TO_PLAN: Record<string, PlanTier> = {
  "AutoSync Starter": "starter",
  "AutoSync Growth": "growth",
  "AutoSync Professional": "professional",
  "AutoSync Business": "business",
  "AutoSync Enterprise": "enterprise",
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic}: ${shop}`);

  const subscription = payload?.app_subscription;
  if (!subscription) return new Response("OK", { status: 200 });

  const status = subscription.status as string;
  const name = subscription.name as string;
  const plan = CHARGE_NAME_TO_PLAN[name] ?? "free";

  await db
    .from("tenants")
    .update({
      plan: status === "active" ? plan : "free",
      plan_status: status,
    })
    .eq("shop_id", shop);

  console.log(`[webhook] Tenant ${shop} plan → ${plan} (${status})`);

  return new Response("OK", { status: 200 });
};
