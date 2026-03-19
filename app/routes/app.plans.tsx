import { useState, useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useFetcher } from "react-router";
import { data } from "react-router";
import {
  Page,
  Card,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Button,
  Divider,
  Banner,
  Box,
  Modal,
} from "@shopify/polaris";
import { StarFilledIcon } from "@shopify/polaris-icons";

import { IconBadge } from "../components/IconBadge";
import { authenticate } from "../shopify.server";
import { getTenant, createBillingSubscription, confirmBillingSubscription } from "../lib/billing.server";
import db from "../lib/db.server";
import type { PlanTier } from "../lib/types";

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
    values: { free: "50", starter: "1,000", growth: "10,000", professional: "50,000", business: "200,000", enterprise: "Unlimited" },
  },
  {
    label: "Fitments",
    values: { free: "200", starter: "5,000", growth: "50,000", professional: "250,000", business: "1,000,000", enterprise: "Unlimited" },
  },
  {
    label: "Providers",
    values: { free: "0", starter: "1", growth: "3", professional: "5", business: "15", enterprise: "Unlimited" },
  },
  {
    label: "Active Makes",
    values: { free: "0", starter: "10", growth: "30", professional: "Unlimited", business: "Unlimited", enterprise: "Unlimited" },
  },
  {
    label: "Push Tags",
    values: { free: "--", starter: "Yes", growth: "Yes", professional: "Yes", business: "Yes", enterprise: "Yes" },
  },
  {
    label: "Push Metafields",
    values: { free: "--", starter: "Yes", growth: "Yes", professional: "Yes", business: "Yes", enterprise: "Yes" },
  },
  {
    label: "Auto Extraction",
    values: { free: "--", starter: "--", growth: "Yes", professional: "Yes", business: "Yes", enterprise: "Yes" },
  },
  {
    label: "Bulk Operations",
    values: { free: "--", starter: "--", growth: "Yes", professional: "Yes", business: "Yes", enterprise: "Yes" },
  },
  {
    label: "Smart Collections",
    values: { free: "--", starter: "--", growth: "By Make", professional: "Make + Model", business: "Full", enterprise: "Full" },
  },
  {
    label: "YMME Widget",
    values: { free: "--", starter: "Yes", growth: "Yes", professional: "Yes", business: "Yes", enterprise: "Yes" },
  },
  {
    label: "Fitment Badge",
    values: { free: "--", starter: "Yes", growth: "Yes", professional: "Yes", business: "Yes", enterprise: "Yes" },
  },
  {
    label: "Compatibility Table",
    values: { free: "--", starter: "--", growth: "Yes", professional: "Yes", business: "Yes", enterprise: "Yes" },
  },
  {
    label: "Floating Vehicle Bar",
    values: { free: "--", starter: "--", growth: "Yes", professional: "Yes", business: "Yes", enterprise: "Yes" },
  },
  {
    label: "My Garage",
    values: { free: "--", starter: "--", growth: "--", professional: "Yes", business: "Yes", enterprise: "Yes" },
  },
  {
    label: "Wheel Finder",
    values: { free: "--", starter: "--", growth: "--", professional: "--", business: "Yes", enterprise: "Yes" },
  },
  {
    label: "Plate Lookup (DVLA)",
    values: { free: "--", starter: "--", growth: "--", professional: "--", business: "--", enterprise: "Yes" },
  },
  {
    label: "VIN Decode",
    values: { free: "--", starter: "--", growth: "--", professional: "--", business: "--", enterprise: "Yes" },
  },
  {
    label: "Widget Customisation",
    values: { free: "--", starter: "Basic", growth: "Full", professional: "Full", business: "Full", enterprise: "Full + CSS" },
  },
  {
    label: "Analytics",
    values: { free: "--", starter: "Basic", growth: "Full", professional: "Full", business: "Full + Export", enterprise: "Full + Export" },
  },
  {
    label: "Priority Support",
    values: { free: "--", starter: "--", growth: "--", professional: "--", business: "Yes", enterprise: "Yes" },
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
// Inject responsive CSS via useEffect (safe — no dangerouslySetInnerHTML)
// ---------------------------------------------------------------------------

const STYLE_ID = "autosync-plans-grid-css";

function useResponsiveGridStyles() {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".as-plans-grid { display:grid; gap:16px; grid-template-columns:repeat(3,1fr); }",
      "@media(max-width:1100px){ .as-plans-grid { grid-template-columns:repeat(2,1fr); } }",
      "@media(max-width:680px){ .as-plans-grid { grid-template-columns:1fr; } }",
      ".as-plan-cell { display:flex; flex-direction:column; height:100%; }",
      ".as-card-outer { flex:1; display:flex; flex-direction:column; border-radius:var(--p-border-radius-300); overflow:hidden; }",
      ".as-card-body { flex:1; display:flex; flex-direction:column; }",
      ".as-card-inner { display:flex; flex-direction:column; height:100%; }",
      ".as-features { flex:1; padding-top:16px; padding-bottom:16px; }",
      ".as-btn-area { padding-top:16px; margin-top:auto; }",
    ].join("\n");
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Handle billing confirmation callback from Shopify
  const url = new URL(request.url);
  const billingConfirmed = url.searchParams.get("billing_confirmed");
  const chargeId = url.searchParams.get("charge_id");

  let billingSuccess = false;
  if (billingConfirmed === "true" && chargeId) {
    try {
      await confirmBillingSubscription(shopId, chargeId);
      billingSuccess = true;
    } catch {
      // Confirmation failed — continue to show current plan
    }
  }

  const tenant = await getTenant(shopId);
  const currentPlan: PlanTier = tenant?.plan ?? "free";

  return {
    currentPlan,
    shopId,
    billingSuccess,
  };
};

// ---------------------------------------------------------------------------
// Action — change plan via Shopify Billing API
// Creates an AppSubscription and redirects merchant to Shopify approval page
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const newPlan = String(formData.get("plan") || "").trim() as PlanTier;

  if (!TIER_ORDER.includes(newPlan)) {
    return data({ error: "Invalid plan selected." }, { status: 400 });
  }

  try {
    const appUrl = process.env.SHOPIFY_APP_URL || `https://${request.headers.get("host")}`;
    const returnUrl = `${appUrl}/app/plans?billing_confirmed=true`;

    const result = await createBillingSubscription(admin, shopId, newPlan, returnUrl);

    if ("cancelled" in result) {
      // Downgrade to free — no Shopify confirmation needed
      return data({ success: true, plan: "free" as PlanTier, planName: "Free" });
    }

    // Redirect merchant to Shopify billing approval page
    return data({
      redirectUrl: result.confirmationUrl,
      plan: newPlan,
      planName: PLANS.find((p) => p.tier === newPlan)?.name ?? newPlan,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Billing error";
    return data({ error: message }, { status: 500 });
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Plans() {
  useResponsiveGridStyles();

  const { currentPlan, billingSuccess } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const [confirmTier, setConfirmTier] = useState<PlanTier | null>(null);

  const fetcherData = fetcher.data as
    | { success: true; plan: PlanTier; planName: string }
    | { redirectUrl: string; plan: PlanTier; planName: string }
    | { error: string }
    | undefined;

  // Handle Shopify billing redirect
  useEffect(() => {
    if (fetcherData && "redirectUrl" in fetcherData) {
      // Redirect to Shopify billing approval page
      window.top
        ? (window.top.location.href = fetcherData.redirectUrl)
        : (window.location.href = fetcherData.redirectUrl);
    }
  }, [fetcherData]);

  const activePlan: PlanTier =
    fetcherData && "success" in fetcherData ? fetcherData.plan : currentPlan;

  const currentIndex = TIER_ORDER.indexOf(activePlan);
  const isSubmitting = fetcher.state !== "idle";

  function getButtonProps(tier: PlanTier) {
    const tierIndex = TIER_ORDER.indexOf(tier);
    if (tier === activePlan) {
      return { label: "Current Plan", disabled: true, tone: "success" as const };
    }
    if (tierIndex > currentIndex) {
      return { label: "Upgrade", disabled: false, tone: "primary" as const };
    }
    return { label: "Downgrade", disabled: false, tone: "critical" as const };
  }

  function handlePlanClick(tier: PlanTier) {
    if (tier === activePlan) return;
    setConfirmTier(tier);
  }

  function handleConfirm() {
    if (!confirmTier) return;
    fetcher.submit(
      { plan: confirmTier },
      { method: "POST" },
    );
    setConfirmTier(null);
  }

  const confirmPlanInfo = confirmTier
    ? PLANS.find((p) => p.tier === confirmTier)
    : null;
  const isUpgrade = confirmTier
    ? TIER_ORDER.indexOf(confirmTier) > currentIndex
    : false;

  return (
    <Page
      fullWidth
      title="Plans & Pricing"
      backAction={{ content: "Dashboard", onAction: () => navigate("/app") }}
    >
        <BlockStack gap="600">
          {/* Billing confirmation success */}
          {billingSuccess && (
            <Banner title="Plan activated successfully" tone="success" onDismiss={() => {}}>
              <p>Your subscription has been confirmed by Shopify. All features are now active.</p>
            </Banner>
          )}
          {/* Success/Error banners */}
          {fetcherData && "success" in fetcherData && (
            <Banner
              title={`Successfully switched to ${fetcherData.planName} plan`}
              tone="success"
              onDismiss={() => {}}
            >
              <p>Your plan has been updated. All features for the {fetcherData.planName} plan are now active.</p>
            </Banner>
          )}
          {fetcherData && "error" in fetcherData && (
            <Banner title="Plan change failed" tone="critical">
              <p>{fetcherData.error}</p>
            </Banner>
          )}

          {/* Current plan banner */}
          <Banner
            title={`You are on the ${PLANS.find((p) => p.tier === activePlan)?.name} plan`}
            tone="info"
          >
            <p>
              Select a plan below to change your subscription. In production, plan changes
              are processed through Shopify&apos;s managed billing system.
            </p>
          </Banner>

          {/* ─── Plan cards grid ─── */}
          <div className="as-plans-grid">
            {PLANS.map((plan) => {
              const btnProps = getButtonProps(plan.tier);
              const isCurrent = plan.tier === activePlan;
              const isPopular = plan.tier === "growth";

              return (
                <div key={plan.tier} className="as-plan-cell">
                  <div
                    className="as-card-outer"
                    style={{
                      outline: isPopular
                        ? "2px solid var(--p-color-border-info)"
                        : isCurrent
                          ? "2px solid var(--p-color-border-success)"
                          : "1px solid var(--p-color-border)",
                    }}
                  >
                    {/* Popular banner */}
                    {isPopular && (
                      <div
                        style={{
                          background: "var(--p-color-bg-fill-info)",
                          color: "var(--p-color-text-info-on-bg-fill)",
                          textAlign: "center",
                          padding: "6px 0",
                          fontSize: "12px",
                          fontWeight: 600,
                          letterSpacing: "0.5px",
                        }}
                      >
                        MOST POPULAR
                      </div>
                    )}

                    {/* Card body */}
                    <div className="as-card-body">
                      <div
                        style={{
                          flex: 1,
                          display: "flex",
                          flexDirection: "column",
                          padding: "var(--p-space-400)",
                          background: "var(--p-color-bg-surface)",
                        }}
                      >
                        <div className="as-card-inner">
                          {/* Header + Price */}
                          <BlockStack gap="300">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="h2" variant="headingLg">
                                {plan.name}
                              </Text>
                              {isCurrent && <Badge tone="success">Current</Badge>}
                            </InlineStack>

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
                          </BlockStack>

                          {/* Features list — grows to push button down */}
                          <div className="as-features">
                            <BlockStack gap="200">
                              {plan.highlights.map((feature, idx) => (
                                <InlineStack key={idx} gap="200" blockAlign="start" wrap={false}>
                                  <span
                                    style={{
                                      color: "var(--p-color-text-success)",
                                      fontSize: "14px",
                                      flexShrink: 0,
                                      lineHeight: 1.4,
                                    }}
                                  >
                                    ✓
                                  </span>
                                  <Text as="span" variant="bodySm">
                                    {feature}
                                  </Text>
                                </InlineStack>
                              ))}
                            </BlockStack>
                          </div>

                          {/* Action button — pinned to bottom */}
                          <div className="as-btn-area">
                            <Divider />
                            <div style={{ paddingTop: "16px" }}>
                              <Button
                                variant={isCurrent ? undefined : "primary"}
                                tone={btnProps.tone === "critical" ? "critical" : undefined}
                                disabled={btnProps.disabled || isSubmitting}
                                loading={isSubmitting}
                                onClick={() => handlePlanClick(plan.tier)}
                                fullWidth
                              >
                                {btnProps.label}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ─── Feature comparison table ─── */}
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={StarFilledIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingLg">
                  Feature Comparison
                </Text>
              </InlineStack>
              <Divider />

              <Box overflowX="scroll">
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    minWidth: "640px",
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
                              plan.tier === activePlan
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
                    {COMPARISON_ROWS.map((row, rowIdx) => (
                      <tr
                        key={row.label}
                        style={{
                          backgroundColor: rowIdx % 2 === 0
                            ? undefined
                            : "var(--p-color-bg-surface-secondary)",
                        }}
                      >
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
                                tier === activePlan
                                  ? "var(--p-color-bg-surface-info)"
                                  : undefined,
                              color:
                                row.values[tier] === "--"
                                  ? "var(--p-color-text-subdued)"
                                  : "var(--p-color-text)",
                            }}
                          >
                            {row.values[tier] === "Yes" ? (
                              <span style={{ color: "var(--p-color-text-success)", fontWeight: 600 }}>✓</span>
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
          {activePlan !== "enterprise" && (
            <Banner title="How plans work" tone="info">
              <p>
                In production, plan upgrades are processed through Shopify&apos;s managed billing
                system. Merchants are redirected to confirm the charge in their Shopify admin.
                Downgrades take effect at the end of the current billing cycle.
              </p>
            </Banner>
          )}
        </BlockStack>

      {/* Confirmation modal */}
      <Modal
        open={confirmTier !== null}
        onClose={() => setConfirmTier(null)}
        title={isUpgrade ? "Confirm Upgrade" : "Confirm Downgrade"}
        primaryAction={{
          content: isUpgrade
            ? `Upgrade to ${confirmPlanInfo?.name}`
            : `Downgrade to ${confirmPlanInfo?.name}`,
          onAction: handleConfirm,
          loading: isSubmitting,
          destructive: !isUpgrade,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setConfirmTier(null) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {isUpgrade ? (
              <Text as="p" variant="bodyMd">
                You are upgrading from <strong>{PLANS.find((p) => p.tier === activePlan)?.name}</strong> to{" "}
                <strong>{confirmPlanInfo?.name}</strong> ({confirmPlanInfo?.price}/{confirmPlanInfo?.priceNote}).
                You will be redirected to Shopify to confirm the charge.
              </Text>
            ) : (
              <Text as="p" variant="bodyMd">
                You are downgrading from <strong>{PLANS.find((p) => p.tier === activePlan)?.name}</strong> to{" "}
                <strong>{confirmPlanInfo?.name}</strong> ({confirmPlanInfo?.price}/{confirmPlanInfo?.priceNote}).
                Some features may become unavailable after the downgrade.
              </Text>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
