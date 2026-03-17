import type { ReactNode } from "react";
import type { PlanTier, PlanLimits } from "../lib/types";

// ---------------------------------------------------------------------------
// Display-name lookup maps
// ---------------------------------------------------------------------------

export const PLAN_NAMES: Record<PlanTier, string> = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  professional: "Professional",
  business: "Business",
  enterprise: "Enterprise",
};

export const FEATURE_NAMES: Record<keyof PlanLimits["features"], string> = {
  pushTags: "Push Tags to Shopify",
  pushMetafields: "Push Metafields to Shopify",
  autoExtraction: "Auto Fitment Extraction",
  bulkOperations: "Bulk Operations",
  smartCollections: "Smart Collections",
  collectionSeoImages: "Collection SEO Images",
  customVehicles: "Custom Vehicles",
  apiIntegration: "API Integration",
  ftpImport: "FTP Import",
  ymmeWidget: "YMME Search Widget",
  fitmentBadge: "Fitment Badge Widget",
  compatibilityTable: "Compatibility Table Widget",
  floatingBar: "Floating Vehicle Bar",
  myGarage: "My Garage",
  wheelFinder: "Wheel Finder",
  plateLookup: "Reg Plate Lookup (DVLA + MOT)",
  vinDecode: "VIN Decode",
  widgetCustomisation: "Widget Customisation",
  dashboardAnalytics: "Dashboard Analytics",
  prioritySupport: "Priority Support",
};

// ---------------------------------------------------------------------------
// Plan tier order (mirrors billing.server.ts but available on the client)
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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the minimum PlanTier that enables a given feature.
 * Requires the full PLAN_LIMITS-style record so this stays a pure function
 * without importing server-only modules.
 */
export function findMinPlan(
  feature: keyof PlanLimits["features"],
  allLimits: Record<PlanTier, PlanLimits>,
): PlanTier {
  for (const plan of PLAN_ORDER) {
    const value = allLimits[plan].features[feature];
    if (value !== false && value !== "none") return plan;
  }
  return "enterprise";
}

/**
 * Returns true when the feature is considered "enabled" for the given limits.
 * A feature is disabled when its value is exactly `false` or `"none"`.
 */
function isFeatureEnabled(
  feature: keyof PlanLimits["features"],
  limits: PlanLimits,
): boolean {
  const value = limits.features[feature];
  return value !== false && value !== "none";
}

// ---------------------------------------------------------------------------
// PlanGate component
// ---------------------------------------------------------------------------

interface PlanGateProps {
  /** The feature key to check (must be a key of PlanLimits.features). */
  feature: keyof PlanLimits["features"];
  /** The merchant's current plan tier. */
  currentPlan: PlanTier;
  /** The full PlanLimits object for the current plan. */
  limits: PlanLimits;
  /** Content to render when the feature is available. */
  children: ReactNode;
  /** Optional custom fallback when the feature is gated. */
  fallback?: ReactNode;
  /**
   * Optional: the full limits record for all plans.
   * When provided, the upgrade banner will name the specific plan required.
   * When omitted, the banner uses a generic "upgrade" message.
   */
  allLimits?: Record<PlanTier, PlanLimits>;
}

export function PlanGate({
  feature,
  currentPlan,
  limits,
  children,
  fallback,
  allLimits,
}: PlanGateProps) {
  if (isFeatureEnabled(feature, limits)) {
    return <>{children}</>;
  }

  // If a custom fallback is provided, render it instead of the default banner.
  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  const featureLabel = FEATURE_NAMES[feature] ?? feature;

  // Build the upgrade message.
  let upgradeMessage: string;
  if (allLimits) {
    const requiredPlan = findMinPlan(feature, allLimits);
    const requiredPlanName = PLAN_NAMES[requiredPlan];
    upgradeMessage = `"${featureLabel}" requires the ${requiredPlanName} plan or higher. You are currently on the ${PLAN_NAMES[currentPlan]} plan.`;
  } else {
    upgradeMessage = `"${featureLabel}" is not available on your current ${PLAN_NAMES[currentPlan]} plan. Please upgrade to access this feature.`;
  }

  return (
    <s-banner tone="warning">
      <s-stack direction="block" gap="base">
        <s-text>{upgradeMessage}</s-text>
        <s-button href="/app/plans" variant="primary">
          View Plans
        </s-button>
      </s-stack>
    </s-banner>
  );
}
