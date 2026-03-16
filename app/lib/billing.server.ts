import { db } from "./db.server";
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
    .single();

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
