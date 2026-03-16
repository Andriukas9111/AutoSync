import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Button,
  Divider,
  Banner,
  Box,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import { PLAN_LIMITS, getTenant } from "../lib/billing.server";
import type { PlanTier, PlanLimits } from "../lib/types";

// ---------------------------------------------------------------------------
// Plan display configuration
// ---------------------------------------------------------------------------

interface PlanInfo {
  tier: PlanTier;
  name: string;
  price: string;
  priceNote: string;
  description: string;
  highlights: string[];
}

const PLANS: PlanInfo[] = [
  {
    tier: "free",
    name: "Free",
    price: "$0",
    priceNote: "forever",
    description: "Get started with basic fitment management.",
    highlights: [
      "Up to 50 products",
      "Up to 200 fitments",
      "Manual fitment mapping",
      "Basic dashboard",
    ],
  },
  {
    tier: "starter",
    name: "Starter",
    price: "$19",
    priceNote: "per month",
    description: "Start pushing fitment data to your store.",
    highlights: [
      "Up to 1,000 products",
      "Up to 5,000 fitments",
      "1 provider source",
      "10 active makes",
      "Push tags & metafields",
      "YMME search widget",
      "Fitment badge widget",
      "Basic analytics",
    ],
  },
  {
    tier: "growth",
    name: "Growth",
    price: "$49",
    priceNote: "per month",
    description: "Auto-extraction, collections, and full widget suite.",
    highlights: [
      "Up to 10,000 products",
      "Up to 50,000 fitments",
      "3 provider sources",
      "30 active makes",
      "Auto fitment extraction",
      "Bulk operations",
      "Smart collections (by make)",
      "All 4 storefront widgets",
      "Full widget customisation",
      "Full analytics",
    ],
  },
  {
    tier: "professional",
    name: "Professional",
    price: "$99",
    priceNote: "per month",
    description: "Advanced features for serious automotive stores.",
    highlights: [
      "Up to 50,000 products",
      "Up to 250,000 fitments",
      "5 provider sources",
      "Unlimited makes",
      "Smart collections (make + model)",
      "Collection SEO images",
      "Custom vehicles",
      "API integration",
      "My Garage feature",
    ],
  },
  {
    tier: "business",
    name: "Business",
    price: "$179",
    priceNote: "per month",
    description: "High-volume stores with advanced integrations.",
    highlights: [
      "Up to 200,000 products",
      "Up to 1,000,000 fitments",
      "15 provider sources",
      "FTP import",
      "Wheel Finder",
      "Priority support",
      "Analytics with export",
      "6 scheduled fetches/day",
    ],
  },
  {
    tier: "enterprise",
    name: "Enterprise",
    price: "$299",
    priceNote: "per month",
    description: "Everything unlocked. No limits.",
    highlights: [
      "Unlimited products",
      "Unlimited fitments",
      "Unlimited providers",
      "DVLA plate lookup",
      "VIN decode",
      "Full CSS widget customisation",
      "Priority support",
      "All features included",
    ],
  },
];

// Feature comparison rows for the table
interface ComparisonRow {
  label: string;
  values: Record<PlanTier, string>;
}

const COMPARISON_ROWS: ComparisonRow[] = [
  {
    label: "Products",
    values: {
      free: "50",
      starter: "1,000",
      growth: "10,000",
      professional: "50,000",
      business: "200,000",
      enterprise: "Unlimited",
    },
  },
  {
    label: "Fitments",
    values: {
      free: "200",
      starter: "5,000",
      growth: "50,000",
      professional: "250,000",
      business: "1,000,000",
      enterprise: "Unlimited",
    },
  },
  {
    label: "Providers",
    values: {
      free: "0",
      starter: "1",
      growth: "3",
      professional: "5",
      business: "15",
      enterprise: "Unlimited",
    },
  },
  {
    label: "Active Makes",
    values: {
      free: "0",
      starter: "10",
      growth: "30",
      professional: "Unlimited",
      business: "Unlimited",
      enterprise: "Unlimited",
    },
  },
  {
    label: "Push Tags",
    values: {
      free: "--",
      starter: "Yes",
      growth: "Yes",
      professional: "Yes",
      business: "Yes",
      enterprise: "Yes",
    },
  },
  {
    label: "Push Metafields",
    values: {
      free: "--",
      starter: "Yes",
      growth: "Yes",
      professional: "Yes",
      business: "Yes",
      enterprise: "Yes",
    },
  },
  {
    label: "Auto Extraction",
    values: {
      free: "--",
      starter: "--",
      growth: "Yes",
      professional: "Yes",
      business: "Yes",
      enterprise: "Yes",
    },
  },
  {
    label: "Bulk Operations",
    values: {
      free: "--",
      starter: "--",
      growth: "Yes",
      professional: "Yes",
      business: "Yes",
      enterprise: "Yes",
    },
  },
  {
    label: "Smart Collections",
    values: {
      free: "--",
      starter: "--",
      growth: "By Make",
      professional: "Make + Model",
      business: "Full",
      enterprise: "Full",
    },
  },
  {
    label: "YMME Widget",
    values: {
      free: "--",
      starter: "Yes",
      growth: "Yes",
      professional: "Yes",
      business: "Yes",
      enterprise: "Yes",
    },
  },
  {
    label: "Fitment Badge",
    values: {
      free: "--",
      starter: "Yes",
      growth: "Yes",
      professional: "Yes",
      business: "Yes",
      enterprise: "Yes",
    },
  },
  {
    label: "Compatibility Table",
    values: {
      free: "--",
      starter: "--",
      growth: "Yes",
      professional: "Yes",
      business: "Yes",
      enterprise: "Yes",
    },
  },
  {
    label: "Floating Vehicle Bar",
    values: {
      free: "--",
      starter: "--",
      growth: "Yes",
      professional: "Yes",
      business: "Yes",
      enterprise: "Yes",
    },
  },
  {
    label: "My Garage",
    values: {
      free: "--",
      starter: "--",
      growth: "--",
      professional: "Yes",
      business: "Yes",
      enterprise: "Yes",
    },
  },
  {
    label: "Wheel Finder",
    values: {
      free: "--",
      starter: "--",
      growth: "--",
      professional: "--",
      business: "Yes",
      enterprise: "Yes",
    },
  },
  {
    label: "Plate Lookup (DVLA)",
    values: {
      free: "--",
      starter: "--",
      growth: "--",
      professional: "--",
      business: "--",
      enterprise: "Yes",
    },
  },
  {
    label: "VIN Decode",
    values: {
      free: "--",
      starter: "--",
      growth: "--",
      professional: "--",
      business: "--",
      enterprise: "Yes",
    },
  },
  {
    label: "Widget Customisation",
    values: {
      free: "--",
      starter: "Basic",
      growth: "Full",
      professional: "Full",
      business: "Full",
      enterprise: "Full + CSS",
    },
  },
  {
    label: "Analytics",
    values: {
      free: "--",
      starter: "Basic",
      growth: "Full",
      professional: "Full",
      business: "Full + Export",
      enterprise: "Full + Export",
    },
  },
  {
    label: "Priority Support",
    values: {
      free: "--",
      starter: "--",
      growth: "--",
      professional: "--",
      business: "Yes",
      enterprise: "Yes",
    },
  },
];

const TIER_ORDER: PlanTier[] = [
  "free",
  "starter",
  "growth",
  "professional",
  "business",
  "enterprise",
];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const tenant = await getTenant(shopId);
  const currentPlan: PlanTier = tenant?.plan ?? "free";

  return {
    currentPlan,
    shopId,
  };
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Plans() {
  const { currentPlan } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  const currentIndex = TIER_ORDER.indexOf(currentPlan);

  function getBadgeTone(tier: PlanTier): "info" | "success" | "warning" | "attention" | undefined {
    if (tier === currentPlan) return "info";
    return undefined;
  }

  function getButtonProps(tier: PlanTier) {
    const tierIndex = TIER_ORDER.indexOf(tier);
    if (tier === currentPlan) {
      return { label: "Current Plan", disabled: true, tone: "success" as const };
    }
    if (tierIndex > currentIndex) {
      return { label: "Upgrade", disabled: false, tone: "primary" as const };
    }
    return { label: "Downgrade", disabled: false, tone: "critical" as const };
  }

  return (
    <Page
      title="Plans & Pricing"
      backAction={{ content: "Dashboard", onAction: () => navigate("/app") }}
    >
      <BlockStack gap="800">
        {/* Current plan banner */}
        <Banner title={`You are on the ${PLANS.find((p) => p.tier === currentPlan)?.name} plan`} tone="info">
          <p>
            To change your plan, select an option below. Plan changes are managed through
            Shopify&apos;s billing system and will be reflected on your next invoice.
          </p>
        </Banner>

        {/* Plan cards grid */}
        <InlineGrid columns={{ xs: 1, sm: 2, lg: 3 }} gap="400">
          {PLANS.map((plan) => {
            const btnProps = getButtonProps(plan.tier);
            const isCurrent = plan.tier === currentPlan;

            return (
              <Card key={plan.tier}>
                <BlockStack gap="400">
                  {/* Header */}
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingLg">
                      {plan.name}
                    </Text>
                    {isCurrent && <Badge tone="success">Current</Badge>}
                  </InlineStack>

                  {/* Price */}
                  <BlockStack gap="100">
                    <InlineStack gap="100" blockAlign="end">
                      <Text as="span" variant="heading2xl">
                        {plan.price}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {plan.priceNote}
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {plan.description}
                    </Text>
                  </BlockStack>

                  <Divider />

                  {/* Features list */}
                  <BlockStack gap="200">
                    {plan.highlights.map((feature, idx) => (
                      <InlineStack key={idx} gap="200" blockAlign="center">
                        <Text as="span" variant="bodySm" tone="success">
                          {"\u2713"}
                        </Text>
                        <Text as="span" variant="bodySm">
                          {feature}
                        </Text>
                      </InlineStack>
                    ))}
                  </BlockStack>

                  <Divider />

                  {/* Action button */}
                  <Button
                    variant={isCurrent ? undefined : "primary"}
                    tone={btnProps.tone === "critical" ? "critical" : undefined}
                    disabled={btnProps.disabled}
                    onClick={() => {
                      if (!isCurrent) {
                        // In production, this would redirect to Shopify managed pricing.
                        // For now, show the plans page with info.
                        navigate("/app/plans");
                      }
                    }}
                    fullWidth
                  >
                    {btnProps.label}
                  </Button>
                </BlockStack>
              </Card>
            );
          })}
        </InlineGrid>

        {/* Feature comparison table */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              Feature Comparison
            </Text>
            <Divider />

            <Box overflowX="scroll">
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  minWidth: "800px",
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px 8px",
                        borderBottom: "1px solid var(--p-color-border)",
                        fontWeight: 600,
                        fontSize: "13px",
                      }}
                    >
                      Feature
                    </th>
                    {PLANS.map((plan) => (
                      <th
                        key={plan.tier}
                        style={{
                          textAlign: "center",
                          padding: "12px 8px",
                          borderBottom: "1px solid var(--p-color-border)",
                          fontWeight: 600,
                          fontSize: "13px",
                          backgroundColor:
                            plan.tier === currentPlan
                              ? "var(--p-color-bg-surface-info)"
                              : undefined,
                        }}
                      >
                        {plan.name}
                        <br />
                        <span style={{ fontWeight: 400, fontSize: "12px", color: "var(--p-color-text-subdued)" }}>
                          {plan.price}/{plan.tier === "free" ? "free" : "mo"}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row, idx) => (
                    <tr key={row.label}>
                      <td
                        style={{
                          padding: "10px 8px",
                          borderBottom: "1px solid var(--p-color-border)",
                          fontSize: "13px",
                          fontWeight: 500,
                        }}
                      >
                        {row.label}
                      </td>
                      {TIER_ORDER.map((tier) => (
                        <td
                          key={tier}
                          style={{
                            textAlign: "center",
                            padding: "10px 8px",
                            borderBottom: "1px solid var(--p-color-border)",
                            fontSize: "13px",
                            backgroundColor:
                              tier === currentPlan
                                ? "var(--p-color-bg-surface-info)"
                                : undefined,
                            color:
                              row.values[tier] === "--"
                                ? "var(--p-color-text-subdued)"
                                : "var(--p-color-text)",
                          }}
                        >
                          {row.values[tier] === "Yes" ? (
                            <span style={{ color: "var(--p-color-text-success)" }}>{"\u2713"}</span>
                          ) : (
                            row.values[tier]
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </BlockStack>
        </Card>

        {/* Upgrade info banner */}
        {currentPlan !== "enterprise" && (
          <Banner title="How to upgrade" tone="info">
            <p>
              Plan upgrades are processed through Shopify&apos;s managed billing system.
              When you select an upgrade, you will be redirected to confirm the charge
              in your Shopify admin. Downgrades take effect at the end of your current
              billing cycle.
            </p>
          </Banner>
        )}
      </BlockStack>
    </Page>
  );
}
