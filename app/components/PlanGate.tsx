import type { ReactNode } from "react";
import {
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Box,
  Icon,
} from "@shopify/polaris";
import { LockIcon, CheckSmallIcon } from "@shopify/polaris-icons";
import { useNavigate } from "react-router";
import type { PlanTier, PlanLimits } from "../lib/types";
import { PLAN_PRICING, PLAN_HIGHLIGHTS } from "../lib/design";
import { IconBadge } from "./IconBadge";

// ---------------------------------------------------------------------------
// Display-name lookup maps (all dynamic — never hardcoded)
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

const PLAN_ORDER: PlanTier[] = [
  "free", "starter", "growth", "professional", "business", "enterprise",
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
// PlanGate component
//
// Renders a compact, clean upgrade prompt that matches the app design:
//   - IconBadge with LockIcon (same pattern as all section headers)
//   - Feature name + plan Badge
//   - Price + short description
//   - 2-3 key benefits with check icons
//   - Upgrade button
//
// All data comes from PLAN_NAMES, PLAN_PRICING, PLAN_HIGHLIGHTS —
// nothing is hardcoded, so changing plans/prices updates everywhere.
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
  const highlights = PLAN_HIGHLIGHTS[requiredPlan] ?? [];

  return (
    <Box
      padding="400"
      background="bg-surface-secondary"
      borderRadius="300"
    >
      <BlockStack gap="300">
        {/* Header: lock icon + feature name + plan badge */}
        <InlineStack gap="200" blockAlign="center">
          <IconBadge
            icon={LockIcon}
            bg="var(--p-color-bg-fill-caution-secondary)"
            color="var(--p-color-icon-caution)"
            size={28}
          />
          <Text as="h3" variant="headingSm">
            {featureLabel}
          </Text>
          <Badge size="small" tone="info">
            {`${requiredPlanName}+`}
          </Badge>
        </InlineStack>

        {/* Description */}
        <Text as="p" variant="bodySm" tone="subdued">
          {`Unlock with the ${requiredPlanName} plan (${price}). Includes:`}
        </Text>

        {/* Benefits — compact single-line items with check icons */}
        {highlights.length > 0 && (
          <BlockStack gap="100">
            {highlights.slice(0, 3).map((benefit) => (
              <InlineStack key={benefit} gap="100" blockAlign="center" wrap={false}>
                <Icon source={CheckSmallIcon} tone="success" />
                <Text as="span" variant="bodySm" tone="subdued">
                  {benefit}
                </Text>
              </InlineStack>
            ))}
          </BlockStack>
        )}

        {/* Upgrade button */}
        <InlineStack>
          <Button size="slim" onClick={() => navigate("/app/plans")}>
            {`Upgrade to ${requiredPlanName}`}
          </Button>
        </InlineStack>
      </BlockStack>
    </Box>
  );
}
