import type { ReactNode } from "react";
import { useState } from "react";
import {
  BlockStack,
  InlineStack,
  Text,
  Button,
  Badge,
  Box,
  Collapsible,
  Icon,
} from "@shopify/polaris";
import { LockIcon, CheckSmallIcon, ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";
import { useNavigate } from "react-router";
import type { PlanTier, PlanLimits } from "../lib/types";
import { PLAN_PRICING, PLAN_HIGHLIGHTS, collapsibleTransition } from "../lib/design";
import { IconBadge } from "./IconBadge";

// ---------------------------------------------------------------------------
// Display-name lookup maps (all dynamic — change here, updates everywhere)
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
// PlanGate — compact upgrade prompt with collapsible benefits
//
// Default (collapsed):
//   🔒 Feature Name  [Plan+]  Available on Plan ($price)  [▼ Details] [Upgrade]
//
// Expanded:
//   ✓ Benefit 1
//   ✓ Benefit 2
//   ✓ Benefit 3
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
  const [detailsOpen, setDetailsOpen] = useState(false);

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
    <Box padding="300" background="bg-surface" borderRadius="200" borderWidth="025" borderColor="border">
      <BlockStack gap="200">
        {/* Main row */}
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="300" blockAlign="center">
            <IconBadge
              icon={LockIcon}
              bg="var(--p-color-bg-fill-critical-secondary)"
              color="var(--p-color-icon-critical)"
              size={24}
            />
            <BlockStack gap="0">
              <InlineStack gap="200" blockAlign="center">
                <Text as="span" variant="bodyMd" fontWeight="bold">
                  {featureLabel}
                </Text>
                <Badge size="small" tone="info">
                  {`${requiredPlanName}+`}
                </Badge>
              </InlineStack>
              <Text as="span" variant="bodySm" tone="subdued">
                {`Available on the `}
                <Text as="span" variant="bodySm" fontWeight="semibold" tone="subdued">
                  {requiredPlanName}
                </Text>
                {` plan (${price})`}
              </Text>
            </BlockStack>
          </InlineStack>

          <InlineStack gap="200" blockAlign="center">
            {highlights.length > 0 && (
              <Button
                variant="plain"
                size="slim"
                icon={detailsOpen ? ChevronUpIcon : ChevronDownIcon}
                onClick={() => setDetailsOpen(!detailsOpen)}
              >
                {detailsOpen ? "Hide" : "Details"}
              </Button>
            )}
            <Button size="slim" onClick={() => navigate("/app/plans")}>
              Upgrade
            </Button>
          </InlineStack>
        </InlineStack>

        {/* Collapsible benefits */}
        {highlights.length > 0 && (
          <Collapsible
            open={detailsOpen}
            id={`plangate-${feature}`}
            transition={collapsibleTransition}
          >
            <Box paddingBlockStart="200" paddingInlineStart="800">
              <BlockStack gap="100">
                <Text as="p" variant="bodySm" fontWeight="semibold" tone="subdued">
                  {`What's included in ${requiredPlanName}:`}
                </Text>
                {highlights.map((benefit) => (
                  <InlineStack key={benefit} gap="200" blockAlign="center" wrap={false}>
                    <div style={{ flexShrink: 0 }}>
                      <Icon source={CheckSmallIcon} tone="success" />
                    </div>
                    <Text as="span" variant="bodySm">
                      {benefit}
                    </Text>
                  </InlineStack>
                ))}
              </BlockStack>
            </Box>
          </Collapsible>
        )}
      </BlockStack>
    </Box>
  );
}
