import type { ReactNode } from "react";
import { BlockStack, InlineStack, Text, Button, Icon, Badge } from "@shopify/polaris";
import { LockIcon, CheckCircleIcon, StarFilledIcon } from "@shopify/polaris-icons";
import type { PlanTier, PlanLimits } from "../lib/types";
import {
  planGateContainerStyle,
  planGateIconContainerStyle,
  planGateBenefitStyle,
  planGateBenefitDotStyle,
  PLAN_PRICING,
  PLAN_HIGHLIGHTS,
} from "../lib/design";

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
  pricingEngine: "Competitive Pricing Engine",
  vehiclePages: "Vehicle Pages",
};

// ---------------------------------------------------------------------------
// Plan tier order
// ---------------------------------------------------------------------------

const PLAN_ORDER: PlanTier[] = [
  "free",
  "starter",
  "growth",
  "professional",
  "business",
  "enterprise",
];

// Badge tones for each tier
const PLAN_BADGE_TONES: Record<PlanTier, "info" | "success" | "warning" | "critical" | undefined> = {
  free: undefined,
  starter: "info",
  growth: "info",
  professional: "success",
  business: "warning",
  enterprise: "critical",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function isFeatureEnabled(
  feature: keyof PlanLimits["features"],
  limits: PlanLimits,
): boolean {
  const value = limits.features[feature];
  return value !== false && value !== "none";
}

// ---------------------------------------------------------------------------
// PlanGate component — unified upgrade prompt
// ---------------------------------------------------------------------------

interface PlanGateProps {
  feature: keyof PlanLimits["features"];
  currentPlan: PlanTier;
  limits: PlanLimits;
  children: ReactNode;
  fallback?: ReactNode;
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

  if (fallback !== undefined) {
    return <>{fallback}</>;
  }

  const featureLabel = FEATURE_NAMES[feature] ?? feature;
  const requiredPlan = allLimits ? findMinPlan(feature, allLimits) : "starter";
  const requiredPlanName = PLAN_NAMES[requiredPlan];
  const price = PLAN_PRICING[requiredPlan] ?? "";
  const highlights = PLAN_HIGHLIGHTS[requiredPlan] ?? [];
  const badgeTone = PLAN_BADGE_TONES[requiredPlan];

  return (
    <div style={planGateContainerStyle}>
      <BlockStack gap="400">
        {/* Header row: lock icon + feature name + required plan badge */}
        <InlineStack gap="300" blockAlign="center" wrap={false}>
          <div style={planGateIconContainerStyle}>
            <Icon source={LockIcon} tone="caution" />
          </div>
          <BlockStack gap="050">
            <InlineStack gap="200" blockAlign="center">
              <Text as="h3" variant="headingSm">
                {featureLabel}
              </Text>
              <Badge tone={badgeTone} size="small">
                {`${requiredPlanName}+`}
              </Badge>
            </InlineStack>
            <Text as="p" variant="bodySm" tone="subdued">
              {`Upgrade to the ${requiredPlanName} plan ${price ? `(${price}) ` : ""}to unlock this feature.`}
            </Text>
          </BlockStack>
        </InlineStack>

        {/* Benefits list */}
        {highlights.length > 0 && (
          <BlockStack gap="200">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={StarFilledIcon} tone="warning" />
              <Text as="span" variant="bodySm" fontWeight="semibold">
                {`What you get with ${requiredPlanName}`}
              </Text>
            </InlineStack>
            <div style={{ paddingLeft: "4px" }}>
              <BlockStack gap="150">
                {highlights.map((benefit) => (
                  <div key={benefit} style={planGateBenefitStyle}>
                    <div style={planGateBenefitDotStyle} />
                    <span>{benefit}</span>
                  </div>
                ))}
              </BlockStack>
            </div>
          </BlockStack>
        )}

        {/* CTA button */}
        <div>
          <Button variant="primary" url="/app/plans" icon={CheckCircleIcon}>
            {`View ${requiredPlanName} Plan`}
          </Button>
        </div>
      </BlockStack>
    </div>
  );
}
