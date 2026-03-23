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
  Icon,
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
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getPlanLimits, getPlanConfigs } from "../lib/billing.server";
import type { PlanTier } from "../lib/types";
import { OnboardingChecklist } from "../components/OnboardingChecklist";
import { IconBadge } from "../components/IconBadge";
import { ActiveJobsPanel } from "../components/ActiveJobsPanel";
import { SkeletonCard } from "../components/SkeletonCard";
import { useAppData, computeFromStats } from "../lib/use-app-data";
import { statMiniStyle, statGridStyle, STATUS_TONES, statusDotStyle, listRowStyle, tableContainerStyle } from "../lib/design";

// ---------------------------------------------------------------------------
// Loader — aggregate ALL system stats for the dashboard
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Run ALL dashboard queries in parallel for maximum speed
  const [
    tenantResult,
    pushCountResult,
    // Product status breakdown
    totalProductsResult,
    unmappedResult,
    autoMappedResult,
    smartMappedResult,
    manualMappedResult,
    flaggedResult,
    // Fitment stats
    fitmentCountResult,
    topMakesResult,
    // Provider stats
    providerCountResult,
    providerListResult,
    // Collection stats
    collectionCountResult,
    // Recent activity
    recentJobsResult,
    // YMME database stats
    ymmeMakesResult,
    ymmeModelsResult,
    ymmeEnginesResult,
    ymmeSpecsResult,
    pushedProductsResult,
    activeMakesResult,
    vehiclePagesResult,
  ] = await Promise.all([
    db.from("tenants").select("*").eq("shop_id", shopId).maybeSingle(),
    db.from("sync_jobs")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("type", "push")
      .eq("status", "completed"),
    // Product counts by status
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "unmapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "auto_mapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "smart_mapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "manual_mapped"),
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "flagged"),
    // Fitment count
    db.from("vehicle_fitments").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    // Top makes by fitment count (using text make field for reliability)
    db.from("vehicle_fitments")
      .select("make")
      .eq("shop_id", shopId)
      .not("make", "is", null),
    // Providers
    db.from("providers").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("providers").select("id, name, type, status, product_count, last_fetch_at").eq("shop_id", shopId).order("created_at", { ascending: false }).limit(5),
    // Collections
    db.from("collection_mappings").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    // Recent jobs
    db.from("sync_jobs")
      .select("id, type, status, total_items, processed_items, completed_at, created_at")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false })
      .limit(10),
    // YMME stats (global, not tenant-specific)
    db.from("ymme_makes").select("id", { count: "exact", head: true }),
    db.from("ymme_models").select("id", { count: "exact", head: true }),
    db.from("ymme_engines").select("id", { count: "exact", head: true }),
    db.from("ymme_vehicle_specs").select("id", { count: "exact", head: true }),
    // Push + active makes + vehicle pages
    db.from("products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).not("synced_at", "is", null),
    db.from("tenant_active_makes").select("ymme_make_id", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("vehicle_page_sync").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("sync_status", "synced"),
  ]);

  const tenant = tenantResult.data;
  const plan = (tenant?.plan ?? "free") as PlanTier;
  const limits = getPlanLimits(plan);
  const isFirstTime = !tenant;

  // Product breakdown
  const totalProducts = totalProductsResult.count ?? 0;
  const unmapped = unmappedResult.count ?? 0;
  const autoMapped = autoMappedResult.count ?? 0;
  const smartMapped = smartMappedResult.count ?? 0;
  const manualMapped = manualMappedResult.count ?? 0;
  const flagged = flaggedResult.count ?? 0;
  const mapped = autoMapped + smartMapped + manualMapped;

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

  const fitmentCount = fitmentCountResult.count ?? 0;

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
    hasPushed: (pushCountResult.count ?? 0) > 0,
    // Products
    totalProducts,
    unmapped,
    autoMapped,
    smartMapped,
    manualMapped,
    flagged,
    mapped,
    // Fitments
    fitmentCount,
    topMakes,
    // Providers
    providerCount: providerCountResult.count ?? 0,
    providers: providerListResult.data ?? [],
    // Collections
    collectionCount: collectionCountResult.count ?? 0,
    // Recent activity
    recentJobs: recentJobsResult.data ?? [],
    // YMME
    ymmeMakes: ymmeMakesResult.count ?? 0,
    ymmeModels: ymmeModelsResult.count ?? 0,
    ymmeEngines: ymmeEnginesResult.count ?? 0,
    ymmeSpecs: ymmeSpecsResult.count ?? 0,
    // Push + sync stats
    pushedProducts: pushedProductsResult.count ?? 0,
    activeMakes: activeMakesResult.count ?? 0,
    vehiclePagesSynced: vehiclePagesResult.count ?? 0,
    // Unique makes/models from fitments (topMakes already has all makes)
    uniqueMakes: topMakes.length,
    uniqueModels: 0, // Will be filled by live polling
  };
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "\u2014";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatJobType(type: string): string {
  const labels: Record<string, string> = {
    fetch: "Fetch Products",
    extract: "Auto Extract",
    push: "Push to Shopify",
    collections: "Create Collections",
  };
  return labels[type] ?? type;
}

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
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "var(--p-border-radius-200)",
                background: primary
                  ? "var(--p-color-bg-fill-emphasis)"
                  : "var(--p-color-bg-surface-secondary)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: primary
                  ? "var(--p-color-text-inverse)"
                  : "var(--p-color-icon-emphasis)",
              }}
            >
              <Icon source={icon} />
            </div>
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
        gap: "10px",
        padding: "12px 16px",
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
  const { stats: liveData, isLoading: dataLoading } = useAppData({
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
  const { mapped: liveMapped, needsReview, coverage, pendingPush } = computeFromStats(s);
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

  return (
    <Page title="Dashboard" fullWidth>
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
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
                  {(liveUnmapped + liveFlagged) > 0 && (
                    <Badge tone="warning">
                      {`${(liveUnmapped + liveFlagged).toLocaleString()} need review`}
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
                    badge={(liveUnmapped + liveFlagged) > 0 ? { content: `${(liveUnmapped + liveFlagged).toLocaleString()} pending`, tone: "warning" } : undefined}
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
            <ActiveJobsPanel navigate={navigate} />

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
                      { label: "Needs Review", value: liveUnmapped + liveFlagged },
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
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                  {([
                    { icon: AlertCircleIcon, label: "Needs Review", count: liveUnmapped + liveFlagged, status: "unmapped" },
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
                    gap: "12px",
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
                        No providers configured. Add a CSV, API, or FTP provider to import product data from suppliers.
                      </Text>
                      <Button onClick={() => navigate("/app/providers/new")} size="slim">
                        Add Provider
                      </Button>
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
                        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px 16px", background: "var(--p-color-bg-surface)" }}
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
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                  gap: "8px",
                }}>
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
                    { label: "Floating Bar", on: limits.features.floatingBar },
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
                      gap: "8px",
                      padding: "6px 10px",
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
