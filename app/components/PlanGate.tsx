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
// Lookup maps — all dynamic, change once here updates everywhere
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

export function getPlanBadgeLabel(
  feature: keyof PlanLimits["features"],
  allLimits?: Record<PlanTier, PlanLimits>,
): string {
  if (!allLimits) return "";
  const plan = findMinPlan(feature, allLimits);
  return `${PLAN_NAMES[plan]}+`;
}

// ---------------------------------------------------------------------------
// PlanGate — vertical stack layout, works in any container width
//
// Row 1: 🔒 Feature Name [Badge]
// Row 2: Available on Plan ($price)
// Row 3: [More ▼] [Upgrade →]
// Collapsible: benefit list
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
  const [open, setOpen] = useState(false);

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
    <Box padding="400" background="bg-surface-secondary" borderRadius="300">
      <BlockStack gap="300">
        {/* Row 1: Icon + Feature name + Plan badge */}
        <InlineStack gap="300" blockAlign="center" wrap={false}>
          <IconBadge
            icon={LockIcon}
            bg="var(--p-color-bg-fill-critical-secondary)"
            color="var(--p-color-icon-critical)"
            size={28}
          />
          <Text as="span" variant="bodyMd" fontWeight="bold">
            {featureLabel}
          </Text>
          <Badge size="small" tone="info">
            {`${requiredPlanName}+`}
          </Badge>
        </InlineStack>

        {/* Row 2: Description */}
        <Text as="p" variant="bodySm" tone="subdued">
          {`This feature is available on the ${requiredPlanName} plan (${price}). Upgrade to unlock it.`}
        </Text>

        {/* Row 3: Action buttons — always on their own line */}
        <InlineStack gap="300" blockAlign="center">
          <Button size="slim" onClick={() => navigate("/app/plans")}>
            {`Upgrade to ${requiredPlanName}`}
          </Button>
          {highlights.length > 0 && (
            <Button
              variant="plain"
              size="slim"
              icon={open ? ChevronUpIcon : ChevronDownIcon}
              onClick={() => setOpen(!open)}
            >
              {open ? "Hide details" : "View details"}
            </Button>
          )}
        </InlineStack>

        {/* Collapsible benefits */}
        {highlights.length > 0 && (
          <Collapsible open={open} id={`plangate-${feature}`} transition={collapsibleTransition}>
            <Box paddingBlockStart="100">
              <BlockStack gap="150">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  {`What's included in ${requiredPlanName}:`}
                </Text>
                {highlights.map((h) => (
                  <InlineStack key={h} gap="200" blockAlign="start" wrap={false}>
                    <Box minWidth="16px">
                      <Icon source={CheckSmallIcon} tone="success" />
                    </Box>
                    <Text as="span" variant="bodySm">{h}</Text>
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
