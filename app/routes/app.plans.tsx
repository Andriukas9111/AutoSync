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
  Collapsible,
  Icon,
} from "@shopify/polaris";
import {
  StarFilledIcon,
  QuestionCircleIcon,
  CheckSmallIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  InfoIcon,
} from "@shopify/polaris-icons";

import { IconBadge } from "../components/IconBadge";
import { cardRowStyle } from "../lib/design";
import { authenticate } from "../shopify.server";
import {
  getTenant,
  createBillingSubscription,
  confirmBillingSubscription,
  getPlanConfigs,
} from "../lib/billing.server";
import { PLAN_ORDER } from "../lib/types";
import type { PlanTier, PlanLimits, PlanConfig } from "../lib/types";

// ---------------------------------------------------------------------------
// Feature highlights per tier (what shows in the card)
// ---------------------------------------------------------------------------

function getHighlights(config: PlanConfig): string[] {
  const l = config.limits;
  const f = l.features;
  const items: string[] = [];

  // Capacity
  if (l.products === Infinity) items.push("Unlimited products");
  else items.push(`Up to ${l.products.toLocaleString()} products`);

  if (l.fitments === Infinity) items.push("Unlimited fitments");
  else items.push(`Up to ${l.fitments.toLocaleString()} fitments`);

  if (l.providers === Infinity) items.push("Unlimited providers");
  else if (l.providers > 0) items.push(`${l.providers} provider ${l.providers === 1 ? "source" : "sources"}`);

  if (l.activeMakes >= 999_999) items.push("Unlimited active makes");
  else if (l.activeMakes > 0) items.push(`${l.activeMakes} active makes`);

  // Core features
  if (f.pushTags) items.push("Push tags & metafields");
  if (f.autoExtraction) items.push("Auto fitment extraction");
  if (f.bulkOperations) items.push("Bulk operations");

  // Collections
  if (f.smartCollections === "full") items.push("Smart collections (full)");
  else if (f.smartCollections === "make_model") items.push("Smart collections (make + model)");
  else if (f.smartCollections === "make") items.push("Smart collections (by make)");

  if (f.collectionSeoImages) items.push("Collection SEO images");

  // Integrations
  if (f.apiIntegration) items.push("API integration");
  if (f.ftpImport) items.push("FTP import");

  // Widgets — count them
  const widgetCount = [f.ymmeWidget, f.fitmentBadge, f.compatibilityTable, f.floatingBar, f.myGarage, f.wheelFinder, f.plateLookup, f.vinDecode].filter(Boolean).length;
  if (widgetCount > 0) items.push(`${widgetCount} storefront widget${widgetCount > 1 ? "s" : ""}`);

  // Premium features
  if (f.myGarage) items.push("My Garage feature");
  if (f.wheelFinder) items.push("Wheel Finder");
  if (f.pricingEngine) items.push("Competitive Pricing Engine");
  if (f.vehiclePages) items.push("Vehicle Pages (SEO)");
  if (f.plateLookup) items.push("DVLA Plate Lookup + MOT");
  if (f.vinDecode) items.push("VIN Decode");

  // Customisation & Analytics
  if (f.widgetCustomisation === "full_css") items.push("Full CSS widget customisation");
  else if (f.widgetCustomisation === "full") items.push("Full widget customisation");
  else if (f.widgetCustomisation === "basic") items.push("Basic widget styling");

  if (f.dashboardAnalytics === "full_export") items.push("Analytics with export");
  else if (f.dashboardAnalytics === "full") items.push("Full analytics dashboard");
  else if (f.dashboardAnalytics === "basic") items.push("Basic analytics");

  // Scheduled fetches
  if (l.scheduledFetchesPerDay === Infinity) items.push("Unlimited scheduled fetches");
  else if (l.scheduledFetchesPerDay > 0) items.push(`${l.scheduledFetchesPerDay} scheduled fetch${l.scheduledFetchesPerDay > 1 ? "es" : ""}/day`);

  return items;
}

// ---------------------------------------------------------------------------
// Feature comparison
// ---------------------------------------------------------------------------

interface ComparisonRow {
  label: string;
  category: string;
  getValue: (limits: PlanLimits) => string;
  comingSoon?: boolean;
}

const COMPARISON_ROWS: ComparisonRow[] = [
  { label: "Products", category: "CAPACITY", getValue: (l) => l.products === Infinity ? "Unlimited" : l.products.toLocaleString() },
  { label: "Fitments", category: "CAPACITY", getValue: (l) => l.fitments === Infinity ? "Unlimited" : l.fitments.toLocaleString() },
  { label: "Providers", category: "CAPACITY", getValue: (l) => l.providers === Infinity ? "Unlimited" : String(l.providers) },
  { label: "Active Makes", category: "CAPACITY", getValue: (l) => l.activeMakes >= 999_999 ? "Unlimited" : String(l.activeMakes) },
  { label: "Scheduled Fetches/Day", category: "CAPACITY", getValue: (l) => l.scheduledFetchesPerDay === Infinity ? "Unlimited" : l.scheduledFetchesPerDay === 0 ? "—" : String(l.scheduledFetchesPerDay), comingSoon: true },
  { label: "Push Tags", category: "DATA & SYNC", getValue: (l) => l.features.pushTags ? "✓" : "—" },
  { label: "Push Metafields", category: "DATA & SYNC", getValue: (l) => l.features.pushMetafields ? "✓" : "—" },
  { label: "Auto Extraction", category: "DATA & SYNC", getValue: (l) => l.features.autoExtraction ? "✓" : "—" },
  { label: "Bulk Operations", category: "DATA & SYNC", getValue: (l) => l.features.bulkOperations ? "✓" : "—" },
  { label: "API Integration", category: "DATA & SYNC", getValue: (l) => l.features.apiIntegration ? "✓" : "—" },
  { label: "FTP Import", category: "DATA & SYNC", getValue: (l) => l.features.ftpImport ? "✓" : "—" },
  { label: "Smart Collections", category: "COLLECTIONS", getValue: (l) => {
    if (l.features.smartCollections === "full") return "Full";
    if (l.features.smartCollections === "make_model") return "Make + Model";
    if (l.features.smartCollections === "make") return "By Make";
    return "—";
  }},
  { label: "Collection SEO Images", category: "COLLECTIONS", getValue: (l) => l.features.collectionSeoImages ? "✓" : "—" },
  { label: "YMME Search Widget", category: "STOREFRONT WIDGETS", getValue: (l) => l.features.ymmeWidget ? "✓" : "—" },
  { label: "Fitment Badge", category: "STOREFRONT WIDGETS", getValue: (l) => l.features.fitmentBadge ? "✓" : "—" },
  { label: "Compatibility Table", category: "STOREFRONT WIDGETS", getValue: (l) => l.features.compatibilityTable ? "✓" : "—" },
  { label: "Floating Vehicle Bar", category: "STOREFRONT WIDGETS", getValue: (l) => l.features.floatingBar ? "✓" : "—" },
  { label: "My Garage", category: "STOREFRONT WIDGETS", getValue: (l) => l.features.myGarage ? "✓" : "—" },
  { label: "Wheel Finder", category: "STOREFRONT WIDGETS", getValue: (l) => l.features.wheelFinder ? "✓" : "—" },
  { label: "Plate Lookup (DVLA + MOT)", category: "STOREFRONT WIDGETS", getValue: (l) => l.features.plateLookup ? "✓" : "—" },
  { label: "VIN Decode", category: "STOREFRONT WIDGETS", getValue: (l) => l.features.vinDecode ? "✓" : "—" },
  { label: "Vehicle Pages (SEO)", category: "ADVANCED", getValue: (l) => l.features.vehiclePages ? "✓" : "—" },
  { label: "Pricing Engine", category: "ADVANCED", getValue: (l) => l.features.pricingEngine ? "✓" : "—" },
  { label: "Widget Customisation", category: "ADVANCED", getValue: (l) => {
    if (l.features.widgetCustomisation === "full_css") return "Full + CSS";
    if (l.features.widgetCustomisation === "full") return "Full";
    if (l.features.widgetCustomisation === "basic") return "Basic";
    return "—";
  }},
  { label: "Analytics", category: "ADVANCED", getValue: (l) => {
    if (l.features.dashboardAnalytics === "full_export") return "Full + Export";
    if (l.features.dashboardAnalytics === "full") return "Full";
    if (l.features.dashboardAnalytics === "basic") return "Basic";
    return "—";
  }},
];

// ---------------------------------------------------------------------------
// FAQ items
// ---------------------------------------------------------------------------

const FAQ_ITEMS = [
  {
    q: "How does billing work?",
    a: "AutoSync uses Shopify's managed billing. When you upgrade, you'll be redirected to Shopify to approve the charge. All charges appear on your Shopify invoice — no separate payment method needed.",
  },
  {
    q: "Can I change plans at any time?",
    a: "Yes. Upgrades take effect immediately with prorated billing. Downgrades take effect at the end of your current billing cycle. You can downgrade to Free at any time.",
  },
  {
    q: "What happens if I exceed my product limit?",
    a: "You won't be able to import or sync new products until you upgrade or remove existing products. Your existing data remains intact.",
  },
  {
    q: "What are 'active makes'?",
    a: "Active makes control how many vehicle makes (e.g., Ford, Toyota, BMW) you can use for fitment mapping and collections. The YMME database itself is always available — this limit controls which makes you can actively assign to products.",
  },
  {
    q: "Are widgets included in all plans?",
    a: "The number of available storefront widgets depends on your plan. Free and Starter plans include basic widgets, while higher plans unlock advanced widgets like My Garage, Wheel Finder, Plate Lookup, and VIN Decode.",
  },
  {
    q: "What is the DVLA Plate Lookup?",
    a: "Enterprise-exclusive feature for UK stores. Customers can enter their vehicle registration number and instantly find compatible parts. Integrates with DVLA VES API and MOT history.",
  },
];

// ---------------------------------------------------------------------------
// Plan subtitles
// ---------------------------------------------------------------------------

const PLAN_SUBTITLES: Record<PlanTier, string> = {
  free: "For getting started",
  starter: "For small stores",
  growth: "For growing businesses",
  professional: "For established stores",
  business: "For large catalogues",
  enterprise: "For maximum capability",
};

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const url = new URL(request.url);
  const billingConfirmed = url.searchParams.get("billing_confirmed");
  const chargeId = url.searchParams.get("charge_id");

  let billingSuccess = false;
  if (billingConfirmed === "true" && chargeId) {
    try {
      await confirmBillingSubscription(shopId, chargeId);
      billingSuccess = true;
    } catch {
      // Confirmation failed
    }
  }

  const tenant = await getTenant(shopId);
  const currentPlan: PlanTier = tenant?.plan ?? "free";
  const planConfigs = await getPlanConfigs();

  const serializedConfigs: Record<string, {
    tier: PlanTier;
    name: string;
    priceMonthly: number;
    badge: string | null;
    description: string | null;
    isActive: boolean;
    limits: {
      products: number;
      fitments: number;
      providers: number;
      scheduledFetchesPerDay: number;
      activeMakes: number;
      features: PlanLimits["features"];
    };
  }> = {};
  for (const tier of PLAN_ORDER) {
    const c = planConfigs[tier];
    serializedConfigs[tier] = {
      ...c,
      limits: {
        ...c.limits,
        products: c.limits.products === Infinity ? 999_999_999 : c.limits.products,
        fitments: c.limits.fitments === Infinity ? 999_999_999 : c.limits.fitments,
        providers: c.limits.providers === Infinity ? 999_999_999 : c.limits.providers,
        scheduledFetchesPerDay: c.limits.scheduledFetchesPerDay === Infinity ? 999_999_999 : c.limits.scheduledFetchesPerDay,
        activeMakes: c.limits.activeMakes === Infinity ? 999_999_999 : c.limits.activeMakes,
      },
    };
  }

  return { currentPlan, shopId, billingSuccess, planConfigs: serializedConfigs };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const newPlan = String(formData.get("plan") || "").trim() as PlanTier;

  if (!PLAN_ORDER.includes(newPlan)) {
    return data({ error: "Invalid plan selected." }, { status: 400 });
  }

  try {
    const appUrl = process.env.SHOPIFY_APP_URL || `https://${request.headers.get("host")}`;
    const returnUrl = `${appUrl}/app/plans?billing_confirmed=true`;

    const result = await createBillingSubscription(admin, shopId, newPlan, returnUrl);

    if ("cancelled" in result) {
      return data({ success: true, plan: "free" as PlanTier, planName: "Free" });
    }

    const configs = await getPlanConfigs();
    const planName = configs[newPlan]?.name ?? newPlan;

    return data({ redirectUrl: result.confirmationUrl, plan: newPlan, planName });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Billing error";
    return data({ error: message }, { status: 500 });
  }
};

// ---------------------------------------------------------------------------
// Deserialize
// ---------------------------------------------------------------------------

function deserializeConfig(raw: Record<string, unknown>): PlanConfig {
  const r = raw as ReturnType<typeof useLoaderData<typeof loader>>["planConfigs"][string];
  return {
    ...r,
    limits: {
      ...r.limits,
      products: r.limits.products >= 999_999_999 ? Infinity : r.limits.products,
      fitments: r.limits.fitments >= 999_999_999 ? Infinity : r.limits.fitments,
      providers: r.limits.providers >= 999_999_999 ? Infinity : r.limits.providers,
      scheduledFetchesPerDay: r.limits.scheduledFetchesPerDay >= 999_999_999 ? Infinity : r.limits.scheduledFetchesPerDay,
      activeMakes: r.limits.activeMakes >= 999_999_999 ? Infinity : r.limits.activeMakes,
    },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Plans() {
  const { currentPlan, billingSuccess, planConfigs: rawConfigs } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  const configs: Record<PlanTier, PlanConfig> = {} as Record<PlanTier, PlanConfig>;
  for (const tier of PLAN_ORDER) {
    configs[tier] = deserializeConfig(rawConfigs[tier] as unknown as Record<string, unknown>);
  }

  const [confirmTier, setConfirmTier] = useState<PlanTier | null>(null);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  const fetcherData = fetcher.data as
    | { success: true; plan: PlanTier; planName: string }
    | { redirectUrl: string; plan: PlanTier; planName: string }
    | { error: string }
    | undefined;

  useEffect(() => {
    if (fetcherData && "redirectUrl" in fetcherData) {
      window.top
        ? (window.top.location.href = fetcherData.redirectUrl)
        : (window.location.href = fetcherData.redirectUrl);
    }
  }, [fetcherData]);

  const activePlan: PlanTier =
    fetcherData && "success" in fetcherData ? fetcherData.plan : currentPlan;
  const currentIndex = PLAN_ORDER.indexOf(activePlan);
  const isSubmitting = fetcher.state !== "idle";

  function handlePlanClick(tier: PlanTier) {
    if (tier === activePlan) return;
    setConfirmTier(tier);
  }

  function handleConfirm() {
    if (!confirmTier) return;
    fetcher.submit({ plan: confirmTier }, { method: "POST" });
    setConfirmTier(null);
  }

  const confirmConfig = confirmTier ? configs[confirmTier] : null;
  const isUpgrade = confirmTier ? PLAN_ORDER.indexOf(confirmTier) > currentIndex : false;
  const categories = [...new Set(COMPARISON_ROWS.map((r) => r.category))];

  return (
    <Page
      fullWidth
      title="Plans & Pricing"
      backAction={{ content: "Dashboard", onAction: () => navigate("/app") }}
    >
      <BlockStack gap="600">
        {/* Banners */}
        {billingSuccess && (
          <Banner title="Plan activated successfully" tone="success" onDismiss={() => {}}>
            <p>Your subscription has been confirmed by Shopify. All features are now active.</p>
          </Banner>
        )}
        {fetcherData && "success" in fetcherData && (
          <Banner title={`Successfully switched to ${fetcherData.planName} plan`} tone="success" onDismiss={() => {}}>
            <p>Your plan has been updated. All features for the {fetcherData.planName} plan are now active.</p>
          </Banner>
        )}
        {fetcherData && "error" in fetcherData && (
          <Banner title="Plan change failed" tone="critical">
            <p>{fetcherData.error}</p>
          </Banner>
        )}

        {/* Header */}
        <div style={{ textAlign: "center", padding: "8px 0 0" }}>
          <BlockStack gap="200" inlineAlign="center">
            <Text as="h1" variant="headingXl">Pick your plan</Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Cancel or change your plan anytime. All plans include access to our global vehicle database.
            </Text>
          </BlockStack>
        </div>

        {/* ─── Plan cards — Shopify-style ─── */}
        <div className="as-plan-grid" style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: "16px",
        }}>
          <style>{`
            @media(max-width:900px) { .as-plan-grid { grid-template-columns: repeat(2, 1fr) !important; } }
            @media(max-width:580px) { .as-plan-grid { grid-template-columns: 1fr !important; } }
          `}</style>
          {PLAN_ORDER.map((tier) => {
            const config = configs[tier];
            const isCurrent = tier === activePlan;
            const tierIndex = PLAN_ORDER.indexOf(tier);
            const highlights = getHighlights(config);
            const hasBadge = !!config.badge;

            return (
              <div
                key={tier}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  borderRadius: "var(--p-border-radius-300)",
                  border: isCurrent
                    ? "2px solid var(--p-color-border-emphasis)"
                    : "1px solid var(--p-color-border)",
                  background: "var(--p-color-bg-surface)",
                  overflow: "hidden",
                  transition: "box-shadow 150ms ease",
                  position: "relative",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = "var(--p-shadow-300)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.boxShadow = "none";
                }}
              >
                {/* Badge area — always same height so cards align */}
                <div style={{
                  textAlign: "center",
                  padding: "6px 0",
                  letterSpacing: "0.5px",
                  minHeight: "27px",
                  color: hasBadge ? "var(--p-color-text-emphasis)" : "transparent",
                  borderBottom: "1px solid var(--p-color-border)",
                }}>
                  <Text as="span" variant="bodySm" fontWeight="semibold">
                    {hasBadge ? config.badge : "\u00A0"}
                  </Text>
                </div>

                {/* Card content */}
                <div style={{
                  padding: "20px",
                  display: "flex",
                  flexDirection: "column",
                  flex: 1,
                }}>
                  {/* Plan name + subtitle */}
                  <BlockStack gap="050">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="h2" variant="headingLg" fontWeight="bold">
                        {config.name}
                      </Text>
                      {isCurrent && <Badge tone="info">Current</Badge>}
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {PLAN_SUBTITLES[tier]}
                    </Text>
                  </BlockStack>

                  {/* Price */}
                  <div style={{ margin: "16px 0" }}>
                    {config.priceMonthly === 0 ? (
                      <BlockStack gap="050">
                        <Text as="span" variant="heading2xl" fontWeight="bold">Free</Text>
                        <Text as="span" variant="bodySm" tone="subdued">forever</Text>
                      </BlockStack>
                    ) : (
                      <BlockStack gap="050">
                        <InlineStack gap="100" blockAlign="end">
                          <Text as="span" variant="heading2xl" fontWeight="bold">
                            {`$${String(config.priceMonthly)}`}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">USD/month</Text>
                        </InlineStack>
                      </BlockStack>
                    )}
                  </div>

                  {/* CTA button */}
                  {isCurrent ? (
                    <Button disabled fullWidth>Current Plan</Button>
                  ) : tierIndex > currentIndex ? (
                    <Button variant="primary" fullWidth onClick={() => handlePlanClick(tier)} loading={isSubmitting} disabled={isSubmitting}>
                      {`Select ${config.name}`}
                    </Button>
                  ) : (
                    <Button variant="primary" tone="critical" fullWidth onClick={() => handlePlanClick(tier)} loading={isSubmitting} disabled={isSubmitting}>
                      Downgrade
                    </Button>
                  )}

                  {/* Divider */}
                  <div style={{ margin: "16px 0 12px" }}>
                    <Divider />
                  </div>

                  {/* Features list — fills remaining space */}
                  <div style={{ flex: 1 }}>
                    <BlockStack gap="200">
                      {highlights.map((feature, idx) => (
                        <InlineStack key={idx} gap="200" blockAlign="start" wrap={false}>
                          <div style={{
                            width: "18px",
                            height: "18px",
                            borderRadius: "50%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            color: "var(--p-color-icon-emphasis)",
                            marginTop: "1px",
                          }}>
                            <Icon source={CheckSmallIcon} />
                          </div>
                          <Text as="span" variant="bodySm">{feature}</Text>
                        </InlineStack>
                      ))}
                    </BlockStack>
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
              <Text as="h2" variant="headingMd">Feature Comparison</Text>
            </InlineStack>
            <Divider />

            <Box overflowX="scroll">
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "780px" }}>
                <thead>
                  <tr>
                    <th style={{
                      textAlign: "left",
                      padding: "12px 8px",
                      borderBottom: "2px solid var(--p-color-border)",
                      position: "sticky",
                      left: 0,
                      background: "var(--p-color-bg-surface)",
                      zIndex: 1,
                      minWidth: "180px",
                    }}>
                      <Text as="span" variant="bodySm" fontWeight="semibold">Feature</Text>
                    </th>
                    {PLAN_ORDER.map((tier) => {
                      const c = configs[tier];
                      return (
                        <th key={tier} style={{
                          textAlign: "center",
                          padding: "12px 6px",
                          borderBottom: "2px solid var(--p-color-border)",
                          backgroundColor: tier === activePlan ? "var(--p-color-bg-surface-secondary)" : undefined,
                          minWidth: "90px",
                        }}>
                          <Text as="span" variant="bodySm" fontWeight="semibold">{c.name}</Text>
                          <br />
                          <Text as="span" variant="bodySm" tone="subdued">
                            {c.priceMonthly === 0 ? "Free" : `$${String(c.priceMonthly)}/mo`}
                          </Text>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {categories.map((category) => {
                    const categoryRows = COMPARISON_ROWS.filter((r) => r.category === category);
                    return [
                      <tr key={`cat-${category}`}>
                        <td colSpan={7} style={{
                          padding: "10px 8px 6px",
                          textTransform: "uppercase",
                          letterSpacing: "0.5px",
                          borderBottom: "1px solid var(--p-color-border)",
                          background: "var(--p-color-bg-surface-secondary)",
                        }}>
                          <Text as="span" variant="bodySm" fontWeight="bold" tone="subdued">{category}</Text>
                        </td>
                      </tr>,
                      ...categoryRows.map((row) => (
                        <tr key={row.label}>
                          <td style={{
                            padding: "10px 8px",
                            borderBottom: "1px solid var(--p-color-border-secondary)",
                            position: "sticky",
                            left: 0,
                            background: "var(--p-color-bg-surface)",
                            zIndex: 1,
                          }}>
                            <Text as="span" variant="bodySm" fontWeight="medium">{row.label}</Text>
                            {row.comingSoon && (
                              <span style={{ marginLeft: "6px" }}>
                                <Text as="span" variant="bodySm" tone="info">Coming Soon</Text>
                              </span>
                            )}
                          </td>
                          {PLAN_ORDER.map((tier) => {
                            const value = row.getValue(configs[tier].limits);
                            return (
                              <td key={tier} style={{
                                textAlign: "center",
                                padding: "10px 6px",
                                borderBottom: "1px solid var(--p-color-border-secondary)",
                                backgroundColor: tier === activePlan ? "var(--p-color-bg-surface-secondary)" : undefined,
                              }}>
                                {value === "✓" ? (
                                  <Text as="span" variant="bodySm" fontWeight="semibold" tone="success">{"✓"}</Text>
                                ) : (
                                  <Text as="span" variant="bodySm" tone={value === "—" ? "subdued" : undefined}>{value}</Text>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      )),
                    ];
                  })}
                </tbody>
              </table>
            </Box>
          </BlockStack>
        </Card>

        {/* ─── FAQ ─── */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={QuestionCircleIcon} color="var(--p-color-icon-emphasis)" />
              <Text as="h2" variant="headingMd">Frequently Asked Questions</Text>
            </InlineStack>
            <Divider />

            <BlockStack gap="0">
              {FAQ_ITEMS.map((faq, idx) => (
                <div key={idx}>
                  <div
                    onClick={() => setOpenFaqIndex(openFaqIndex === idx ? null : idx)}
                    style={{
                      cursor: "pointer",
                      padding: "14px 0",
                      borderBottom: idx < FAQ_ITEMS.length - 1 ? "1px solid var(--p-color-border-secondary)" : undefined,
                    }}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setOpenFaqIndex(openFaqIndex === idx ? null : idx);
                      }
                    }}
                  >
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">{faq.q}</Text>
                      <div style={{ flexShrink: 0, color: "var(--p-color-icon-subdued)" }}>
                        <Icon source={openFaqIndex === idx ? ChevronUpIcon : ChevronDownIcon} />
                      </div>
                    </InlineStack>
                    <Collapsible
                      open={openFaqIndex === idx}
                      id={`faq-${idx}`}
                      transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
                    >
                      <div style={{ paddingTop: "10px" }}>
                        <Text as="p" variant="bodySm" tone="subdued">{faq.a}</Text>
                      </div>
                    </Collapsible>
                  </div>
                </div>
              ))}
            </BlockStack>
          </BlockStack>
        </Card>

        {/* How billing works */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={InfoIcon} color="var(--p-color-icon-emphasis)" />
              <Text as="h2" variant="headingMd">How Billing Works</Text>
            </InlineStack>
            <Divider />
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: "12px",
            }}>
              {[
                { title: "Shopify Managed", desc: "All charges appear on your Shopify invoice. No separate payment method needed." },
                { title: "Upgrade Instantly", desc: "Upgrades take effect immediately. You'll be redirected to Shopify to approve the charge." },
                { title: "Downgrade Anytime", desc: "Downgrades take effect at the end of your current billing cycle. Your data stays safe." },
                { title: "Cancel Anytime", desc: "Cancel your subscription at any time. Downgrade to Free with no penalties." },
              ].map((item, i) => (
                <div key={i} style={{
                  ...cardRowStyle,
                  border: "1px solid var(--p-color-border-secondary)",
                }}>
                  <BlockStack gap="100">
                    <Text as="span" variant="headingSm">{`${String(i + 1)}. ${item.title}`}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">{item.desc}</Text>
                  </BlockStack>
                </div>
              ))}
            </div>
          </BlockStack>
        </Card>
      </BlockStack>

      {/* Confirmation modal */}
      <Modal
        open={confirmTier !== null}
        onClose={() => setConfirmTier(null)}
        title={isUpgrade ? "Confirm Upgrade" : "Confirm Downgrade"}
        primaryAction={{
          content: isUpgrade
            ? `Upgrade to ${confirmConfig?.name}`
            : `Downgrade to ${confirmConfig?.name}`,
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
                You are upgrading from <strong>{configs[activePlan].name}</strong> to{" "}
                <strong>{confirmConfig?.name}</strong> (${String(confirmConfig?.priceMonthly)}/month).
                You will be redirected to Shopify to confirm the charge.
              </Text>
            ) : (
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">
                  You are downgrading from <strong>{configs[activePlan].name}</strong> to{" "}
                  <strong>{confirmConfig?.name}</strong> (${String(confirmConfig?.priceMonthly)}/month).
                </Text>
                <Text as="p" variant="bodySm" tone="caution">
                  Some features may become unavailable after the downgrade. Products and fitments
                  exceeding the new plan&apos;s limits will remain but cannot be added to.
                </Text>
              </BlockStack>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
