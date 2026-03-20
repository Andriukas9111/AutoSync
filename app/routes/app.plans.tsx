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
} from "@shopify/polaris";
import { StarFilledIcon, QuestionCircleIcon } from "@shopify/polaris-icons";

import { IconBadge } from "../components/IconBadge";
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
// Feature comparison — generated from plan configs
// ---------------------------------------------------------------------------

interface ComparisonRow {
  label: string;
  category: string;
  getValue: (limits: PlanLimits) => string;
  comingSoon?: boolean;
}

const COMPARISON_ROWS: ComparisonRow[] = [
  // Capacity
  { label: "Products", category: "Capacity", getValue: (l) => l.products === Infinity ? "Unlimited" : l.products.toLocaleString() },
  { label: "Fitments", category: "Capacity", getValue: (l) => l.fitments === Infinity ? "Unlimited" : l.fitments.toLocaleString() },
  { label: "Providers", category: "Capacity", getValue: (l) => l.providers === Infinity ? "Unlimited" : String(l.providers) },
  { label: "Active Makes", category: "Capacity", getValue: (l) => l.activeMakes >= 999_999 ? "Unlimited" : String(l.activeMakes) },
  { label: "Scheduled Fetches/Day", category: "Capacity", getValue: (l) => l.scheduledFetchesPerDay === Infinity ? "Unlimited" : l.scheduledFetchesPerDay === 0 ? "—" : String(l.scheduledFetchesPerDay), comingSoon: true },
  // Data & Sync
  { label: "Push Tags", category: "Data & Sync", getValue: (l) => l.features.pushTags ? "✓" : "—" },
  { label: "Push Metafields", category: "Data & Sync", getValue: (l) => l.features.pushMetafields ? "✓" : "—" },
  { label: "Auto Extraction", category: "Data & Sync", getValue: (l) => l.features.autoExtraction ? "✓" : "—" },
  { label: "Bulk Operations", category: "Data & Sync", getValue: (l) => l.features.bulkOperations ? "✓" : "—" },
  { label: "API Integration", category: "Data & Sync", getValue: (l) => l.features.apiIntegration ? "✓" : "—" },
  { label: "FTP Import", category: "Data & Sync", getValue: (l) => l.features.ftpImport ? "✓" : "—" },
  // Collections
  { label: "Smart Collections", category: "Collections", getValue: (l) => {
    if (l.features.smartCollections === "full") return "Full";
    if (l.features.smartCollections === "make_model") return "Make + Model";
    if (l.features.smartCollections === "make") return "By Make";
    return "—";
  }},
  { label: "Collection SEO Images", category: "Collections", getValue: (l) => l.features.collectionSeoImages ? "✓" : "—" },
  // Storefront Widgets
  { label: "YMME Search Widget", category: "Storefront Widgets", getValue: (l) => l.features.ymmeWidget ? "✓" : "—" },
  { label: "Fitment Badge", category: "Storefront Widgets", getValue: (l) => l.features.fitmentBadge ? "✓" : "—" },
  { label: "Compatibility Table", category: "Storefront Widgets", getValue: (l) => l.features.compatibilityTable ? "✓" : "—" },
  { label: "Floating Vehicle Bar", category: "Storefront Widgets", getValue: (l) => l.features.floatingBar ? "✓" : "—" },
  { label: "My Garage", category: "Storefront Widgets", getValue: (l) => l.features.myGarage ? "✓" : "—" },
  { label: "Wheel Finder", category: "Storefront Widgets", getValue: (l) => l.features.wheelFinder ? "✓" : "—" },
  { label: "Plate Lookup (DVLA + MOT)", category: "Storefront Widgets", getValue: (l) => l.features.plateLookup ? "✓" : "—" },
  { label: "VIN Decode", category: "Storefront Widgets", getValue: (l) => l.features.vinDecode ? "✓" : "—" },
  // Advanced
  { label: "Vehicle Pages (SEO)", category: "Advanced Features", getValue: (l) => l.features.vehiclePages ? "✓" : "—" },
  { label: "Pricing Engine", category: "Advanced Features", getValue: (l) => l.features.pricingEngine ? "✓" : "—" },
  { label: "Widget Customisation", category: "Advanced Features", getValue: (l) => {
    if (l.features.widgetCustomisation === "full_css") return "Full + CSS";
    if (l.features.widgetCustomisation === "full") return "Full";
    if (l.features.widgetCustomisation === "basic") return "Basic";
    return "—";
  }},
  { label: "Analytics", category: "Advanced Features", getValue: (l) => {
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
// CSS injection for responsive grid
// ---------------------------------------------------------------------------

const STYLE_ID = "autosync-plans-grid-css";

function useResponsiveGridStyles() {
  useEffect(() => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".as-plans-grid { display:grid; gap:16px; grid-template-columns:repeat(3,1fr); }",
      "@media(max-width:1200px){ .as-plans-grid { grid-template-columns:repeat(2,1fr); } }",
      "@media(max-width:680px){ .as-plans-grid { grid-template-columns:1fr; } }",
      ".as-plan-cell { display:flex; flex-direction:column; height:100%; }",
      ".as-card-outer { flex:1; display:flex; flex-direction:column; border-radius:var(--p-border-radius-300); overflow:hidden; transition:box-shadow 0.15s ease; }",
      ".as-card-outer:hover { box-shadow: var(--p-shadow-400); }",
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

  // Load plan configs from DB (dynamic pricing, badges)
  const planConfigs = await getPlanConfigs();

  // Serialize configs (Infinity → large number for JSON)
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
      },
    };
  }

  return {
    currentPlan,
    shopId,
    billingSuccess,
    planConfigs: serializedConfigs,
  };
};

// ---------------------------------------------------------------------------
// Action — change plan via Shopify Billing API
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

    return data({
      redirectUrl: result.confirmationUrl,
      plan: newPlan,
      planName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Billing error";
    return data({ error: message }, { status: 500 });
  }
};

// ---------------------------------------------------------------------------
// Deserialize plan config (restore Infinity from large numbers)
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
    },
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Plans() {
  useResponsiveGridStyles();

  const { currentPlan, billingSuccess, planConfigs: rawConfigs } = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const fetcher = useFetcher();

  // Deserialize plan configs
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

  // Handle Shopify billing redirect
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

  function getButtonProps(tier: PlanTier) {
    const tierIndex = PLAN_ORDER.indexOf(tier);
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

  const confirmConfig = confirmTier ? configs[confirmTier] : null;
  const isUpgrade = confirmTier
    ? PLAN_ORDER.indexOf(confirmTier) > currentIndex
    : false;

  // Get unique comparison categories
  const categories = [...new Set(COMPARISON_ROWS.map((r) => r.category))];

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

        {/* Savings callout */}
        <div style={{
          textAlign: "center",
          padding: "var(--p-space-500) var(--p-space-400)",
          background: "var(--p-color-bg-surface)",
          borderRadius: "var(--p-border-radius-300)",
          border: "1px solid var(--p-color-border)",
        }}>
          <BlockStack gap="200" inlineAlign="center">
            <Text as="h1" variant="headingXl">
              Choose the right plan for your store
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              All plans include access to our global vehicle database with 352+ makes, 4,900+ models, and 50,000+ engines.
              No setup fees. Cancel anytime.
            </Text>
          </BlockStack>
        </div>

        {/* ─── Plan cards grid ─── */}
        <div className="as-plans-grid">
          {PLAN_ORDER.map((tier) => {
            const config = configs[tier];
            const btnProps = getButtonProps(tier);
            const isCurrent = tier === activePlan;
            const highlights = getHighlights(config);

            return (
              <div key={tier} className="as-plan-cell">
                <div
                  className="as-card-outer"
                  style={{
                    outline: config.badge
                      ? "2px solid var(--p-color-border-info)"
                      : isCurrent
                        ? "2px solid var(--p-color-border-success)"
                        : "1px solid var(--p-color-border)",
                  }}
                >
                  {/* Badge banner (MOST POPULAR / BEST VALUE) */}
                  {config.badge && (
                    <div
                      style={{
                        background: config.badge === "MOST POPULAR"
                          ? "var(--p-color-bg-fill-info)"
                          : "var(--p-color-bg-fill-success)",
                        color: config.badge === "MOST POPULAR"
                          ? "var(--p-color-text-info-on-bg-fill)"
                          : "var(--p-color-text-success-on-bg-fill)",
                        textAlign: "center",
                        padding: "6px 0",
                        fontSize: "12px",
                        fontWeight: 600,
                        letterSpacing: "0.5px",
                      }}
                    >
                      {config.badge}
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
                              {config.name}
                            </Text>
                            {isCurrent && <Badge tone="success">Current</Badge>}
                          </InlineStack>

                          <BlockStack gap="100">
                            <InlineStack gap="100" blockAlign="end">
                              <Text as="span" variant="heading2xl">
                                ${String(config.priceMonthly)}
                              </Text>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {config.priceMonthly === 0 ? "forever" : "per month"}
                              </Text>
                            </InlineStack>
                            {config.description && (
                              <Text as="p" variant="bodySm" tone="subdued">
                                {config.description}
                              </Text>
                            )}
                          </BlockStack>

                          <Divider />
                        </BlockStack>

                        {/* Features list */}
                        <div className="as-features">
                          <BlockStack gap="200">
                            {highlights.map((feature, idx) => (
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

                        {/* Action button */}
                        <div className="as-btn-area">
                          <Divider />
                          <div style={{ paddingTop: "16px" }}>
                            <Button
                              variant={isCurrent ? undefined : "primary"}
                              tone={btnProps.tone === "critical" ? "critical" : undefined}
                              disabled={btnProps.disabled || isSubmitting}
                              loading={isSubmitting}
                              onClick={() => handlePlanClick(tier)}
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
                  minWidth: "780px",
                }}
              >
                <thead>
                  <tr>
                    <th
                      style={{
                        textAlign: "left",
                        padding: "12px 8px",
                        borderBottom: "2px solid var(--p-color-border)",
                        fontWeight: 600,
                        fontSize: "13px",
                        position: "sticky",
                        left: 0,
                        background: "var(--p-color-bg-surface)",
                        zIndex: 1,
                        minWidth: "180px",
                      }}
                    >
                      Feature
                    </th>
                    {PLAN_ORDER.map((tier) => {
                      const c = configs[tier];
                      return (
                        <th
                          key={tier}
                          style={{
                            textAlign: "center",
                            padding: "12px 6px",
                            borderBottom: "2px solid var(--p-color-border)",
                            fontWeight: 600,
                            fontSize: "13px",
                            backgroundColor:
                              tier === activePlan
                                ? "var(--p-color-bg-surface-info)"
                                : undefined,
                            minWidth: "90px",
                          }}
                        >
                          {c.name}
                          <br />
                          <span style={{ fontWeight: 400, fontSize: "12px", color: "var(--p-color-text-subdued)" }}>
                            ${String(c.priceMonthly)}/{c.priceMonthly === 0 ? "free" : "mo"}
                          </span>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {categories.map((category) => {
                    const categoryRows = COMPARISON_ROWS.filter((r) => r.category === category);
                    return [
                      // Category header row
                      <tr key={`cat-${category}`}>
                        <td
                          colSpan={7}
                          style={{
                            padding: "10px 8px 6px",
                            fontWeight: 700,
                            fontSize: "12px",
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                            color: "var(--p-color-text-subdued)",
                            borderBottom: "1px solid var(--p-color-border)",
                            background: "var(--p-color-bg-surface-secondary)",
                          }}
                        >
                          {category}
                        </td>
                      </tr>,
                      // Feature rows
                      ...categoryRows.map((row) => (
                        <tr key={row.label}>
                          <td
                            style={{
                              padding: "10px 8px",
                              borderBottom: "1px solid var(--p-color-border)",
                              fontSize: "13px",
                              fontWeight: 500,
                              position: "sticky",
                              left: 0,
                              background: "var(--p-color-bg-surface)",
                              zIndex: 1,
                            }}
                          >
                            {row.label}
                            {row.comingSoon && (
                              <span style={{
                                fontSize: "10px",
                                color: "var(--p-color-text-info)",
                                marginLeft: "6px",
                                fontWeight: 400,
                              }}>
                                Coming Soon
                              </span>
                            )}
                          </td>
                          {PLAN_ORDER.map((tier) => {
                            const value = row.getValue(configs[tier].limits);
                            return (
                              <td
                                key={tier}
                                style={{
                                  textAlign: "center",
                                  padding: "10px 6px",
                                  borderBottom: "1px solid var(--p-color-border)",
                                  fontSize: "13px",
                                  backgroundColor:
                                    tier === activePlan
                                      ? "var(--p-color-bg-surface-info)"
                                      : undefined,
                                  color:
                                    value === "—"
                                      ? "var(--p-color-text-subdued)"
                                      : "var(--p-color-text)",
                                }}
                              >
                                {value === "✓" ? (
                                  <span style={{ color: "var(--p-color-text-success)", fontWeight: 600 }}>✓</span>
                                ) : (
                                  value
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
          <BlockStack gap="400">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={QuestionCircleIcon} color="var(--p-color-icon-emphasis)" />
              <Text as="h2" variant="headingLg">
                Frequently Asked Questions
              </Text>
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
                      borderBottom: idx < FAQ_ITEMS.length - 1 ? "1px solid var(--p-color-border)" : undefined,
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
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {faq.q}
                      </Text>
                      <span style={{
                        fontSize: "18px",
                        color: "var(--p-color-text-subdued)",
                        transition: "transform 0.15s ease",
                        transform: openFaqIndex === idx ? "rotate(45deg)" : "none",
                      }}>
                        +
                      </span>
                    </InlineStack>
                    <Collapsible
                      open={openFaqIndex === idx}
                      id={`faq-${idx}`}
                      transition={{ duration: "150ms", timingFunction: "ease-in-out" }}
                    >
                      <div style={{ paddingTop: "10px" }}>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {faq.a}
                        </Text>
                      </div>
                    </Collapsible>
                  </div>
                </div>
              ))}
            </BlockStack>
          </BlockStack>
        </Card>

        {/* How plans work info */}
        {activePlan !== "enterprise" && (
          <Banner title="How billing works" tone="info">
            <p>
              All charges are processed through Shopify&apos;s managed billing system.
              Upgrades take effect immediately with prorated billing.
              Downgrades take effect at the end of your current billing cycle.
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
