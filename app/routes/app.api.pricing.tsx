import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import { assertFeature, BillingGateError } from "../lib/billing.server";
import {
  getAllPricingRules,
  createPricingRule,
  updatePricingRule,
  deletePricingRule,
  previewPriceChanges,
  applyPricingRules,
  getPriceHistory,
  getPriceAlerts,
  resolveAlert,
  getPricingStats,
} from "../lib/pipeline/pricing.server";

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  try {
    await assertFeature(shopId, "pricingEngine");
  } catch (err) {
    if (err instanceof BillingGateError) {
      return data(
        {
          error: err.message,
          requiredPlan: err.requiredPlan,
          currentPlan: err.currentPlan,
        },
        { status: 403 },
      );
    }
    throw err;
  }

  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  switch (action) {
    case "rules": {
      const rules = await getAllPricingRules(shopId);
      return data({ rules });
    }
    case "preview": {
      const preview = await previewPriceChanges(shopId);
      return data({ preview });
    }
    case "history": {
      const history = await getPriceHistory(shopId);
      return data({ history });
    }
    case "alerts": {
      const alerts = await getPriceAlerts(shopId);
      return data({ alerts });
    }
    case "stats": {
      const stats = await getPricingStats(shopId);
      return data({ stats });
    }
    default: {
      const [rules, stats, alerts] = await Promise.all([
        getAllPricingRules(shopId),
        getPricingStats(shopId),
        getPriceAlerts(shopId),
      ]);
      return data({ rules, stats, alerts });
    }
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  await assertFeature(shopId, "pricingEngine");

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  switch (intent) {
    case "create_rule": {
      const rule = {
        name: formData.get("name") as string,
        priority: parseInt(formData.get("priority") as string) || 0,
        rule_type: formData.get("rule_type") as "markup" | "margin" | "fixed" | "map",
        scope_type: formData.get("scope_type") as "global" | "vendor" | "product_type" | "provider" | "tag" | "sku_prefix",
        scope_value: (formData.get("scope_value") as string) || null,
        value: parseFloat(formData.get("value") as string) || 0,
        round_to: formData.get("round_to") ? parseFloat(formData.get("round_to") as string) : 0.99,
        min_price: formData.get("min_price") ? parseFloat(formData.get("min_price") as string) : null,
        max_price: formData.get("max_price") ? parseFloat(formData.get("max_price") as string) : null,
        apply_to_compare_at: formData.get("apply_to_compare_at") === "true",
        compare_at_markup: formData.get("compare_at_markup") ? parseFloat(formData.get("compare_at_markup") as string) : null,
        is_active: formData.get("is_active") !== "false",
      };

      const created = await createPricingRule(shopId, rule);
      return data({ success: true, rule: created });
    }

    case "update_rule": {
      const ruleId = formData.get("rule_id") as string;
      const updates: Record<string, unknown> = {};

      for (const [key, value] of formData.entries()) {
        if (key === "intent" || key === "rule_id") continue;
        if (key === "is_active") {
          updates[key] = value === "true";
        } else if (key === "apply_to_compare_at") {
          updates[key] = value === "true";
        } else if (["priority", "value", "round_to", "min_price", "max_price", "compare_at_markup"].includes(key)) {
          updates[key] = value ? parseFloat(value as string) : null;
        } else {
          updates[key] = value || null;
        }
      }

      const updated = await updatePricingRule(shopId, ruleId, updates);
      return data({ success: true, rule: updated });
    }

    case "delete_rule": {
      const ruleId = formData.get("rule_id") as string;
      await deletePricingRule(shopId, ruleId);
      return data({ success: true });
    }

    case "apply_rules": {
      const result = await applyPricingRules(shopId);
      return data({ success: true, result });
    }

    case "resolve_alert": {
      const alertId = formData.get("alert_id") as string;
      await resolveAlert(shopId, alertId);
      return data({ success: true });
    }

    default:
      return data({ error: "Unknown intent" }, { status: 400 });
  }
}
