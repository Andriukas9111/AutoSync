import db from "./db.server";
import { PLAN_ORDER } from "./types";
import type { PlanTier, PlanLimits, PlanConfig, Tenant } from "./types";

// ---------------------------------------------------------------------------
// Plan tier order (used for upgrade path lookups)
// ---------------------------------------------------------------------------
// Re-export from types.ts so client code can import without .server dependency
export { PLAN_ORDER } from "./types";
export type { PlanConfig } from "./types";

// ---------------------------------------------------------------------------
// Module-level cache for DB-backed plan configurations
// ---------------------------------------------------------------------------
interface PlanConfigCache {
  configs: Record<PlanTier, PlanConfig>;
  limits: Record<PlanTier, PlanLimits>;
  loadedAt: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let _planConfigCache: PlanConfigCache | null = null;

/** Check if the cache is still fresh */
function isCacheFresh(): boolean {
  return !!_planConfigCache && (Date.now() - _planConfigCache.loadedAt) < CACHE_TTL_MS;
}

/** Force-invalidate the cache (called after admin saves) */
export function invalidatePlanConfigCache(): void {
  _planConfigCache = null;
}

// ---------------------------------------------------------------------------
// Plan limits — hardcoded defaults (fallback if DB is unavailable)
// ---------------------------------------------------------------------------
const DEFAULT_PLAN_LIMITS: Record<PlanTier, PlanLimits> = {
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
      apiIntegration: false,
      ftpImport: false,
      ymmeWidget: false,
      fitmentBadge: false,
      compatibilityTable: false,
      myGarage: false,
      wheelFinder: false,
      plateLookup: false,
      vinDecode: false,
      pricingEngine: false,
      vehiclePages: false,
      widgetCustomisation: "none",
      dashboardAnalytics: "none",
    },
  },

  starter: {
    products: 500,
    fitments: 2_500,
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
      apiIntegration: false,
      ftpImport: false,
      ymmeWidget: true,
      fitmentBadge: true,
      compatibilityTable: false,
      myGarage: false,
      wheelFinder: false,
      plateLookup: false,
      vinDecode: false,
      pricingEngine: false,
      vehiclePages: false,
      widgetCustomisation: "basic",
      dashboardAnalytics: "basic",
    },
  },

  growth: {
    products: 5_000,
    fitments: 25_000,
    providers: 2,
    scheduledFetchesPerDay: 1,
    activeMakes: 30,
    features: {
      pushTags: true,
      pushMetafields: true,
      autoExtraction: true,
      bulkOperations: true,
      smartCollections: "make",
      collectionSeoImages: false,
      apiIntegration: false,
      ftpImport: false,
      ymmeWidget: true,
      fitmentBadge: true,
      compatibilityTable: true,
      myGarage: false,
      wheelFinder: false,
      plateLookup: false,
      vinDecode: false,
      pricingEngine: false,
      vehiclePages: false,
      widgetCustomisation: "full",
      dashboardAnalytics: "full",
    },
  },

  professional: {
    products: 25_000,
    fitments: 100_000,
    providers: 3,
    scheduledFetchesPerDay: 2,
    activeMakes: 999_999,
    features: {
      pushTags: true,
      pushMetafields: true,
      autoExtraction: true,
      bulkOperations: true,
      smartCollections: "make_model",
      collectionSeoImages: false,
      apiIntegration: true,
      ftpImport: true,
      ymmeWidget: true,
      fitmentBadge: true,
      compatibilityTable: true,
      myGarage: false,
      wheelFinder: true,
      plateLookup: false,
      vinDecode: false,
      pricingEngine: false,
      vehiclePages: true,
      widgetCustomisation: "full",
      dashboardAnalytics: "full",
    },
  },

  business: {
    products: 100_000,
    fitments: 500_000,
    providers: 4,
    scheduledFetchesPerDay: 4,
    activeMakes: 999_999,
    features: {
      pushTags: true,
      pushMetafields: true,
      autoExtraction: true,
      bulkOperations: true,
      smartCollections: "full",
      collectionSeoImages: true,
      apiIntegration: true,
      ftpImport: true,
      ymmeWidget: true,
      fitmentBadge: true,
      compatibilityTable: true,
      myGarage: true,
      wheelFinder: true,
      plateLookup: false,
      vinDecode: false,
      pricingEngine: true,
      vehiclePages: true,
      widgetCustomisation: "full",
      dashboardAnalytics: "full_export",
    },
  },

  enterprise: {
    products: 500_000,
    fitments: 2_000_000,
    providers: 5,
    scheduledFetchesPerDay: 12,
    activeMakes: 999_999,
    features: {
      pushTags: true,
      pushMetafields: true,
      autoExtraction: true,
      bulkOperations: true,
      smartCollections: "full",
      collectionSeoImages: true,
      apiIntegration: true,
      ftpImport: true,
      ymmeWidget: true,
      fitmentBadge: true,
      compatibilityTable: true,
      myGarage: true,
      wheelFinder: true,
      plateLookup: true,
      vinDecode: true,
      pricingEngine: true,
      vehiclePages: true,
      widgetCustomisation: "full_css",
      dashboardAnalytics: "full_export",
    },
  },

  custom: {
    products: 25_000,
    fitments: 100_000,
    providers: 5,
    scheduledFetchesPerDay: 2,
    activeMakes: 999_999,
    features: {
      pushTags: true,
      pushMetafields: true,
      autoExtraction: true,
      bulkOperations: true,
      smartCollections: "full",
      collectionSeoImages: true,
      apiIntegration: true,
      ftpImport: true,
      ymmeWidget: true,
      fitmentBadge: true,
      compatibilityTable: true,
      myGarage: true,
      wheelFinder: true,
      plateLookup: true,
      vinDecode: true,
      pricingEngine: true,
      vehiclePages: true,
      widgetCustomisation: "full_css",
      dashboardAnalytics: "full_export",
    },
  },
};

// ---------------------------------------------------------------------------
// Default plan configs (used for seeding DB + as fallback)
// ---------------------------------------------------------------------------
const DEFAULT_PLAN_CONFIGS: Record<PlanTier, Omit<PlanConfig, "limits">> = {
  free: { tier: "free", name: "Free", priceMonthly: 0, badge: null, description: "Explore the platform with basic manual mapping", isActive: true },
  starter: { tier: "starter", name: "Starter", priceMonthly: 19, badge: null, description: "Activate your store with fitment data and widgets", isActive: true },
  growth: { tier: "growth", name: "Growth", priceMonthly: 49, badge: "MOST POPULAR", description: "Automate fitment extraction and collections", isActive: true },
  professional: { tier: "professional", name: "Professional", priceMonthly: 99, badge: null, description: "Integrate with external data providers and APIs", isActive: true },
  business: { tier: "business", name: "Business", priceMonthly: 179, badge: "BEST VALUE", description: "Convert visitors with advanced features and analytics", isActive: true },
  enterprise: { tier: "enterprise", name: "Enterprise", priceMonthly: 299, badge: null, description: "The complete automotive platform with every feature", isActive: true },
  custom: { tier: "custom", name: "Custom", priceMonthly: 299, badge: "FLEXIBLE", description: "Tailored plan with custom limits", isActive: true },
};

// ---------------------------------------------------------------------------
// Exported alias — reads from DB cache when available, hardcoded fallback
// ---------------------------------------------------------------------------
export const PLAN_LIMITS: Record<PlanTier, PlanLimits> = new Proxy(DEFAULT_PLAN_LIMITS, {
  get(target, prop: string) {
    if (_planConfigCache && prop in _planConfigCache.limits) {
      return _planConfigCache.limits[prop as PlanTier];
    }
    return target[prop as PlanTier];
  },
});

// ---------------------------------------------------------------------------
// DB-backed plan config loading
// ---------------------------------------------------------------------------

/** Convert a DB row to a PlanConfig object */
function dbRowToPlanConfig(row: Record<string, unknown>): PlanConfig {
  const tier = row.tier as PlanTier;
  const features = (row.features || {}) as PlanLimits["features"];
  return {
    tier,
    name: row.name as string,
    priceMonthly: Number(row.price_monthly),
    badge: (row.badge as string) || null,
    description: (row.description as string) || null,
    isActive: row.is_active !== false,
    limits: {
      products: row.products_limit === 999999999 ? Infinity : Number(row.products_limit),
      fitments: row.fitments_limit === 999999999 ? Infinity : Number(row.fitments_limit),
      providers: row.providers_limit === 999999999 ? Infinity : Number(row.providers_limit),
      scheduledFetchesPerDay: row.scheduled_fetches_per_day === 999999999 ? Infinity : Number(row.scheduled_fetches_per_day),
      activeMakes: Number(row.active_makes),
      features,
    },
  };
}

/**
 * Load plan configurations from DB into the module-level cache.
 * Called by app.tsx parent loader so the cache is warm before child loaders run.
 * Returns the full configs record for components that need pricing/badge info.
 */
export async function loadPlanConfigsFromDB(): Promise<Record<PlanTier, PlanConfig>> {
  // Return cached if fresh
  if (isCacheFresh() && _planConfigCache) {
    return _planConfigCache.configs;
  }

  try {
    const { data, error } = await db
      .from("plan_configurations")
      .select("*")
      .order("sort_order", { ascending: true });

    if (error || !data || data.length === 0) {
      // DB table doesn't exist yet or is empty — return defaults
      return buildDefaultConfigs();
    }

    const configs = {} as Record<PlanTier, PlanConfig>;
    const limits = {} as Record<PlanTier, PlanLimits>;

    for (const row of data) {
      const config = dbRowToPlanConfig(row);
      configs[config.tier] = config;
      limits[config.tier] = config.limits;
    }

    // Ensure all tiers are present (fill gaps with defaults)
    for (const tier of PLAN_ORDER) {
      if (!configs[tier]) {
        const defaultConfig = buildDefaultConfigs()[tier];
        configs[tier] = defaultConfig;
        limits[tier] = defaultConfig.limits;
      }
    }

    _planConfigCache = { configs, limits, loadedAt: Date.now() };
    return configs;
  } catch {
    // On any error, return defaults without caching
    return buildDefaultConfigs();
  }
}

/** Build default PlanConfig records from hardcoded data */
function buildDefaultConfigs(): Record<PlanTier, PlanConfig> {
  const configs = {} as Record<PlanTier, PlanConfig>;
  for (const tier of PLAN_ORDER) {
    configs[tier] = {
      ...DEFAULT_PLAN_CONFIGS[tier],
      limits: DEFAULT_PLAN_LIMITS[tier],
    };
  }
  return configs;
}

/**
 * Get all plan configs (with pricing, badges, descriptions).
 * Uses cache when available, loads from DB if stale.
 */
export async function getPlanConfigs(): Promise<Record<PlanTier, PlanConfig>> {
  return loadPlanConfigsFromDB();
}

/**
 * Save a single plan configuration to the DB.
 * Called from the admin panel. Invalidates cache after save.
 */
export async function savePlanConfig(config: PlanConfig): Promise<void> {
  const { error } = await db
    .from("plan_configurations")
    .upsert({
      tier: config.tier,
      name: config.name,
      price_monthly: config.priceMonthly,
      products_limit: config.limits.products === Infinity ? 999999999 : config.limits.products,
      fitments_limit: config.limits.fitments === Infinity ? 999999999 : config.limits.fitments,
      providers_limit: config.limits.providers === Infinity ? 999999999 : config.limits.providers,
      scheduled_fetches_per_day: config.limits.scheduledFetchesPerDay === Infinity ? 999999999 : config.limits.scheduledFetchesPerDay,
      active_makes: config.limits.activeMakes,
      features: config.limits.features,
      badge: config.badge,
      description: config.description,
      is_active: config.isActive,
      updated_at: new Date().toISOString(),
    }, { onConflict: "tier" });

  if (error) {
    throw new Error(`Failed to save plan config for ${config.tier}: ${error.message}`);
  }

  invalidatePlanConfigCache();
}

/**
 * Save all plan configurations at once (bulk admin save).
 */
export async function saveAllPlanConfigs(configs: PlanConfig[]): Promise<void> {
  const rows = configs.map((c) => ({
    tier: c.tier,
    name: c.name,
    price_monthly: c.priceMonthly,
    products_limit: c.limits.products === Infinity ? 999999999 : c.limits.products,
    fitments_limit: c.limits.fitments === Infinity ? 999999999 : c.limits.fitments,
    providers_limit: c.limits.providers === Infinity ? 999999999 : c.limits.providers,
    scheduled_fetches_per_day: c.limits.scheduledFetchesPerDay === Infinity ? 999999999 : c.limits.scheduledFetchesPerDay,
    active_makes: c.limits.activeMakes,
    features: c.limits.features,
    badge: c.badge,
    description: c.description,
    is_active: c.isActive,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await db
    .from("plan_configurations")
    .upsert(rows, { onConflict: "tier" });

  if (error) {
    throw new Error(`Failed to save plan configs: ${error.message}`);
  }

  invalidatePlanConfigCache();
}

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

/** Convert Infinity values to a large integer safe for JSON serialization. */
export function serializeLimits(limits: PlanLimits): PlanLimits & Record<string, unknown> {
  return {
    ...limits,
    products: limits.products === Infinity ? 999_999_999 : limits.products,
    fitments: limits.fitments === Infinity ? 999_999_999 : limits.fitments,
    providers: limits.providers === Infinity ? 999_999_999 : limits.providers,
    scheduledFetchesPerDay: limits.scheduledFetchesPerDay === Infinity ? 999_999_999 : limits.scheduledFetchesPerDay,
    activeMakes: limits.activeMakes === Infinity ? 999_999_999 : limits.activeMakes,
  };
}

/** Return all plan limits serialized (Infinity → 999_999_999) for use in loaders. */
export function getSerializedPlanLimits(): Record<PlanTier, PlanLimits> {
  const result = {} as Record<PlanTier, PlanLimits>;
  for (const tier of PLAN_ORDER) {
    result[tier] = serializeLimits(getPlanLimits(tier));
  }
  return result;
}

/** Return the full limits object for a given plan tier (cache-aware). */
export function getPlanLimits(plan: PlanTier): PlanLimits {
  if (_planConfigCache?.limits[plan]) {
    return _planConfigCache.limits[plan];
  }
  return DEFAULT_PLAN_LIMITS[plan];
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

/**
 * Get the effective plan tier for a tenant.
 * If plan_status is "cancelled", the effective plan is "free" —
 * the tenant keeps their data but loses paid features.
 */
export function getEffectivePlan(tenant: Tenant | null): PlanTier {
  if (!tenant) return "free";
  // Cancelled subscription → free tier (data preserved, features locked)
  if (tenant.plan_status === "cancelled" && tenant.plan !== "free") {
    return "free";
  }
  return tenant.plan ?? "free";
}

/** Throw if the tenant has reached their product limit. */
export async function assertProductLimit(shopId: string): Promise<void> {
  const tenant = await getTenant(shopId);
  if (!tenant) throw new Error(`Tenant not found: ${shopId}`);

  const limits = getPlanLimits(getEffectivePlan(tenant));

  // Use REAL count from products table, not cached tenant.product_count
  // (cached counter can drift after deletes)
  const { count } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);

  if ((count ?? 0) >= limits.products) {
    const next = getNextPlan(tenant.plan);
    throw new BillingGateError("products", tenant.plan, next);
  }
}

/** Throw if the tenant has exceeded their plan's fitment limit. */
export async function assertFitmentLimit(shopId: string): Promise<void> {
  const tenant = await getTenant(shopId);
  if (!tenant) throw new Error(`Tenant not found: ${shopId}`);
  const limits = getPlanLimits(getEffectivePlan(tenant));

  // Use REAL count from vehicle_fitments table, not cached tenant.fitment_count
  const { count } = await db
    .from("vehicle_fitments")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);

  if ((count ?? 0) >= limits.fitments) {
    const next = getNextPlan(tenant.plan);
    throw new BillingGateError("fitments", tenant.plan, next);
  }
}

/** Throw if the tenant has exceeded their plan's provider limit. */
export async function assertProviderLimit(shopId: string): Promise<void> {
  const tenant = await getTenant(shopId);
  if (!tenant) throw new Error(`Tenant not found: ${shopId}`);
  const limits = getPlanLimits(getEffectivePlan(tenant));
  const { count } = await db.from("providers").select("id", { count: "exact", head: true }).eq("shop_id", shopId);
  if ((count ?? 0) >= limits.providers) {
    const next = getNextPlan(tenant.plan);
    throw new BillingGateError("providers", tenant.plan, next);
  }
}

/** Throw if a boolean/enum feature is not available on the tenant's plan. */
export async function assertFeature(
  shopId: string,
  feature: keyof PlanLimits["features"],
): Promise<void> {
  const tenant = await getTenant(shopId);
  if (!tenant) throw new Error(`Tenant not found: ${shopId}`);

  const effectivePlan = getEffectivePlan(tenant);
  const limits = getPlanLimits(effectivePlan);
  const value = limits.features[feature];

  // A feature is considered disabled when it is exactly `false` or `"none"`.
  if (value === false || value === "none") {
    const requiredPlan = getMinimumPlanForFeature(feature);
    throw new BillingGateError(feature, effectivePlan, requiredPlan);
  }
}

/** Return the next tier up, or "enterprise" if already at the top. */
export function getNextPlan(plan: PlanTier): PlanTier {
  const idx = PLAN_ORDER.indexOf(plan);
  if (idx === -1 || idx >= PLAN_ORDER.length - 1) return "enterprise";
  return PLAN_ORDER[idx + 1];
}

/** Find the cheapest plan that unlocks a given feature (cache-aware). */
export function getMinimumPlanForFeature(
  feature: keyof PlanLimits["features"],
): PlanTier {
  for (const plan of PLAN_ORDER) {
    const limits = getPlanLimits(plan);
    const value = limits.features[feature];
    if (value !== false && value !== "none") return plan;
  }
  return "enterprise";
}

// ---------------------------------------------------------------------------
// Shopify Billing API — create & manage recurring app subscriptions
// ---------------------------------------------------------------------------

/** Get the monthly price for a tier (cache-aware, falls back to defaults) */
function getPlanPrice(tier: PlanTier): number {
  if (_planConfigCache?.configs[tier]) {
    return _planConfigCache.configs[tier].priceMonthly;
  }
  return DEFAULT_PLAN_CONFIGS[tier].priceMonthly;
}

/** Get a human-readable price label for a tier (e.g., "$49/mo", "From $299/mo") */
export function getPlanPriceLabel(tier: PlanTier): string {
  const price = getPlanPrice(tier);
  if (price === 0) return "Free";
  if (tier === "custom") return `From $${price}/mo`;
  return `$${price}/mo`;
}

/** Get the display name for a tier (cache-aware) */
function getPlanName(tier: PlanTier): string {
  if (_planConfigCache?.configs[tier]) {
    return _planConfigCache.configs[tier].name;
  }
  return DEFAULT_PLAN_CONFIGS[tier].name;
}

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

  // Determine if this is a downgrade (lower plan → defer to end of cycle)
  const tenant = await getTenant(shopId);

  // Use custom price if admin set one for this tenant, otherwise standard plan price
  const price = (tenant as Record<string, unknown>)?.custom_price != null
    ? Number((tenant as Record<string, unknown>).custom_price)
    : getPlanPrice(newPlan);
  const name = `AutoSync ${getPlanName(newPlan)}`;
  const currentPlanIndex = PLAN_ORDER.indexOf(tenant?.plan ?? "free");
  const newPlanIndex = PLAN_ORDER.indexOf(newPlan);
  const isDowngrade = newPlanIndex < currentPlanIndex;
  // Upgrades apply immediately; downgrades defer to end of billing cycle
  const replacementBehavior = isDowngrade ? "APPLY_ON_NEXT_BILLING_CYCLE" : "APPLY_IMMEDIATELY";

  const response = await admin.graphql(
    `#graphql
      mutation appSubscriptionCreate($name: String!, $returnUrl: URL!, $lineItems: [AppSubscriptionLineItemInput!]!, $test: Boolean, $replacementBehavior: AppSubscriptionReplacementBehavior, $trialDays: Int) {
        appSubscriptionCreate(
          name: $name
          returnUrl: $returnUrl
          lineItems: $lineItems
          test: $test
          replacementBehavior: $replacementBehavior
          trialDays: $trialDays
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
        replacementBehavior,
        // Billing test mode: explicit env var, fail-fast if accidentally set in production
        test: (() => {
          const testMode = process.env.BILLING_TEST_MODE === "true";
          if (process.env.NODE_ENV === "production" && testMode) {
            throw new Error("BILLING_TEST_MODE=true is set in production — real charges won't be created. Remove BILLING_TEST_MODE from production env vars.");
          }
          return testMode;
        })(),
        // 14-day free trial for new subscriptions (Shopify requires minimum 3 days)
        // Only on initial subscription, not on plan changes (upgrades/downgrades)
        trialDays: isDowngrade ? undefined : 14,
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
  admin: { graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response> },
): Promise<{ plan: PlanTier }> {
  // CRITICAL: Verify the charge with Shopify API before activating
  // Prevents billing fraud via replay attacks or forged charge_ids
  if (chargeId) {
    try {
      const response = await admin.graphql(`
        query appSubscription($id: ID!) {
          node(id: $id) {
            ... on AppSubscription {
              id
              status
              name
            }
          }
        }
      `, { variables: { id: chargeId } });
      const json = await response.json();
      const subscription = json?.data?.node;

      if (!subscription || subscription.status !== "ACTIVE") {
        throw new Error(`Subscription ${chargeId} is not active (status: ${subscription?.status ?? "not found"})`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("not active")) throw err;
      // Security: if we can't verify the charge, reject it — don't activate unverified plans
      throw new Error(`Failed to verify billing subscription: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Get the pending plan from the tenant record
  const { data: tenant } = await db
    .from("tenants")
    .select("pending_plan")
    .eq("shop_id", shopId)
    .maybeSingle();

  const newPlan = (tenant?.pending_plan as PlanTier) || "free";

  if (newPlan === "free") {
    // No pending plan — don't activate anything
    return { plan: "free" };
  }

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

// ---------------------------------------------------------------------------
// Re-export custom plan helpers (client-safe types + pricing calculator)
// ---------------------------------------------------------------------------
export {
  CUSTOM_PLAN_TIERS,
  CUSTOM_PLAN_BASE_PRICE,
  calculateCustomPrice,
} from "./custom-plan";
export type { CustomPlanTier, CustomPlanConfig } from "./custom-plan";
