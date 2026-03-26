import type { ReactNode } from "react";
import {
  InlineStack,
  Text,
  Button,
  Badge,
  Box,
} from "@shopify/polaris";
import { useNavigate } from "react-router";
import type { PlanTier, PlanLimits } from "../lib/types";
import { PLAN_PRICING } from "../lib/design";

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
// PlanGate — small inline indicator, NOT a full banner
//
// When a feature is locked, renders a single subtle line:
//   🔒 Feature Name  [Starter+]  Requires Starter ($19/mo)  [Upgrade →]
//
// This keeps the layout clean even when multiple gates appear on one page.
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
  const navigate = useNavigate();

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

  return (
    <Box
      paddingBlock="300"
      paddingInline="400"
      background="bg-surface-secondary"
      borderRadius="200"
    >
      <InlineStack align="space-between" blockAlign="center" wrap={false}>
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          <Text as="span" variant="bodySm" tone="subdued">
            {featureLabel}
          </Text>
          <Badge size="small">
            {`${requiredPlanName}+`}
          </Badge>
          <Text as="span" variant="bodySm" tone="subdued">
            {price}
          </Text>
        </InlineStack>
        <Button
          variant="plain"
          size="slim"
          onClick={() => navigate("/app/plans")}
        >
          Upgrade
        </Button>
      </InlineStack>
    </Box>
  );
}
