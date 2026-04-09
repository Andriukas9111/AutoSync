import { useState, useEffect, useMemo } from "react";
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
  RangeSlider,
} from "@shopify/polaris";
import {
  StarFilledIcon,
  QuestionCircleIcon,
  CheckSmallIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@shopify/polaris-icons";

import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import { cardRowStyle, isBannerDismissed, dismissBanner, featurePillStyle } from "../lib/design";
import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { isAdminShop } from "../lib/admin.server";
import {
  getTenant,
  createBillingSubscription,
  confirmBillingSubscription,
  getPlanConfigs,
  getEffectivePlan,
} from "../lib/billing.server";
import {
  CUSTOM_PLAN_TIERS,
  CUSTOM_PLAN_BASE_PRICE,
  calculateCustomPrice,
} from "../lib/custom-plan";
import type { CustomPlanConfig } from "../lib/custom-plan";
import { PLAN_ORDER } from "../lib/types";
import { RouteError } from "../components/RouteError";
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
  const widgetCount = [f.ymmeWidget, f.fitmentBadge, f.compatibilityTable, f.myGarage, f.wheelFinder, f.plateLookup, f.vinDecode].filter(Boolean).length;
  if (widgetCount > 0) items.push(`${widgetCount} widget type${widgetCount > 1 ? "s" : ""} enabled`);

  // Premium features
  if (f.myGarage) items.push("My Garage feature");
  if (f.wheelFinder) items.push("Wheel Finder");
  if (f.pricingEngine) items.push("Competitive Pricing Engine");
  if (f.vehiclePages) items.push("Vehicle Pages (SEO)");
  if (f.plateLookup) items.push("DVLA Plate Lookup + MOT");
  if (f.vinDecode) items.push("VIN Decode");

  // Customisation & Analytics
  if (f.widgetCustomisation === "full_css") items.push("Full customisation + hide branding");
  else if (f.widgetCustomisation === "full") items.push("Widget colors + hide branding");
  else if (f.widgetCustomisation === "basic") items.push("Widget color customisation");

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
  { label: "Scheduled Fetches/Day", category: "CAPACITY", getValue: (l) => l.scheduledFetchesPerDay === Infinity ? "Unlimited" : l.scheduledFetchesPerDay === 0 ? "—" : String(l.scheduledFetchesPerDay) },
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
  // floatingBar removed — widget doesn't exist
  { label: "My Garage", category: "STOREFRONT WIDGETS", getValue: (l) => l.features.myGarage ? "✓" : "—" },
  { label: "Wheel Finder", category: "STOREFRONT WIDGETS", getValue: (l) => l.features.wheelFinder ? "✓" : "—" },
  { label: "Plate Lookup (DVLA + MOT)", category: "STOREFRONT WIDGETS", getValue: (l) => l.features.plateLookup ? "✓" : "—" },
  { label: "VIN Decode", category: "STOREFRONT WIDGETS", getValue: (l) => l.features.vinDecode ? "✓" : "—" },
  { label: "Vehicle Pages (SEO)", category: "ADVANCED", getValue: (l) => l.features.vehiclePages ? "✓" : "—" },
  { label: "Pricing Engine", category: "ADVANCED", getValue: (l) => l.features.pricingEngine ? "✓" : "—" },
  { label: "Widget Customisation", category: "ADVANCED", getValue: (l) => {
    if (l.features.widgetCustomisation === "full_css") return "Full + Hide Branding";
    if (l.features.widgetCustomisation === "full") return "Colors + Hide Branding";
    if (l.features.widgetCustomisation === "basic") return "Colors Only";
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
    a: "AutoSync uses Shopify's managed billing. When you upgrade, you'll be redirected to Shopify to approve the charge. All charges appear on your Shopify invoice — no separate payment method needed. You can cancel at any time.",
  },
  {
    q: "Can I change plans at any time?",
    a: "Yes. Upgrades take effect immediately with prorated billing. Downgrades take effect at the end of your current billing cycle. You can downgrade to Free at any time — your data stays safe.",
  },
  {
    q: "How are fitments counted?",
    a: "Fitments are counted at the Make + Model + Year level — one fitment rule per vehicle combination. For example, mapping a product to 'BMW 3 Series 2019-2024' counts as 1 fitment, even though it covers dozens of individual trims and engine variants (M340i, 320d, 330e, etc.). This means your fitment limits go much further than per-trim counting used by other apps. We also show 'Vehicle Coverage' — the estimated number of individual vehicle configurations your fitments cover (~8× your fitment count).",
  },
  {
    q: "What happens if I exceed my product or fitment limit?",
    a: "You won't be able to import new products, add new fitments, or run auto-extraction until you upgrade or remove existing data. Your existing data remains intact and your storefront widgets continue working. You can also use the Build Your Plan option to add extra capacity without changing your base plan.",
  },
  {
    q: "What are 'active makes'?",
    a: "Active makes control how many vehicle makes (e.g., Ford, Toyota, BMW) appear in your YMME search widget and can be used for collections. The full YMME database with 374+ makes is always available for reference.",
  },
  {
    q: "Which widgets are included in each plan?",
    a: "Free: none. Starter: YMME Search + Fitment Badge (2 widget types). Growth: adds Compatibility Table (3 types). Professional: adds Wheel Finder (4 types). Business: adds My Garage (5 types). Enterprise: adds UK Plate Lookup + VIN Decode (all 7 types). Widget blocks can be added to any theme — plan controls which types are active on the storefront.",
  },
  {
    q: "What are smart collections?",
    a: "AutoSync automatically creates Shopify collections organized by vehicle make, model, and year range. Growth plan gets collections by make (e.g., 'BMW Parts'). Professional adds model-level (e.g., 'BMW 3 Series Parts'). Business+ adds year ranges (e.g., 'BMW 3 Series 2019-2024 Parts').",
  },
  {
    q: "What is the Pricing Engine?",
    a: "Available on Business+ plans. Set automated pricing rules with markup, margin, fixed, or MAP (Minimum Advertised Price) strategies. Scope rules by vendor, product type, provider, tag, or SKU prefix. Preview price changes before applying.",
  },
  {
    q: "What is the DVLA Plate Lookup?",
    a: "Enterprise-exclusive feature for UK stores. Customers enter their vehicle registration number and instantly see their vehicle details, MOT status, tax status, and compatible parts. Integrates with DVLA VES API and MOT History API.",
  },
  {
    q: "What happens when I uninstall the app?",
    a: "App-owned metafields and metaobjects are automatically removed by Shopify. Tags and collections persist on your store. Your data is preserved in our database for 48 hours in case you reinstall, then permanently deleted per GDPR requirements.",
  },
  {
    q: "Is there a free trial?",
    a: "The Free plan lets you explore AutoSync with up to 25 products at no cost. All paid plans include a 14-day free trial and are billed monthly through Shopify with no long-term commitment.",
  },
];

// ---------------------------------------------------------------------------
// Plan subtitles
// ---------------------------------------------------------------------------

const PLAN_SUBTITLES: Record<PlanTier, string> = {
  free: "Explore the platform",
  starter: "Activate your store",
  growth: "Automate fitment & collections",
  professional: "Integrate with APIs & data feeds",
  business: "Convert with advanced features",
  enterprise: "Complete automotive platform",
  custom: "Tailored to your needs",
};

/** Standard plan tiers shown in the card grid (excludes custom) */
const DISPLAY_PLAN_ORDER: PlanTier[] = PLAN_ORDER.filter((t) => t !== "custom");

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopId = session.shop;
  const isAdmin = isAdminShop(shopId);

  const url = new URL(request.url);
  const billingConfirmed = url.searchParams.get("billing_confirmed");
  const chargeId = url.searchParams.get("charge_id");

  let billingSuccess = false;
  if (billingConfirmed === "true" && chargeId) {
    try {
      await confirmBillingSubscription(shopId, chargeId, admin);
      billingSuccess = true;
    } catch (err) {
      console.error("[plans] Billing confirmation failed:", err);
    }
  }

  const tenant = await getTenant(shopId);
  const currentPlan: PlanTier = getEffectivePlan(tenant);
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

  return { currentPlan, shopId, billingSuccess, planConfigs: serializedConfigs, isAdmin };
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
    // For custom plans, save the configuration and set the custom price
    if (newPlan === "custom") {
      const customConfigRaw = String(formData.get("custom_config") || "").trim();
      if (!customConfigRaw) {
        return data({ error: "Custom plan configuration is required." }, { status: 400 });
      }
      const customConfig = JSON.parse(customConfigRaw) as { products: number; providers: number; fitments: number; scheduledFetches: number };
      // Calculate price from values by finding matching tier
      const findAddon = (tiers: { value: number; addon: number }[], val: number) => tiers.find(t => t.value === val)?.addon ?? 0;
      const customPrice = CUSTOM_PLAN_BASE_PRICE
        + findAddon(CUSTOM_PLAN_TIERS.products, customConfig.products)
        + findAddon(CUSTOM_PLAN_TIERS.providers, customConfig.providers)
        + findAddon(CUSTOM_PLAN_TIERS.fitments, customConfig.fitments)
        + findAddon(CUSTOM_PLAN_TIERS.scheduledFetches, customConfig.scheduledFetches);
      await db.from("tenants").update({
        custom_plan_config: customConfig,
        custom_price: customPrice,
        pending_plan: "custom",
        updated_at: new Date().toISOString(),
      }).eq("shop_id", shopId);
    }

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
  const [billingDismissed, setBillingDismissed] = useState(() => isBannerDismissed("billing_confirmed"));
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);

  const fetcherData = fetcher.data as
    | { success: true; plan: PlanTier; planName: string }
    | { redirectUrl: string; plan: PlanTier; planName: string }
    | { error: string }
    | undefined;

  useEffect(() => {
    if (fetcherData && "redirectUrl" in fetcherData) {
      // Use Shopify's redirect method for embedded apps — opens billing approval in top frame
      const url = fetcherData.redirectUrl;
      if (window.shopify?.idToken) {
        // App Bridge v4 — use top-level navigation
        open(url, "_top");
      } else if (window.top) {
        window.top.location.href = url;
      } else {
        window.location.href = url;
      }
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
        <HowItWorks
          steps={[
            {
              number: 1,
              title: "Compare Plans",
              description: "Review the feature comparison table below to find the plan that fits your store size, product count, and integration needs.",
            },
            {
              number: 2,
              title: "Choose & Subscribe",
              description: "Click your desired plan to subscribe via Shopify billing. You can upgrade or downgrade at any time — changes take effect immediately.",
            },
            {
              number: 3,
              title: "Unlock Features",
              description: "Once subscribed, all plan features activate instantly — widgets, collections, providers, and extraction tools are ready to use.",
              linkText: "View Dashboard",
              linkUrl: "/app",
            },
          ]}
        />

        {/* Banners */}
        {billingSuccess && !billingDismissed && (
          <Banner title="Plan activated successfully" tone="success" onDismiss={() => { dismissBanner("billing_confirmed"); setBillingDismissed(true); }}>
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
        <div style={{ textAlign: "center", padding: "var(--p-space-200) 0 0" }}>
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
          gap: "var(--p-space-400)",
        }}>
          <style>{`
            @media(max-width:900px) { .as-plan-grid { grid-template-columns: repeat(2, 1fr) !important; } }
            @media(max-width:580px) { .as-plan-grid { grid-template-columns: 1fr !important; } }
          `}</style>
          {DISPLAY_PLAN_ORDER.map((tier) => {
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
                  padding: "var(--p-space-150) 0",
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
                  padding: "var(--p-space-500)",
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
                  <div style={{ margin: "var(--p-space-400) 0" }}>
                    <InlineStack gap="100" blockAlign="end">
                      <Text as="span" variant="heading2xl" fontWeight="bold">
                        {config.priceMonthly === 0 ? "$0" : `$${String(config.priceMonthly)}`}
                      </Text>
                      <Text as="span" variant="bodySm" tone="subdued">
                        {config.priceMonthly === 0 ? "free forever" : "USD/month"}
                      </Text>
                    </InlineStack>
                  </div>

                  {/* Divider */}
                  <div style={{ margin: "var(--p-space-100) 0 var(--p-space-300)" }}>
                    <Divider />
                  </div>

                  {/* Features list — fills remaining space, pushes button to bottom */}
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

                  {/* CTA button — always at bottom of card */}
                  <div style={{ marginTop: "var(--p-space-400)" }}>
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
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ─── Build Your Plan — Enterprise extension with sliders ─── */}
        <BuildYourPlan
          currentPlan={activePlan}
          onSubscribe={(config) => {
            const fd = new FormData();
            fd.set("plan", "custom");
            fd.set("custom_config", JSON.stringify(config));
            fetcher.submit(fd, { method: "POST" });
          }}
          loading={fetcher.state !== "idle"}
        />

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
                      padding: "var(--p-space-300) var(--p-space-200)",
                      borderBottom: "2px solid var(--p-color-border)",
                      position: "sticky",
                      left: 0,
                      background: "var(--p-color-bg-surface)",
                      zIndex: 1,
                      minWidth: "180px",
                    }}>
                      <Text as="span" variant="bodySm" fontWeight="semibold">Feature</Text>
                    </th>
                    {DISPLAY_PLAN_ORDER.map((tier) => {
                      const c = configs[tier];
                      return (
                        <th key={tier} style={{
                          textAlign: "center",
                          padding: "var(--p-space-300) var(--p-space-150)",
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
                          padding: "var(--p-space-200) var(--p-space-200) var(--p-space-150)",
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
                            padding: "var(--p-space-200) var(--p-space-200)",
                            borderBottom: "1px solid var(--p-color-border-secondary)",
                            position: "sticky",
                            left: 0,
                            background: "var(--p-color-bg-surface)",
                            zIndex: 1,
                          }}>
                            <Text as="span" variant="bodySm" fontWeight="medium">{row.label}</Text>
                          </td>
                          {DISPLAY_PLAN_ORDER.map((tier) => {
                            const value = row.getValue(configs[tier].limits);
                            return (
                              <td key={tier} style={{
                                textAlign: "center",
                                padding: "var(--p-space-200) var(--p-space-150)",
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

        {/* ─── Competitor Comparison ─── */}
        <Card>
          <BlockStack gap="300">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge icon={StarFilledIcon} color="var(--p-color-icon-emphasis)" />
              <Text as="h2" variant="headingMd">How We Compare</Text>
            </InlineStack>
            <Divider />
            <Box overflowX="scroll">
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "900px", fontSize: "13px" }}>
                <thead>
                  <tr style={{ borderBottom: "2px solid var(--p-color-border)" }}>
                    {["Feature", "AutoSync", "Convermax", "EasySearch", "C: YMM", "PCFitment", "VFitz", "AutoFit AI", "PartFinder", "SearchAuto"].map((h, i) => (
                      <th key={i} style={{
                        textAlign: i === 0 ? "left" : "center",
                        padding: "var(--p-space-200) var(--p-space-200)",
                        fontWeight: 600,
                        fontSize: "13px",
                        background: i === 1 ? "var(--p-color-bg-surface-selected)" : undefined,
                        color: i > 1 ? "var(--p-color-text-secondary)" : undefined,
                        whiteSpace: "nowrap",
                      }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {([
                    ["Price", "Free–$299", "$250–$850", "$19–$75", "$10–$75", "$15–$150", "$1–$58", "$50–$250", "$49", "$89–$500"],
                    ["YMME Database", "yes", "yes", "yes", "yes", "yes", "yes", "yes", "no", "yes"],
                    ["Auto Extraction", "yes", "yes", "no", "no", "no", "no", "no", "no", "no"],
                    ["Smart Collections", "yes", "yes", "no", "no", "no", "no", "no", "no", "no"],
                    ["UK Plate Lookup", "yes", "yes", "no", "no", "no", "no", "no", "no", "no"],
                    ["VIN Decode", "yes", "yes", "no", "no", "yes", "no", "no", "no", "yes"],
                    ["Wheel Finder", "yes", "yes", "no", "no", "no", "no", "no", "no", "no"],
                    ["Fitment Badge", "yes", "yes", "no", "no", "no", "no", "yes", "yes", "yes"],
                    ["Compatibility Table", "yes", "yes", "extra", "extra", "no", "no", "extra", "no", "no"],
                    ["My Garage", "yes", "yes", "extra", "extra", "no", "no", "yes", "yes", "yes"],
                    ["Vehicle Spec Pages", "yes", "yes", "no", "no", "no", "no", "no", "no", "no"],
                    ["API/FTP Import", "yes", "yes", "no", "no", "yes", "no", "no", "no", "no"],
                    ["Pricing Engine", "yes", "no", "no", "no", "no", "no", "no", "no", "no"],
                    ["Analytics", "yes", "yes", "no", "no", "no", "no", "yes", "yes", "yes"],
                    ["Widgets", "7", "7+", "2", "2", "1", "1", "2", "2", "1"],
                  ] as string[][]).map(([label, ...vals], ri) => (
                    <tr key={ri} style={{ borderBottom: "1px solid var(--p-color-border-secondary)" }}>
                      <td style={{ padding: "var(--p-space-200)", fontWeight: 500 }}>{label}</td>
                      {vals.map((v, j) => {
                        const isAutoSync = j === 0;
                        const isYes = v === "yes";
                        const isNo = v === "no";
                        return (
                          <td key={j} style={{
                            textAlign: "center", padding: "var(--p-space-200)",
                            background: isAutoSync ? "var(--p-color-bg-surface-selected)" : undefined,
                          }}>
                            {isYes ? (
                              <Icon source={CheckSmallIcon} tone="success" />
                            ) : isNo ? (
                              <Text as="span" variant="bodySm" tone="subdued">—</Text>
                            ) : v === "extra" ? (
                              <Text as="span" variant="bodySm" tone="subdued">paid extra</Text>
                            ) : (
                              <Text as="span" variant="bodySm" fontWeight={isAutoSync ? "semibold" : "regular"}>{v}</Text>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
            <Box padding="300" background="bg-surface-secondary" borderRadius="200">
              <Text as="p" variant="bodySm" tone="subdued">
                AutoSync offers the most complete feature set in the market at a fraction of the cost. Only Convermax offers comparable features — at 3-10x the price.
              </Text>
            </Box>
          </BlockStack>
        </Card>

        {/* FAQ */}
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
                      padding: "var(--p-space-300) 0",
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
                      <div style={{ paddingTop: "var(--p-space-200)" }}>
                        <Text as="p" variant="bodySm" tone="subdued">{faq.a}</Text>
                      </div>
                    </Collapsible>
                  </div>
                </div>
              ))}
            </BlockStack>
          </BlockStack>
        </Card>

        {/* Billing info covered by HowItWorks at top */}
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

// ---------------------------------------------------------------------------
// Build Your Plan — Enterprise extension with configurable resource scaling
// ---------------------------------------------------------------------------

/** All Enterprise features shown as badges */
const INCLUDED_FEATURES = [
  "Push Tags & Metafields",
  "Auto Extraction",
  "Bulk Operations",
  "API Integration",
  "FTP Import",
  "All 7 Widgets",
  "Smart Collections (Full)",
  "Pricing Engine",
  "Vehicle Pages (SEO)",
  "Full Customisation + Hide Branding",
  "Analytics with Export",
  "DVLA Plate Lookup",
  "VIN Decode",
  "My Garage",
  "Wheel Finder",
  "Collection SEO Images",
];

function BuildYourPlan({ currentPlan, onSubscribe, loading }: {
  currentPlan: PlanTier;
  onSubscribe: (selection: { products: number; providers: number; fitments: number; scheduledFetches: number }) => void;
  loading: boolean;
}) {
  const [products, setProducts] = useState(0);
  const [providers, setProviders] = useState(0);
  const [fitments, setFitments] = useState(0);
  const [fetches, setFetches] = useState(0);

  const totalPrice = useMemo(() => calculateCustomPrice({
    productsIndex: products, providersIndex: providers,
    fitmentsIndex: fitments, scheduledFetchesIndex: fetches,
  }), [products, providers, fitments, fetches]);

  const addons = CUSTOM_PLAN_TIERS.products[products].addon
    + CUSTOM_PLAN_TIERS.providers[providers].addon
    + CUSTOM_PLAN_TIERS.fitments[fitments].addon
    + CUSTOM_PLAN_TIERS.scheduledFetches[fetches].addon;
  const isActive = currentPlan === "custom";

  const sliders: { label: string; desc: string; tiers: { label: string; addon: number }[]; value: number; set: (v: number) => void }[] = [
    { label: "Products", desc: `Enterprise includes ${CUSTOM_PLAN_TIERS.products[0].label}`, tiers: CUSTOM_PLAN_TIERS.products, value: products, set: setProducts },
    { label: "Providers", desc: `Enterprise includes ${CUSTOM_PLAN_TIERS.providers[0].label}`, tiers: CUSTOM_PLAN_TIERS.providers, value: providers, set: setProviders },
    { label: "Fitments", desc: `Enterprise includes ${CUSTOM_PLAN_TIERS.fitments[0].label}`, tiers: CUSTOM_PLAN_TIERS.fitments, value: fitments, set: setFitments },
    { label: "Scheduled Fetches", desc: `Enterprise includes ${CUSTOM_PLAN_TIERS.scheduledFetches[0].label}`, tiers: CUSTOM_PLAN_TIERS.scheduledFetches, value: fetches, set: setFetches },
  ];

  return (
    <Card>
      <BlockStack gap="500">
        {/* Header */}
        <InlineStack align="space-between" blockAlign="center">
          <InlineStack gap="200" blockAlign="center">
            <IconBadge icon={StarFilledIcon} color="var(--p-color-icon-emphasis)" />
            <BlockStack gap="050">
              <Text as="h2" variant="headingLg" fontWeight="bold">Build Your Plan</Text>
              <Text as="span" variant="bodySm" tone="subdued">
                All Enterprise features included. Scale your resources beyond standard plans.
              </Text>
            </BlockStack>
          </InlineStack>
          <BlockStack gap="050" inlineAlign="end">
            <Text as="p" variant="headingXl" fontWeight="bold">${String(totalPrice)}</Text>
            <Text as="span" variant="bodySm" tone="subdued">USD/month</Text>
          </BlockStack>
        </InlineStack>

        {/* Included features — pill badges */}
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm" fontWeight="semibold" tone="subdued">
            INCLUDED WITH YOUR PLAN
          </Text>
          <InlineStack gap="200" wrap>
            {INCLUDED_FEATURES.map((feature) => (
              <div key={feature} style={featurePillStyle}>
                <Icon source={CheckSmallIcon} tone="subdued" />
                {feature}
              </div>
            ))}
          </InlineStack>
        </BlockStack>

        <Divider />

        {/* Scale your resources — sliders */}
        <BlockStack gap="200">
          <Text as="h3" variant="headingSm" fontWeight="semibold" tone="subdued">
            SCALE YOUR RESOURCES
          </Text>
          <BlockStack gap="400">
            {sliders.map((s) => {
              const tier = s.tiers[s.value];
              return (
                <div key={s.label} style={{
                  display: "grid",
                  gridTemplateColumns: "140px 1fr 100px 80px",
                  gap: "var(--p-space-300)",
                  alignItems: "center",
                }}>
                  <BlockStack gap="050">
                    <Text as="span" variant="bodyMd" fontWeight="semibold">{s.label}</Text>
                    <Text as="span" variant="bodySm" tone="subdued">{s.desc}</Text>
                  </BlockStack>
                  <RangeSlider
                    label=""
                    labelHidden
                    min={0}
                    max={s.tiers.length - 1}
                    value={s.value}
                    onChange={(v: number) => s.set(v)}
                  />
                  <div style={{ textAlign: "right" }}>
                    <Badge>{tier.label}</Badge>
                  </div>
                  <Text as="span" variant="bodySm" tone={tier.addon > 0 ? undefined : "subdued"} alignment="end">
                    {tier.addon > 0 ? `+$${String(tier.addon)}/mo` : "included"}
                  </Text>
                </div>
              );
            })}
          </BlockStack>
        </BlockStack>

        <Divider />

        {/* Footer with price breakdown + CTA */}
        <InlineStack align="space-between" blockAlign="center">
          <Text as="span" variant="bodyMd" tone="subdued">
            {addons > 0 ? `$299 base + $${String(addons)} add-ons` : "Same as Enterprise — adjust sliders to add resources"}
          </Text>
          <Button variant="primary" size="large" loading={loading} disabled={isActive} onClick={() => onSubscribe({
            products: CUSTOM_PLAN_TIERS.products[products].value,
            providers: CUSTOM_PLAN_TIERS.providers[providers].value,
            fitments: CUSTOM_PLAN_TIERS.fitments[fitments].value,
            scheduledFetches: CUSTOM_PLAN_TIERS.scheduledFetches[fetches].value,
          })}>
            {isActive ? "Current Plan" : `Subscribe — $${String(totalPrice)}/mo`}
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}


export function ErrorBoundary() {
  return <RouteError pageName="Plans" />;
}
