import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import type { PlanTier } from "../lib/types";
import { PLAN_ORDER } from "../lib/types";

/**
 * Resolve a Shopify subscription name to a PlanTier.
 * Tries DB plan_configs first (supports admin-renamed plans),
 * then falls back to matching against known tier names.
 * Never hardcodes plan names — always dynamic.
 */
async function resolveSubscriptionPlan(subscriptionName: string): Promise<PlanTier> {
  // Strip the "AutoSync " prefix to get the plan display name
  const displayName = subscriptionName.replace(/^AutoSync\s+/i, "").trim();

  // 1. Try DB lookup — matches admin-customized plan names
  const { data: configs } = await db
    .from("plan_configurations")
    .select("tier, name")
    .order("tier");

  if (configs?.length) {
    for (const cfg of configs) {
      if (cfg.name.toLowerCase() === displayName.toLowerCase()) {
        return cfg.tier as PlanTier;
      }
    }
  }

  // 2. Fallback — match against known tier names (case-insensitive)
  const tierMatch = PLAN_ORDER.find(
    (tier) => tier.toLowerCase() === displayName.toLowerCase()
  );
  if (tierMatch) return tierMatch;

  // 3. Last resort — unknown plan name, log warning and default to free
  console.warn(`[webhook] Unknown subscription name: "${subscriptionName}" — defaulting to free`);
  return "free";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[webhook] ${topic}`);

  const subscription = payload?.app_subscription;
  if (!subscription) return new Response("OK", { status: 200 });

  const status = subscription.status as string;
  const name = subscription.name as string;
  const plan = await resolveSubscriptionPlan(name);

  await db
    .from("tenants")
    .update({
      plan: status === "active" ? plan : "free",
      plan_status: status,
    })
    .eq("shop_id", shop);

  console.log(`[webhook] plan update → ${plan} (${status}) for ${shop}`);

  return new Response("OK", { status: 200 });
};
