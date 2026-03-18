import db from "./db.server";
import type { PlanTier, PlanLimits, Tenant } from "./types";

// ---------------------------------------------------------------------------
// Plan tier order (used for upgrade path lookups)
// ---------------------------------------------------------------------------
const PLAN_ORDER: PlanTier[] = [
  "free",
  "starter",
  "growth",
  "professional",
  "business",
  "enterprise",
];

// ---------------------------------------------------------------------------
// Plan limits — fully defined for every tier
// ---------------------------------------------------------------------------
export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
  free: {
    products: 50,
    fitments: 200,
    providers: 0,
    scheduledFetchesPerDay: 0,
    activeMakes: 0,
    features: {
      pushTags: false,
      pushMetafields: false,
      autoExtraction: false,
      bulkOperations: false,
      smartCollections: false,
      collectionSeoImages: false,
      customVehicles: false,
      apiIntegration: false,
      ftpImport: false,
      ymmeWidget: false,
      fitmentBadge: false,
      compatibilityTable: false,
      floatingBar: false,
      myGarage: false,
      wheelFinder: false,
      plateLookup: false,
      vinDecode: false,
      pricingEngine: false,
      widgetCustomisation: "none",
      dashboardAnalytics: "none",
      prioritySupport: false,
    },
  },

  starter: {
    products: 1_000,
    fitments: 5_000,
    providers: 1,
    scheduledFetchesPerDay: 0,
    activeMakes: 10,
    features: {
      pushTags: true,
      pushMetafields: true,
      autoExtraction: false,
      bulkOperations: false,
      smartCollections: false,
      collectionSeoImages: false,
      customVehicles: false,
      apiIntegration: false,
      ftpImport: false,
      ymmeWidget: true,
      fitmentBadge: true,
      compatibilityTable: false,
      floatingBar: false,
      myGarage: false,
      wheelFinder: false,
      plateLookup: false,
      vinDecode: false,
      pricingEngine: false,
      widgetCustomisation: "basic",
      dashboardAnalytics: "basic",
      prioritySupport: false,
    },
  },

  growth: {
    products: 10_000,
    fitments: 50_000,
    providers: 3,
    scheduledFetchesPerDay: 1,
    activeMakes: 30,
    features: {
      pushTags: true,
      pushMetafields: true,
      autoExtraction: true,
      bulkOperations: true,
      smartCollections: "make",
      collectionSeoImages: false,
      customVehicles: false,
      apiIntegration: false,
      ftpImport: false,
      ymmeWidget: true,
      fitmentBadge: true,
      compatibilityTable: true,
      floatingBar: true,
      myGarage: false,
      wheelFinder: false,
      plateLookup: false,
      vinDecode: false,
      pricingEngine: false,
      widgetCustomisation: "full",
      dashboardAnalytics: "full",
      prioritySupport: false,
    },
  },

  professional: {
    products: 50_000,
    fitments: 250_000,
    providers: 5,
    scheduledFetchesPerDay: 2,
    activeMakes: 999_999,
    features: {
      pushTags: true,
      pushMetafields: true,
      autoExtraction: true,
      bulkOperations: true,
      smartCollections: "make_model",
      collectionSeoImages: true,
      customVehicles: true,
      apiIntegration: true,
      ftpImport: false,
      ymmeWidget: true,
      fitmentBadge: true,
      compatibilityTable: true,
      floatingBar: true,
      myGarage: true,
      wheelFinder: false,
      plateLookup: false,
      vinDecode: false,
      pricingEngine: true,
      widgetCustomisation: "full",
      dashboardAnalytics: "full",
      prioritySupport: false,
    },
  },

  business: {
    products: 200_000,
    fitments: 1_000_000,
    providers: 15,
    scheduledFetchesPerDay: 6,
    activeMakes: 999_999,
    features: {
      pushTags: true,
      pushMetafields: true,
      autoExtraction: true,
      bulkOperations: true,
      smartCollections: "full",
      collectionSeoImages: true,
      customVehicles: true,
      apiIntegration: true,
      ftpImport: true,
      ymmeWidget: true,
      fitmentBadge: true,
      compatibilityTable: true,
      floatingBar: true,
      myGarage: true,
      wheelFinder: true,
      plateLookup: false,
      vinDecode: false,
      pricingEngine: true,
      widgetCustomisation: "full",
      dashboardAnalytics: "full_export",
      prioritySupport: true,
    },
  },

  enterprise: {
    products: Infinity,
    fitments: Infinity,
    providers: Infinity,
    scheduledFetchesPerDay: Infinity,
    activeMakes: 999_999,
    features: {
      pushTags: true,
      pushMetafields: true,
      autoExtraction: true,
      bulkOperations: true,
      smartCollections: "full",
      collectionSeoImages: true,
      customVehicles: true,
      apiIntegration: true,
      ftpImport: true,
      ymmeWidget: true,
      fitmentBadge: true,
      compatibilityTable: true,
      floatingBar: true,
      myGarage: true,
      wheelFinder: true,
      plateLookup: true,
      vinDecode: true,
      pricingEngine: true,
      widgetCustomisation: "full_css",
      dashboardAnalytics: "full_export",
      prioritySupport: true,
    },
  },
};

// ---------------------------------------------------------------------------
// BillingGateError — thrown when a tenant exceeds their plan
// ---------------------------------------------------------------------------
export class BillingGateError extends Error {
  public readonly feature: string;
  public readonly currentPlan: PlanTier;
  public readonly requiredPlan: PlanTier;

  constructor(feature: string, currentPlan: PlanTier, requiredPlan: PlanTier) {
    super(
      `Feature "${feature}" requires the ${requiredPlan} plan (current: ${currentPlan}). ` +
        `Please upgrade to continue.`,
    );
    this.name = "BillingGateError";
    this.feature = feature;
    this.currentPlan = currentPlan;
    this.requiredPlan = requiredPlan;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the full limits object for a given plan tier. */
export function getPlanLimits(plan: PlanTier): PlanLimits {
  return PLAN_LIMITS[plan];
}

/** Fetch a tenant row from Supabase by shop_id. */
export async function getTenant(shopId: string): Promise<Tenant | null> {
  const { data, error } = await db
    .from("tenants")
    .select("*")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (error || !data) return null;
  return data as Tenant;
}

/** Throw if the tenant has reached their product limit. */
export async function assertProductLimit(shopId: string): Promise<void> {
  const tenant = await getTenant(shopId);
  if (!tenant) throw new Error(`Tenant not found: ${shopId}`);

  const limits = getPlanLimits(tenant.plan);

  if (tenant.product_count >= limits.products) {
    const next = getNextPlan(tenant.plan);
    throw new BillingGateError("products", tenant.plan, next);
  }
}

/** Throw if a boolean/enum feature is not available on the tenant's plan. */
export async function assertFeature(
  shopId: string,
  feature: keyof PlanLimits["features"],
): Promise<void> {
  const tenant = await getTenant(shopId);
  if (!tenant) throw new Error(`Tenant not found: ${shopId}`);

  const limits = getPlanLimits(tenant.plan);
  const value = limits.features[feature];

  // A feature is considered disabled when it is exactly `false` or `"none"`.
  if (value === false || value === "none") {
    const requiredPlan = getMinimumPlanForFeature(feature);
    throw new BillingGateError(feature, tenant.plan, requiredPlan);
  }
}

/** Return the next tier up, or "enterprise" if already at the top. */
export function getNextPlan(plan: PlanTier): PlanTier {
  const idx = PLAN_ORDER.indexOf(plan);
  if (idx === -1 || idx >= PLAN_ORDER.length - 1) return "enterprise";
  return PLAN_ORDER[idx + 1];
}

/** Find the cheapest plan that unlocks a given feature. */
export function getMinimumPlanForFeature(
  feature: keyof PlanLimits["features"],
): PlanTier {
  for (const plan of PLAN_ORDER) {
    const value = PLAN_LIMITS[plan].features[feature];
    if (value !== false && value !== "none") return plan;
  }
  return "enterprise";
}

// ---------------------------------------------------------------------------
// Shopify Billing API — create & manage recurring app subscriptions
// ---------------------------------------------------------------------------

/** Monthly prices for each paid tier (must match PLANS in app.plans.tsx) */
const PLAN_PRICES: Record<PlanTier, number> = {
  free: 0,
  starter: 19,
  growth: 49,
  professional: 99,
  business: 179,
  enterprise: 299,
};

const PLAN_NAMES: Record<PlanTier, string> = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  professional: "Professional",
  business: "Business",
  enterprise: "Enterprise",
};

/**
 * Create a Shopify AppSubscription for a plan change.
 * Returns the confirmationUrl where the merchant must approve the charge.
 * For the "free" plan, cancels any existing subscription instead.
 */
export async function createBillingSubscription(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  shopId: string,
  newPlan: PlanTier,
  returnUrl: string,
): Promise<{ confirmationUrl: string } | { cancelled: true }> {
  // Free plan: cancel existing subscription
  if (newPlan === "free") {
    await cancelBillingSubscription(admin, shopId);
    // Update tenant plan immediately for downgrades to free
    await db
      .from("tenants")
      .update({ plan: "free", plan_status: "active", updated_at: new Date().toISOString() })
      .eq("shop_id", shopId);
    return { cancelled: true };
  }

  const price = PLAN_PRICES[newPlan];
  const name = `AutoSync ${PLAN_NAMES[newPlan]}`;

  const response = await admin.graphql(
    `#graphql
      mutation appSubscriptionCreate($name: String!, $returnUrl: URL!, $lineItems: [AppSubscriptionLineItemInput!]!, $test: Boolean) {
        appSubscriptionCreate(
          name: $name
          returnUrl: $returnUrl
          lineItems: $lineItems
          test: $test
        ) {
          appSubscription {
            id
            status
          }
          confirmationUrl
          userErrors {
            field
            message
          }
        }
      }
    `,
    {
      variables: {
        name,
        returnUrl,
        test: true, // Always test mode in development — remove for production
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: price, currencyCode: "USD" },
                interval: "EVERY_30_DAYS",
              },
            },
          },
        ],
      },
    },
  );

  const json = await response.json();
  const result = json.data?.appSubscriptionCreate;

  if (result?.userErrors?.length > 0) {
    throw new Error(`Billing error: ${result.userErrors.map((e: { message: string }) => e.message).join(", ")}`);
  }

  if (!result?.confirmationUrl) {
    throw new Error("Failed to create billing subscription — no confirmation URL returned");
  }

  // Store the pending plan change so we can activate it on callback
  await db
    .from("tenants")
    .update({
      pending_plan: newPlan,
      billing_subscription_id: result.appSubscription?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("shop_id", shopId);

  return { confirmationUrl: result.confirmationUrl };
}

/**
 * Cancel the current Shopify subscription for a shop.
 */
async function cancelBillingSubscription(
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
  shopId: string,
): Promise<void> {
  // Get current subscription ID from tenant record
  const { data: tenant } = await db
    .from("tenants")
    .select("billing_subscription_id")
    .eq("shop_id", shopId)
    .maybeSingle();

  if (!tenant?.billing_subscription_id) return;

  await admin.graphql(
    `#graphql
      mutation appSubscriptionCancel($id: ID!) {
        appSubscriptionCancel(id: $id) {
          appSubscription { id status }
          userErrors { field message }
        }
      }
    `,
    { variables: { id: tenant.billing_subscription_id } },
  );

  // Clear the subscription ID
  await db
    .from("tenants")
    .update({
      billing_subscription_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("shop_id", shopId);
}

/**
 * Confirm a billing subscription after Shopify redirects back.
 * Called from the billing callback route.
 */
export async function confirmBillingSubscription(
  shopId: string,
  chargeId: string,
): Promise<{ plan: PlanTier }> {
  // Get the pending plan from the tenant record
  const { data: tenant } = await db
    .from("tenants")
    .select("pending_plan")
    .eq("shop_id", shopId)
    .maybeSingle();

  const newPlan = (tenant?.pending_plan as PlanTier) || "free";

  // Activate the plan
  await db
    .from("tenants")
    .update({
      plan: newPlan,
      plan_status: "active",
      pending_plan: null,
      billing_charge_id: chargeId,
      updated_at: new Date().toISOString(),
    })
    .eq("shop_id", shopId);

  return { plan: newPlan };
}

/** Increment the tenant's product_count via Supabase RPC. */
export async function incrementProductCount(
  shopId: string,
  count: number = 1,
): Promise<void> {
  const { error } = await db.rpc("increment_product_count", {
    p_shop_id: shopId,
    p_count: count,
  });

  if (error) {
    throw new Error(
      `Failed to increment product count for ${shopId}: ${error.message}`,
    );
  }
}

/** Increment the tenant's fitment_count via Supabase RPC. */
export async function incrementFitmentCount(
  shopId: string,
  count: number = 1,
): Promise<void> {
  const { error } = await db.rpc("increment_fitment_count", {
    p_shop_id: shopId,
    p_count: count,
  });

  if (error) {
    throw new Error(
      `Failed to increment fitment count for ${shopId}: ${error.message}`,
    );
  }
}
