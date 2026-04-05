import { useState } from "react";
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
  ProgressBar,
  Banner,
  Divider,
  Box,
} from "@shopify/polaris";
import {
  ProductIcon,
  ConnectIcon,
  GaugeIcon,
  CollectionIcon,
  PackageIcon,
  StarFilledIcon,
  ImportIcon,
  WandIcon,
  TargetIcon,
  ExportIcon,
  ChartVerticalIcon,
  DatabaseIcon,
  SettingsIcon,
  SearchIcon,
  AlertCircleIcon,
  CheckCircleIcon,
  AlertTriangleIcon,
  ClockIcon,
  MinusCircleIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db, { paginatedSelect } from "../lib/db.server";
import { getPlanLimits, getPlanConfigs, getEffectivePlan } from "../lib/billing.server";
import type { PlanTier } from "../lib/types";
import { OnboardingChecklist } from "../components/OnboardingChecklist";
import { IconBadge } from "../components/IconBadge";
import { ActiveJobsPanel } from "../components/ActiveJobsPanel";
import { useAppData, computeFromStats } from "../lib/use-app-data";
import { RouteError } from "../components/RouteError";
import { statMiniStyle, statGridStyle, STATUS_TONES, statusDotStyle, listRowStyle, tableContainerStyle, formatJobType, formatDate, autoFitGridStyle } from "../lib/design";

// ---------------------------------------------------------------------------
// Loader — aggregate ALL system stats for the dashboard
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // OPTIMIZED: 13 queries (was 22) — all essential for zero-flash prevention
  // useAppData() provides live updates after initial render
  const [
    tenantResult,
    totalProductsResult,
    unmappedResult,
    autoMappedResult,
    smartMappedResult,
    manualMappedResult,
    flaggedResult,
    fitmentCountResult,
    collectionCountResult,
    topMakesResult,
    providerListResult,
    recentJobsResult,
    activeMakesResult,
    vehiclePagesResult,
    modelCollectionResult,
    ymmeMakesResult,
    ymmeModelsResult,
    ymmeEnginesResult,
    ymmeSpecsResult,
    syncedProductsResult,
  ] = await Promise.all([
    db.from("tenants").select("shop_id, plan, plan_status, product_count, fitment_count, installed_at").eq("shop_id", shopId).maybeSingle(),
    // Product counts — exclude staged products (same filter as job-status API to prevent flash-to-zero)
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").eq("fitment_status", "unmapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").eq("fitment_status", "auto_mapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").eq("fitment_status", "smart_mapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").eq("fitment_status", "manual_mapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").eq("fitment_status", "flagged"),
    db.from("vehicle_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("collection_mappings").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    // Top makes — cap at 50K rows (enough for accurate top 10, prevents OOM on huge shops)
    db.from("vehicle_fitments").select("make").eq("shop_id", shopId).not("make", "is", null).limit(50000).then((r) => ({ data: r.data ?? [], error: r.error })),
    // Providers
    db.from("providers").select("id, name, type, status, product_count, last_fetch_at").eq("shop_id", shopId).order("created_at", { ascending: false }).limit(5),
    // Recent jobs
    db.from("sync_jobs").select("id, type, status, total_items, processed_items, completed_at, created_at").eq("shop_id", shopId).order("created_at", { ascending: false }).limit(10),
    // Active makes count
    db.from("tenant_active_makes").select("ymme_make_id", { count: "exact", head: true }).eq("shop_id", shopId),
    // Vehicle pages
    db.from("vehicle_page_sync").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("sync_status", "synced"),
    // Models with parts (from collection_mappings)
    db.from("collection_mappings").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("type", "make_model"),
    // YMME database (global)
    db.from("ymme_makes").select("id", { count: "exact", head: true }),
    db.from("ymme_models").select("id", { count: "exact", head: true }),
    db.from("ymme_engines").select("id", { count: "exact", head: true }),
    db.from("ymme_vehicle_specs").select("id", { count: "exact", head: true }),
    // Pushed products — check for products that actually exist on Shopify (have shopify_product_id)
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).neq("status", "staged").not("shopify_product_id", "is", null),
  ]);

  const tenant = tenantResult.data;
  const plan = getEffectivePlan(tenant as any) as PlanTier;
  const limits = getPlanLimits(plan);
  const isFirstTime = !tenant;

  // Product counts come from useAppData (live polling) — no longer in loader

  // Top makes from fitment data
  const makeCounts = new Map<string, number>();
  for (const f of topMakesResult.data ?? []) {
    if (f.make) {
      makeCounts.set(f.make, (makeCounts.get(f.make) ?? 0) + 1);
    }
  }
  const topMakes = [...makeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  // Dynamic plan price from configs (not hardcoded)
  const planConfigsMap = await getPlanConfigs();
  const currentPlanConfig = planConfigsMap[plan];
  const planPrice = currentPlanConfig
    ? currentPlanConfig.priceMonthly === 0
      ? "$0"
      : `$${String(currentPlanConfig.priceMonthly)}`
    : "$0";
  const planName = currentPlanConfig?.name ?? plan.charAt(0).toUpperCase() + plan.slice(1);

  return {
    shopId,
    plan,
    planPrice,
    planName,
    limits,
    isFirstTime,
    hasPushed: (syncedProductsResult.count ?? 0) > 0, // Now checks for completed push JOBS, not synced_at
    // Products — real counts for instant render, useAppData updates live
    totalProducts: totalProductsResult.count ?? 0,
    unmapped: unmappedResult.count ?? 0,
    autoMapped: autoMappedResult.count ?? 0,
    smartMapped: smartMappedResult.count ?? 0,
    manualMapped: manualMappedResult.count ?? 0,
    flagged: flaggedResult.count ?? 0,
    mapped: (autoMappedResult.count ?? 0) + (smartMappedResult.count ?? 0) + (manualMappedResult.count ?? 0),
    // Fitments
    fitmentCount: fitmentCountResult.count ?? 0,
    topMakes,
    // Providers
    providerCount: (providerListResult.data ?? []).length,
    providers: providerListResult.data ?? [],
    // Collections
    collectionCount: collectionCountResult.count ?? 0,
    // Recent activity
    recentJobs: recentJobsResult.data ?? [],
    // YMME database
    ymmeMakes: ymmeMakesResult.count ?? 0,
    ymmeModels: ymmeModelsResult.count ?? 0,
    ymmeEngines: ymmeEnginesResult.count ?? 0,
    ymmeSpecs: ymmeSpecsResult.count ?? 0,
    // Push + sync stats
    pushedProducts: syncedProductsResult.count ?? 0,
    activeMakes: activeMakesResult.count ?? 0,
    vehiclePagesSynced: vehiclePagesResult.count ?? 0,
    // Unique makes/models — same source as job-status.tsx (tenant_active_makes)
    uniqueMakes: activeMakesResult.count ?? 0,
    uniqueModels: modelCollectionResult.count ?? 0,
  };
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Quick Action Card sub-component
// ---------------------------------------------------------------------------

function QuickActionCard({
  icon,
  label,
  description,
  onClick,
  primary = false,
  badge,
}: {
  icon: any;
  label: string;
  description: string;
  onClick: () => void;
  primary?: boolean;
  badge?: { content: string; tone: "success" | "warning" | "critical" | "info" };
}) {
  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      role="button"
      tabIndex={0}
      style={{
        cursor: "pointer",
        borderRadius: "var(--p-border-radius-300)",
        border: primary
          ? "2px solid var(--p-color-border-emphasis)"
          : "1px solid var(--p-color-border)",
        padding: "var(--p-space-400)",
        background: primary
          ? "var(--p-color-bg-surface-secondary)"
          : "var(--p-color-bg-surface)",
        transition: "box-shadow 120ms ease, border-color 120ms ease",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow =
          "var(--p-shadow-300)";
        (e.currentTarget as HTMLElement).style.borderColor =
          "var(--p-color-border-emphasis)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
        (e.currentTarget as HTMLElement).style.borderColor = primary
          ? "var(--p-color-border-emphasis)"
          : "var(--p-color-border)";
      }}
    >
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="center" align="space-between">
          <InlineStack gap="200" blockAlign="center">
            <IconBadge
              icon={icon}
              size={36}
              bg={primary ? "var(--p-color-bg-fill-emphasis)" : "var(--p-color-bg-surface-secondary)"}
              color={primary ? "var(--p-color-text-inverse)" : "var(--p-color-icon-emphasis)"}
            />
            <Text as="span" variant="headingSm">
              {label}
            </Text>
          </InlineStack>
          {badge && (
            <Badge tone={badge.tone}>{badge.content}</Badge>
          )}
        </InlineStack>
        <Text as="p" variant="bodySm" tone="subdued">
          {description}
        </Text>
      </BlockStack>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact status item for fitment coverage
// ---------------------------------------------------------------------------

function StatusChip({
  icon,
  label,
  count,
  bg,
  color,
  onClick,
}: {
  icon: any;
  label: string;
  count: number;
  bg: string;
  color: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
      style={{
        ...statMiniStyle,
        display: "flex",
        alignItems: "center",
        gap: "var(--p-space-200)",
        padding: "var(--p-space-300) var(--p-space-400)",
        border: "1px solid var(--p-color-border-secondary)",
        cursor: onClick ? "pointer" : "default",
        flex: "1 1 0",
        minWidth: "140px",
        transition: "box-shadow 120ms ease, border-color 120ms ease",
      }}
      onMouseEnter={onClick ? (e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "var(--p-shadow-200)";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--p-color-border)";
      } : undefined}
      onMouseLeave={onClick ? (e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = "none";
        (e.currentTarget as HTMLElement).style.borderColor = "var(--p-color-border-secondary)";
      } : undefined}
    >
      <IconBadge icon={icon} size={22} bg={bg} color={color} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <Text as="span" variant="headingSm">{count.toLocaleString()}</Text>
        <Text as="span" variant="bodySm" tone="subdued">{label}</Text>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coverage Progress Bar — custom thick bar with gradient
// ---------------------------------------------------------------------------

// CoverageBar removed — replaced with Polaris ProgressBar for consistency

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const {
    plan,
    planPrice,
    planName,
    limits,
    isFirstTime,
    hasPushed,
    totalProducts,
    unmapped,
    autoMapped,
    smartMapped,
    manualMapped,
    flagged,
    mapped,
    fitmentCount,
    topMakes,
    providerCount,
    providers,
    collectionCount,
    recentJobs,
    ymmeMakes,
    ymmeModels,
    ymmeEngines,
    ymmeSpecs,
    pushedProducts: loaderPushedProducts,
    activeMakes: loaderActiveMakes,
    vehiclePagesSynced: loaderVehiclePages,
    uniqueMakes: loaderUniqueMakes,
    uniqueModels: loaderUniqueModels,
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();
  const [showWelcome, setShowWelcome] = useState(true);

  // Unified live data — replaces 9 scattered polling implementations
  const { stats: liveData, jobs: liveJobs } = useAppData({
    total: totalProducts,
    unmapped,
    autoMapped,
    smartMapped,
    manualMapped,
    flagged,
    fitments: fitmentCount,
    collections: collectionCount,
    pushedProducts: loaderPushedProducts,
    activeMakes: loaderActiveMakes,
    vehiclePagesSynced: loaderVehiclePages,
    uniqueMakes: loaderUniqueMakes,
    uniqueModels: loaderUniqueModels,
  });

  // All live values from unified hook
  const s = liveData; // Short alias
  const { mapped: liveMapped, needsReview, notMapped, coverage, pendingPush } = computeFromStats(s);
  const liveTotalProducts = s.total;
  const liveUnmapped = s.unmapped;
  const liveAutoMapped = s.autoMapped;
  const liveSmartMapped = s.smartMapped;
  const liveFlagged = s.flagged;
  const liveFitmentCount = s.fitments;
  const liveCollectionCount = s.collections;
  const livePushedProducts = s.pushedProducts;
  const liveActiveMakes = s.activeMakes;
  const liveVehiclePages = s.vehiclePagesSynced;
  const liveUniqueMakes = s.uniqueMakes;
  const liveUniqueModels = s.uniqueModels;

  const planLabel = planName;
  const showOnboarding = liveTotalProducts < 1 || liveFitmentCount < 1;

  const productUsagePercent =
    limits.products === Infinity ? 0 : Math.min(100, Math.round((liveTotalProducts / limits.products) * 100));
  const fitmentUsagePercent =
    limits.fitments === Infinity ? 0 : Math.min(100, Math.round((liveFitmentCount / limits.fitments) * 100));
  const isOverProductLimit = limits.products !== Infinity && liveTotalProducts > limits.products;
  const isOverFitmentLimit = limits.fitments !== Infinity && liveFitmentCount > limits.fitments;

  return (
    <Page title="Dashboard" fullWidth>
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {/* Over-limit warning — shows when data exceeds plan limits (e.g., after downgrade) */}
            {(isOverProductLimit || isOverFitmentLimit) && (
              <Banner tone="critical" title="Plan limit exceeded">
                <BlockStack gap="100">
                  {isOverProductLimit && (
                    <Text as="p" variant="bodySm">
                      You have <strong>{liveTotalProducts.toLocaleString()}</strong> products but your {planLabel} plan allows <strong>{limits.products.toLocaleString()}</strong>. You cannot add new products or run imports until you upgrade or remove existing products.
                    </Text>
                  )}
                  {isOverFitmentLimit && (
                    <Text as="p" variant="bodySm">
                      You have <strong>{liveFitmentCount.toLocaleString()}</strong> fitments but your {planLabel} plan allows <strong>{limits.fitments.toLocaleString()}</strong>. You cannot add new fitments until you upgrade or remove existing data.
                    </Text>
                  )}
                  <Button variant="primary" onClick={() => navigate("/app/plans")}>Upgrade Plan</Button>
                </BlockStack>
              </Banner>
            )}

            {/* Welcome banner */}
            {isFirstTime && showWelcome && (
              <Banner
                title="Welcome to AutoSync!"
                tone="info"
                onDismiss={() => setShowWelcome(false)}
              >
                <p>
                  Get started by fetching your products from Shopify, mapping
                  fitment data, and pushing it back to your store.
                </p>
              </Banner>
            )}

            {/* ─── Quick Actions ─── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Quick Actions
                  </Text>
                  {needsReview > 0 && (
                    <Badge tone="warning">
                      {`${needsReview.toLocaleString()} need review`}
                    </Badge>
                  )}
                </InlineStack>

                <InlineGrid columns={{ xs: 2, sm: 2, md: 4 }} gap="300">
                  <QuickActionCard
                    icon={ImportIcon}
                    label="Fetch Products"
                    description="Import products from your Shopify store"
                    onClick={() => navigate("/app/products")}
                  />
                  <QuickActionCard
                    icon={WandIcon}
                    label="Auto Extract"
                    description="Automatically detect vehicle fitments"
                    onClick={() => navigate("/app/fitment")}
                    badge={needsReview > 0 ? { content: `${needsReview.toLocaleString()} flagged`, tone: "warning" } : undefined}
                  />
                  <QuickActionCard
                    icon={TargetIcon}
                    label="Manual Map"
                    description="Map products to vehicles by hand"
                    onClick={() => navigate("/app/fitment/manual")}
                  />
                  <QuickActionCard
                    icon={ExportIcon}
                    label="Push to Shopify"
                    description="Push tags & metafields to your store"
                    onClick={() => navigate("/app/push")}
                    primary
                  />
                </InlineGrid>

                <InlineGrid columns={{ xs: 2, sm: 2, md: 4 }} gap="300">
                  <QuickActionCard
                    icon={CollectionIcon}
                    label="Collections"
                    description="Auto-create smart collections"
                    onClick={() => navigate("/app/collections")}
                    badge={collectionCount > 0 ? { content: `${liveCollectionCount}`, tone: "info" } : undefined}
                  />
                  <QuickActionCard
                    icon={ChartVerticalIcon}
                    label="Analytics"
                    description="Fitment coverage and performance"
                    onClick={() => navigate("/app/analytics")}
                  />
                  <QuickActionCard
                    icon={SearchIcon}
                    label="YMME Browser"
                    description="Browse the vehicle database"
                    onClick={() => navigate("/app/vehicles")}
                  />
                  <QuickActionCard
                    icon={SettingsIcon}
                    label="Settings"
                    description="Configure your app preferences"
                    onClick={() => navigate("/app/settings")}
                  />
                </InlineGrid>
              </BlockStack>
            </Card>

            {/* ─── Active Jobs — Live Progress ─── */}
            <ActiveJobsPanel navigate={navigate} jobs={liveJobs} stats={s} />

            {/* Onboarding checklist */}
            {showOnboarding && (
              <OnboardingChecklist
                productCount={liveTotalProducts}
                fitmentCount={liveFitmentCount}
                hasPushed={hasPushed}
                collectionCount={liveCollectionCount}
              />
            )}

            {/* ─── System Overview — 3-column status cards ─── */}
            <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
              {/* Products & Fitments */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={ProductIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingSm">Products & Fitments</Text>
                    </InlineStack>
                    <Button onClick={() => navigate("/app/products")} variant="plain" size="slim">View all</Button>
                  </InlineStack>
                  <div style={statGridStyle(2)}>
                    {[
                      { label: "Total Products", value: liveTotalProducts },
                      { label: "Vehicle Links", value: liveFitmentCount },
                      { label: "Mapped", value: liveMapped },
                      { label: "Not Mapped", value: notMapped },
                      { label: "Makes with Parts", value: liveUniqueMakes },
                      { label: "Models with Parts", value: liveUniqueModels },
                    ].map((s) => (
                      <div key={s.label} style={statMiniStyle}>
                        <Text as="p" variant="headingMd" fontWeight="bold">{s.value.toLocaleString()}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
                      </div>
                    ))}
                  </div>
                </BlockStack>
              </Card>

              {/* Shopify Sync Status */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={ExportIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingSm">Shopify Sync</Text>
                    </InlineStack>
                    <Button onClick={() => navigate("/app/push")} variant="plain" size="slim">Push page</Button>
                  </InlineStack>
                  <div style={statGridStyle(2)}>
                    {[
                      { label: "Products Pushed", value: livePushedProducts },
                      { label: "Pending Push", value: Math.max(0, liveMapped - livePushedProducts) },
                      { label: "Collections", value: liveCollectionCount },
                      { label: "Active Makes", value: liveActiveMakes },
                      { label: "Vehicle Pages", value: liveVehiclePages },
                      { label: "Coverage", value: `${coverage}%` as unknown as number },
                    ].map((s) => (
                      <div key={s.label} style={statMiniStyle}>
                        <Text as="p" variant="headingMd" fontWeight="bold">{typeof s.value === 'number' ? s.value.toLocaleString() : s.value}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
                      </div>
                    ))}
                  </div>
                </BlockStack>
              </Card>

              {/* Plan & Resources */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={StarFilledIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingSm">{`${planName} Plan`}</Text>
                    </InlineStack>
                    <Button onClick={() => navigate("/app/plans")} variant="plain" size="slim">{plan === "enterprise" ? "View plan" : "Upgrade"}</Button>
                  </InlineStack>
                  <div style={statGridStyle(2)}>
                    {[
                      { label: "Price", value: planPrice },
                      { label: "Providers", value: String(providerCount) },
                      { label: "Product Limit", value: limits.products === Infinity ? "Unlimited" : limits.products.toLocaleString() },
                      { label: "Fitment Limit", value: limits.fitments === Infinity ? "Unlimited" : limits.fitments.toLocaleString() },
                    ].map((s) => (
                      <div key={s.label} style={statMiniStyle}>
                        <Text as="p" variant="headingMd" fontWeight="bold">{s.value}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">{s.label}</Text>
                      </div>
                    ))}
                  </div>
                </BlockStack>
              </Card>
            </InlineGrid>

            {/* ─── Fitment Coverage — Hero Card ─── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={GaugeIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">Fitment Coverage</Text>
                  </InlineStack>
                  <InlineStack gap="300" blockAlign="center">
                    <Text as="span" variant="heading2xl" fontWeight="bold">
                      {`${coverage}%`}
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      {`${liveMapped.toLocaleString()} of ${liveTotalProducts.toLocaleString()} products mapped`}
                    </Text>
                  </InlineStack>
                </InlineStack>

                <ProgressBar progress={coverage} size="small" />

                {/* Compact status chips — unified icon style */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--p-space-200)" }}>
                  {([
                    { icon: AlertCircleIcon, label: "Flagged", count: needsReview, status: "flagged" },
                    { icon: MinusCircleIcon, label: "No Vehicle Data", count: s.noMatch, status: "no_match" },
                    { icon: CheckCircleIcon, label: "Auto Mapped", count: liveAutoMapped, status: "auto_mapped" },
                    { icon: WandIcon, label: "Smart Mapped", count: liveSmartMapped, status: "smart_mapped" },
                    { icon: TargetIcon, label: "Manual Mapped", count: s.manualMapped, status: "manual_mapped" },
                  ] as const).map((item) => (
                    <StatusChip
                      key={item.status}
                      icon={item.icon}
                      label={item.label}
                      count={item.count}
                      bg="var(--p-color-bg-surface-secondary)"
                      color="var(--p-color-icon-emphasis)"
                      onClick={() => navigate(`/app/products?status=${item.status}`)}
                    />
                  ))}
                </div>

                {(liveUnmapped > 0 || liveFlagged > 0) && (
                  <>
                    <Divider />
                    <InlineStack gap="200">
                      <Button onClick={() => navigate("/app/fitment")} size="slim">
                        Auto Extract
                      </Button>
                      <Button onClick={() => navigate("/app/fitment/manual")} size="slim" variant="plain">
                        Manual Map
                      </Button>
                    </InlineStack>
                  </>
                )}
              </BlockStack>
            </Card>

            {/* ─── Info Cards: Top Makes + YMME + Providers ─── */}
            <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
              {/* Top Makes */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={TargetIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingMd">Top Makes</Text>
                    </InlineStack>
                    <Button onClick={() => navigate("/app/vehicles")} variant="plain" size="slim">
                      Browse all
                    </Button>
                  </InlineStack>
                  <Divider />

                  {topMakes.length === 0 ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      No fitment data yet. Extract fitments to see make distribution.
                    </Text>
                  ) : (
                    <BlockStack gap="200">
                      {topMakes.map((make, index) => (
                        <InlineStack key={make.name} align="space-between" blockAlign="center">
                          <InlineStack gap="200" blockAlign="center">
                            <Text as="span" variant="bodySm" tone="subdued">
                              {`${index + 1}.`}
                            </Text>
                            <Text as="span" variant="bodyMd">{make.name}</Text>
                          </InlineStack>
                          <Badge tone="info">{make.count.toLocaleString()}</Badge>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              {/* YMME Database */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={DatabaseIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingMd">YMME Database</Text>
                    </InlineStack>
                    <Button onClick={() => navigate("/app/vehicles")} variant="plain" size="slim">
                      Browse
                    </Button>
                  </InlineStack>
                  <Divider />

                  <div style={{
                    ...statGridStyle(2),
                    gap: "var(--p-space-300)",
                  }}>
                    {[
                      { label: "Makes", value: ymmeMakes },
                      { label: "Models", value: ymmeModels },
                      { label: "Engines", value: ymmeEngines },
                      { label: "Vehicle Specs", value: ymmeSpecs },
                    ].map((stat) => (
                      <div key={stat.label} style={statMiniStyle}>
                        <BlockStack gap="050">
                          <Text as="p" variant="headingMd" fontWeight="bold">
                            {stat.value.toLocaleString()}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {stat.label}
                          </Text>
                        </BlockStack>
                      </div>
                    ))}
                  </div>

                  <Text as="p" variant="bodySm" tone="subdued">
                    Global vehicle database with full specs. Continuously updated.
                  </Text>
                </BlockStack>
              </Card>

              {/* Providers */}
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={PackageIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingMd">Providers</Text>
                    </InlineStack>
                    <Button onClick={() => navigate("/app/providers")} variant="plain" size="slim">
                      Manage
                    </Button>
                  </InlineStack>
                  <Divider />

                  {providers.length === 0 ? (
                    <BlockStack gap="300">
                      <Text as="p" variant="bodySm" tone="subdued">
                        {limits.providers === 0
                          ? "Providers are available on the Starter plan and above. Upgrade to import product data from CSV, API, or FTP sources."
                          : "No providers configured. Add a CSV, API, or FTP provider to import product data from suppliers."}
                      </Text>
                      {limits.providers > 0 && (
                        <Button onClick={() => navigate("/app/providers/new")} size="slim">
                          Add Provider
                        </Button>
                      )}
                    </BlockStack>
                  ) : (
                    <BlockStack gap="200">
                      {providers.map((p: any) => (
                        <div
                          key={p.id}
                          style={{ ...statMiniStyle, display: "flex", alignItems: "center", justifyContent: "space-between" }}
                        >
                          <BlockStack gap="050">
                            <Text as="span" variant="bodyMd" fontWeight="medium">
                              {p.name}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {`${p.type.toUpperCase()} \u00B7 ${p.product_count ?? 0} products`}
                            </Text>
                          </BlockStack>
                          <Badge tone={p.status === "active" ? "success" : undefined}>
                            {p.status ?? "pending"}
                          </Badge>
                        </div>
                      ))}
                      {providers.length >= 3 && (
                        <Button onClick={() => navigate("/app/providers")} size="slim" variant="plain">
                          {`View all ${providerCount} providers`}
                        </Button>
                      )}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </InlineGrid>

            {/* ─── Recent Activity — Full Width Timeline ─── */}
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={ClockIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">Recent Activity</Text>
                  </InlineStack>
                  <Button onClick={() => navigate("/app/analytics")} variant="plain" size="slim">
                    View analytics
                  </Button>
                </InlineStack>
                <Divider />

                {recentJobs.length === 0 ? (
                  <Text as="p" variant="bodySm" tone="subdued">
                    No activity yet. Run your first pipeline to see results here.
                  </Text>
                ) : (
                  <div style={tableContainerStyle}>
                    {recentJobs.map((job: any) => (
                      <div
                        key={job.id}
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--p-space-300)", padding: "var(--p-space-200) var(--p-space-400)", background: "var(--p-color-bg-surface)" }}
                      >
                        <InlineStack gap="300" blockAlign="center" wrap={false}>
                          <div style={statusDotStyle(job.status)} />
                          <BlockStack gap="050">
                            <Text as="span" variant="bodySm" fontWeight="medium">
                              {formatJobType(job.type)}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {formatDate(job.completed_at ?? job.created_at)}
                              {job.total_items
                                ? ` \u00B7 ${job.processed_items ?? 0}/${job.total_items}`
                                : ""}
                            </Text>
                          </BlockStack>
                        </InlineStack>
                        <Badge tone={STATUS_TONES[job.status]}>
                          {job.status === "completed" ? "Done" : job.status.charAt(0).toUpperCase() + job.status.slice(1)}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </BlockStack>
            </Card>

            {/* ─── Plan Usage ─── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={StarFilledIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">
                      {`${planLabel} Plan`}
                    </Text>
                  </InlineStack>
                  <InlineStack gap="200" blockAlign="center">
                    <Text as="span" variant="headingLg" fontWeight="bold">
                      {planPrice}
                    </Text>
                    {plan !== "free" && (
                      <Text as="span" variant="bodySm" tone="subdued">/mo</Text>
                    )}
                    <Button onClick={() => navigate("/app/plans")} size="slim" variant="plain">
                      {plan === "enterprise" ? "View plan" : "Upgrade"}
                    </Button>
                  </InlineStack>
                </InlineStack>
                <Divider />

                {/* Usage meters */}
                <Text as="h3" variant="headingSm">Usage</Text>
                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">Products</Text>
                      <Text as="span" variant="bodyMd" tone="subdued">
                        {`${liveTotalProducts.toLocaleString()} / ${limits.products === Infinity ? "\u221E" : limits.products.toLocaleString()}`}
                      </Text>
                    </InlineStack>
                    {limits.products !== Infinity && (
                      <ProgressBar
                        progress={productUsagePercent}
                        size="small"
                        tone={productUsagePercent >= 90 ? "critical" : "primary"}
                      />
                    )}
                  </BlockStack>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">Fitments</Text>
                      <Text as="span" variant="bodyMd" tone="subdued">
                        {`${liveFitmentCount.toLocaleString()} / ${limits.fitments === Infinity ? "\u221E" : limits.fitments.toLocaleString()}`}
                      </Text>
                    </InlineStack>
                    {limits.fitments !== Infinity && (
                      <ProgressBar
                        progress={fitmentUsagePercent}
                        size="small"
                        tone={fitmentUsagePercent >= 90 ? "critical" : "primary"}
                      />
                    )}
                  </BlockStack>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">Providers</Text>
                      <Text as="span" variant="bodyMd" tone="subdued">
                        {`${providerCount} / ${limits.providers === Infinity ? "\u221E" : String(limits.providers)}`}
                      </Text>
                    </InlineStack>
                    {limits.providers !== Infinity && limits.providers > 0 && (
                      <ProgressBar
                        progress={Math.min(100, Math.round((providerCount / limits.providers) * 100))}
                        size="small"
                        tone={providerCount >= limits.providers ? "critical" : "primary"}
                      />
                    )}
                  </BlockStack>
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">Collections</Text>
                      <Text as="span" variant="bodyMd" tone="subdued">
                        {liveCollectionCount.toLocaleString()}
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </InlineGrid>

                <Divider />

                {/* Feature summary */}
                <Text as="h3" variant="headingSm">Included Features</Text>
                <div style={autoFitGridStyle("200px", "8px")}>
                  {([
                    { label: "Push Tags", on: limits.features.pushTags },
                    { label: "Push Metafields", on: limits.features.pushMetafields },
                    { label: "Auto Extraction", on: limits.features.autoExtraction },
                    { label: "Bulk Operations", on: limits.features.bulkOperations },
                    { label: "Smart Collections", on: !!limits.features.smartCollections },
                    { label: "Collection SEO Images", on: limits.features.collectionSeoImages },
                    { label: "API Integration", on: limits.features.apiIntegration },
                    { label: "FTP Import", on: limits.features.ftpImport },
                    { label: "YMME Widget", on: limits.features.ymmeWidget },
                    { label: "Fitment Badge", on: limits.features.fitmentBadge },
                    { label: "Compatibility Table", on: limits.features.compatibilityTable },
                    { label: "My Garage", on: limits.features.myGarage },
                    { label: "Wheel Finder", on: limits.features.wheelFinder },
                    { label: "Plate Lookup", on: limits.features.plateLookup },
                    { label: "VIN Decode", on: limits.features.vinDecode },
                    { label: "Pricing Engine", on: limits.features.pricingEngine },
                    { label: "Vehicle Pages", on: limits.features.vehiclePages },
                  ] as const).map((feat) => (
                    <div key={feat.label} style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--p-space-200)",
                      padding: "var(--p-space-100) var(--p-space-200)",
                      borderRadius: "var(--p-border-radius-200)",
                      background: feat.on
                        ? "var(--p-color-bg-surface-secondary)"
                        : "transparent",
                      opacity: feat.on ? 1 : 0.45,
                    }}>
                      <span style={{
                        fontSize: "14px",
                        color: feat.on
                          ? "var(--p-color-text-success)"
                          : "var(--p-color-text-secondary)",
                        lineHeight: 1,
                      }}>
                        {feat.on ? "\u2713" : "\u2715"}
                      </span>
                      <Text as="span" variant="bodySm" tone={feat.on ? undefined : "subdued"}>
                        {feat.label}
                      </Text>
                    </div>
                  ))}
                </div>

                {/* Extra details row */}
                <Divider />
                <InlineGrid columns={{ xs: 2, sm: 4 }} gap="300">
                  <BlockStack gap="050">
                    <Text as="p" variant="bodySm" tone="subdued">Analytics</Text>
                    <Text as="p" variant="bodyMd" fontWeight="medium">
                      {limits.features.dashboardAnalytics === "none"
                        ? "None"
                        : limits.features.dashboardAnalytics === "basic"
                          ? "Basic"
                          : limits.features.dashboardAnalytics === "full_export"
                            ? "Full + Export"
                            : "Full"}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="050">
                    <Text as="p" variant="bodySm" tone="subdued">Collections</Text>
                    <Text as="p" variant="bodyMd" fontWeight="medium">
                      {!limits.features.smartCollections
                        ? "None"
                        : limits.features.smartCollections === "make"
                          ? "By Make"
                          : limits.features.smartCollections === "make_model"
                            ? "Make + Model"
                            : "Full"}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="050">
                    <Text as="p" variant="bodySm" tone="subdued">Widget Styling</Text>
                    <Text as="p" variant="bodyMd" fontWeight="medium">
                      {limits.features.widgetCustomisation === "none"
                        ? "None"
                        : limits.features.widgetCustomisation === "basic"
                          ? "Basic"
                          : "Full CSS"}
                    </Text>
                  </BlockStack>
                  <BlockStack gap="050">
                    <Text as="p" variant="bodySm" tone="subdued">Scheduled Fetches</Text>
                    <Text as="p" variant="bodyMd" fontWeight="medium">
                      {limits.scheduledFetchesPerDay === Infinity
                        ? "Unlimited"
                        : limits.scheduledFetchesPerDay === 0
                          ? "None"
                          : `${limits.scheduledFetchesPerDay}/day`}
                    </Text>
                  </BlockStack>
                </InlineGrid>

                {plan !== "enterprise" && (
                  <>
                    <Divider />
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Upgrade to unlock more features and higher limits
                      </Text>
                      <Button onClick={() => navigate("/app/plans")} size="slim">
                        Compare Plans
                      </Button>
                    </InlineStack>
                  </>
                )}
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}


export function ErrorBoundary() {
  return <RouteError pageName="Dashboard" />;
}
