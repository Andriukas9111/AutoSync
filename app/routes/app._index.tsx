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
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getPlanLimits } from "../lib/billing.server";
import type { PlanTier } from "../lib/types";
import { OnboardingChecklist } from "../components/OnboardingChecklist";
import { IconBadge } from "../components/IconBadge";

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
      .limit(8),
    // YMME stats (global, not tenant-specific)
    db.from("ymme_makes").select("id", { count: "exact", head: true }),
    db.from("ymme_models").select("id", { count: "exact", head: true }),
    db.from("ymme_engines").select("id", { count: "exact", head: true }),
    db.from("ymme_vehicle_specs").select("id", { count: "exact", head: true }),
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

  return {
    shopId,
    plan,
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

const JOB_STATUS_TONE: Record<string, "success" | "info" | "warning" | "critical" | undefined> = {
  completed: "success",
  running: "info",
  pending: undefined,
  failed: "critical",
};

const JOB_STATUS_ICON: Record<string, string> = {
  completed: "\u2713",
  running: "\u25CF",
  pending: "\u25CB",
  failed: "\u2717",
};

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
// Component
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const {
    plan,
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
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();
  const [showWelcome, setShowWelcome] = useState(true);

  const coverage = totalProducts > 0 ? Math.round((mapped / totalProducts) * 100) : 0;
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
  const showOnboarding = totalProducts < 1 || fitmentCount < 1;

  const productUsagePercent =
    limits.products === Infinity ? 0 : Math.min(100, Math.round((totalProducts / limits.products) * 100));
  const fitmentUsagePercent =
    limits.fitments === Infinity ? 0 : Math.min(100, Math.round((fitmentCount / limits.fitments) * 100));

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

            {/* ─── Quick Actions (TOP — most important) ─── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h2" variant="headingMd">
                    Quick Actions
                  </Text>
                  {unmapped > 0 && (
                    <Badge tone="warning">
                      {`${unmapped} unmapped`}
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
                    badge={unmapped > 0 ? { content: `${unmapped} pending`, tone: "warning" } : undefined}
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
                    badge={collectionCount > 0 ? { content: `${collectionCount}`, tone: "info" } : undefined}
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

            {/* Onboarding checklist */}
            {showOnboarding && (
              <OnboardingChecklist
                productCount={totalProducts}
                fitmentCount={fitmentCount}
                hasPushed={hasPushed}
                collectionCount={collectionCount}
              />
            )}

            {/* ─── KPI Metrics Row ─── */}
            {(() => {
              const planPrice = plan === "free" ? "$0" : plan === "starter" ? "$19" : plan === "growth" ? "$49" : plan === "professional" ? "$99" : plan === "business" ? "$179" : "$299";
              const statItems = [
                { icon: ProductIcon, count: totalProducts.toLocaleString(), label: "Products", link: "/app/products", linkLabel: "View all" },
                { icon: ConnectIcon, count: fitmentCount.toLocaleString(), label: "Fitments", link: "/app/fitment", linkLabel: "View fitments" },
                { icon: GaugeIcon, count: `${coverage}%`, label: "Coverage", link: "/app/products", linkLabel: "View products" },
                { icon: CollectionIcon, count: collectionCount.toLocaleString(), label: "Collections", link: "/app/collections", linkLabel: "Manage" },
                { icon: PackageIcon, count: String(providerCount), label: "Providers", link: "/app/providers", linkLabel: "Manage" },
                { icon: StarFilledIcon, count: planPrice, label: "Plan", link: "/app/plans", linkLabel: plan === "enterprise" ? "View plan" : "Upgrade" },
              ];
              const lastIndex = statItems.length - 1;
              return (
                <Card padding="0">
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                  }}>
                    {statItems.map((item, i) => (
                      <div key={item.label} style={{
                        padding: "var(--p-space-400)",
                        borderRight: i < lastIndex ? "1px solid var(--p-color-border-secondary)" : "none",
                        textAlign: "center",
                      }}>
                        <BlockStack gap="200" inlineAlign="center">
                          <IconBadge icon={item.icon} color="var(--p-color-icon-emphasis)" />
                          <Text as="p" variant="headingLg" fontWeight="bold">
                            {item.count}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">
                            {item.label}
                          </Text>
                          <Button
                            onClick={() => navigate(item.link)}
                            variant="plain"
                            size="slim"
                          >
                            {item.linkLabel}
                          </Button>
                        </BlockStack>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })()}

            {/* ─── Product Status + Recent Activity ─── */}
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              {/* Product Status Breakdown */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={ProductIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingMd">
                        Product Status
                      </Text>
                    </InlineStack>
                    <Button
                      onClick={() => navigate("/app/products")}
                      variant="plain"
                    >
                      View all
                    </Button>
                  </InlineStack>
                  <Divider />

                  {totalProducts === 0 ? (
                    <Text as="p" variant="bodyMd" tone="subdued">
                      No products yet. Fetch products from Shopify to get
                      started.
                    </Text>
                  ) : (
                    <BlockStack gap="300">
                      {/* Unmapped */}
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                      >
                        <InlineStack gap="200" blockAlign="center">
                          <IconBadge icon={AlertCircleIcon} size={22} bg="var(--p-color-bg-fill-caution-secondary)" color="var(--p-color-icon-caution)" />
                          <Text as="span" variant="bodyMd">
                            Unmapped
                          </Text>
                        </InlineStack>
                        <InlineStack gap="200" blockAlign="center">
                          <Text
                            as="span"
                            variant="bodyMd"
                            fontWeight="semibold"
                          >
                            {unmapped}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {totalProducts > 0
                              ? `${Math.round((unmapped / totalProducts) * 100)}%`
                              : "0%"}
                          </Text>
                        </InlineStack>
                      </InlineStack>

                      {/* Auto Mapped */}
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                      >
                        <InlineStack gap="200" blockAlign="center">
                          <IconBadge icon={CheckCircleIcon} size={22} bg="var(--p-color-bg-fill-success-secondary)" color="var(--p-color-icon-success)" />
                          <Text as="span" variant="bodyMd">
                            Auto Mapped
                          </Text>
                        </InlineStack>
                        <InlineStack gap="200" blockAlign="center">
                          <Text
                            as="span"
                            variant="bodyMd"
                            fontWeight="semibold"
                          >
                            {autoMapped}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {totalProducts > 0
                              ? `${Math.round((autoMapped / totalProducts) * 100)}%`
                              : "0%"}
                          </Text>
                        </InlineStack>
                      </InlineStack>

                      {/* Smart Mapped */}
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                      >
                        <InlineStack gap="200" blockAlign="center">
                          <IconBadge icon={WandIcon} size={22} bg="var(--p-color-bg-fill-success-secondary)" color="var(--p-color-icon-success)" />
                          <Text as="span" variant="bodyMd">
                            Smart Mapped
                          </Text>
                        </InlineStack>
                        <InlineStack gap="200" blockAlign="center">
                          <Text
                            as="span"
                            variant="bodyMd"
                            fontWeight="semibold"
                          >
                            {smartMapped}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {totalProducts > 0
                              ? `${Math.round((smartMapped / totalProducts) * 100)}%`
                              : "0%"}
                          </Text>
                        </InlineStack>
                      </InlineStack>

                      {/* Manual Mapped */}
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                      >
                        <InlineStack gap="200" blockAlign="center">
                          <IconBadge icon={TargetIcon} size={22} bg="var(--p-color-bg-fill-info-secondary)" color="var(--p-color-icon-info)" />
                          <Text as="span" variant="bodyMd">
                            Manual Mapped
                          </Text>
                        </InlineStack>
                        <InlineStack gap="200" blockAlign="center">
                          <Text
                            as="span"
                            variant="bodyMd"
                            fontWeight="semibold"
                          >
                            {manualMapped}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {totalProducts > 0
                              ? `${Math.round((manualMapped / totalProducts) * 100)}%`
                              : "0%"}
                          </Text>
                        </InlineStack>
                      </InlineStack>

                      {/* Flagged */}
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                      >
                        <InlineStack gap="200" blockAlign="center">
                          <IconBadge icon={AlertTriangleIcon} size={22} bg="var(--p-color-bg-fill-warning-secondary)" color="var(--p-color-icon-warning)" />
                          <Text as="span" variant="bodyMd">
                            Flagged for Review
                          </Text>
                        </InlineStack>
                        <InlineStack gap="200" blockAlign="center">
                          <Text
                            as="span"
                            variant="bodyMd"
                            fontWeight="semibold"
                          >
                            {flagged}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {totalProducts > 0
                              ? `${Math.round((flagged / totalProducts) * 100)}%`
                              : "0%"}
                          </Text>
                        </InlineStack>
                      </InlineStack>

                      <Divider />
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                      >
                        <Text
                          as="span"
                          variant="bodyMd"
                          fontWeight="semibold"
                        >
                          Total Mapped
                        </Text>
                        <Badge tone={coverage >= 80 ? "success" : "info"}>
                          {`${mapped} / ${totalProducts} (${coverage}%)`}
                        </Badge>
                      </InlineStack>

                      {unmapped > 0 && (
                        <InlineStack gap="200">
                          <Button
                            onClick={() => navigate("/app/fitment")}
                            size="slim"
                          >
                            Auto Extract
                          </Button>
                          <Button
                            onClick={() => navigate("/app/fitment/manual")}
                            size="slim"
                            variant="plain"
                          >
                            Manual Map
                          </Button>
                        </InlineStack>
                      )}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              {/* Recent Activity */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={ChartVerticalIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">
                      Recent Activity
                    </Text>
                  </InlineStack>
                  <Divider />

                  {recentJobs.length === 0 ? (
                    <Text as="p" variant="bodyMd" tone="subdued">
                      No activity yet. Run your first pipeline to see results
                      here.
                    </Text>
                  ) : (
                    <BlockStack gap="300">
                      {recentJobs.map((job: any) => (
                        <InlineStack
                          key={job.id}
                          align="space-between"
                          blockAlign="center"
                          wrap={false}
                        >
                          <InlineStack gap="300" blockAlign="center" wrap={false}>
                            <div
                              style={{
                                width: "24px",
                                height: "24px",
                                borderRadius: "50%",
                                background:
                                  job.status === "completed"
                                    ? "var(--p-color-bg-fill-success)"
                                    : job.status === "failed"
                                      ? "var(--p-color-bg-fill-critical)"
                                      : job.status === "running"
                                        ? "var(--p-color-bg-fill-info)"
                                        : "var(--p-color-bg-fill-secondary)",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: "var(--p-color-text-inverse)",
                                fontSize: "12px",
                                fontWeight: 700,
                                flexShrink: 0,
                              }}
                            >
                              {JOB_STATUS_ICON[job.status] ?? "\u25CB"}
                            </div>
                            <BlockStack gap="100">
                              <Text
                                as="span"
                                variant="bodyMd"
                                fontWeight="medium"
                              >
                                {formatJobType(job.type)}
                              </Text>
                              <Text
                                as="span"
                                variant="bodySm"
                                tone="subdued"
                              >
                                {formatDate(job.completed_at ?? job.created_at)}
                                {job.total_items
                                  ? ` \u00B7 ${job.processed_items ?? 0}/${job.total_items} items`
                                  : ""}
                              </Text>
                            </BlockStack>
                          </InlineStack>
                          <Badge tone={JOB_STATUS_TONE[job.status]}>
                            {job.status === "completed"
                              ? "Done"
                              : job.status.charAt(0).toUpperCase() +
                                job.status.slice(1)}
                          </Badge>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </InlineGrid>

            {/* ─── Top Makes + YMME Database + Providers ─── */}
            <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
              {/* Top Makes */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={TargetIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingMd">
                        Top Makes
                      </Text>
                    </InlineStack>
                    <Button
                      onClick={() => navigate("/app/vehicles")}
                      variant="plain"
                    >
                      Browse all
                    </Button>
                  </InlineStack>
                  <Divider />

                  {topMakes.length === 0 ? (
                    <Text as="p" variant="bodyMd" tone="subdued">
                      No fitment data yet. Extract fitments to see make
                      distribution.
                    </Text>
                  ) : (
                    <BlockStack gap="200">
                      {topMakes.map((make, index) => (
                        <InlineStack
                          key={make.name}
                          align="space-between"
                          blockAlign="center"
                        >
                          <InlineStack gap="200" blockAlign="center">
                            <Text
                              as="span"
                              variant="bodySm"
                              tone="subdued"
                            >
                              {index + 1}.
                            </Text>
                            <Text as="span" variant="bodyMd">
                              {make.name}
                            </Text>
                          </InlineStack>
                          <Badge tone="info">
                            {make.count.toLocaleString()}
                          </Badge>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>

              {/* YMME Database */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={DatabaseIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingMd">
                        YMME Database
                      </Text>
                    </InlineStack>
                    <Button
                      onClick={() => navigate("/app/vehicles")}
                      variant="plain"
                    >
                      Browse
                    </Button>
                  </InlineStack>
                  <Divider />

                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodyMd">
                        Makes
                      </Text>
                      <Text
                        as="span"
                        variant="bodyMd"
                        fontWeight="semibold"
                      >
                        {ymmeMakes.toLocaleString()}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodyMd">
                        Models
                      </Text>
                      <Text
                        as="span"
                        variant="bodyMd"
                        fontWeight="semibold"
                      >
                        {ymmeModels.toLocaleString()}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodyMd">
                        Engines
                      </Text>
                      <Text
                        as="span"
                        variant="bodyMd"
                        fontWeight="semibold"
                      >
                        {ymmeEngines.toLocaleString()}
                      </Text>
                    </InlineStack>
                    <InlineStack align="space-between" blockAlign="center">
                      <Text as="span" variant="bodyMd">
                        Vehicle Specs
                      </Text>
                      <Text
                        as="span"
                        variant="bodyMd"
                        fontWeight="semibold"
                      >
                        {ymmeSpecs.toLocaleString()}
                      </Text>
                    </InlineStack>

                    <Divider />
                    <Text as="p" variant="bodySm" tone="subdued">
                      Comprehensive global vehicle database with full specs
                      including performance, dimensions, engine details, and
                      EV data. Continuously updated.
                    </Text>
                  </BlockStack>
                </BlockStack>
              </Card>

              {/* Providers */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={PackageIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingMd">
                        Providers
                      </Text>
                    </InlineStack>
                    <Button
                      onClick={() => navigate("/app/providers")}
                      variant="plain"
                    >
                      Manage
                    </Button>
                  </InlineStack>
                  <Divider />

                  {providers.length === 0 ? (
                    <BlockStack gap="300">
                      <Text as="p" variant="bodyMd" tone="subdued">
                        No providers configured. Add a CSV, API, or FTP
                        provider to import product data from suppliers.
                      </Text>
                      <Button
                        onClick={() => navigate("/app/providers/new")}
                        size="slim"
                      >
                        Add Provider
                      </Button>
                    </BlockStack>
                  ) : (
                    <BlockStack gap="200">
                      {providers.map((p: any) => (
                        <InlineStack
                          key={p.id}
                          align="space-between"
                          blockAlign="center"
                        >
                          <BlockStack gap="050">
                            <Text
                              as="span"
                              variant="bodyMd"
                              fontWeight="medium"
                            >
                              {p.name}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {p.type.toUpperCase()} \u00B7{" "}
                              {p.product_count ?? 0} products
                            </Text>
                          </BlockStack>
                          <Badge
                            tone={
                              p.status === "active" ? "success" : undefined
                            }
                          >
                            {p.status ?? "pending"}
                          </Badge>
                        </InlineStack>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </InlineGrid>

            {/* ─── Plan Usage ─── */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={StarFilledIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">
                      Plan Usage
                    </Text>
                  </InlineStack>
                  <Badge tone={plan === "free" ? "warning" : "success"}>
                    {planLabel}
                  </Badge>
                </InlineStack>
                <Divider />

                <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                  {/* Product usage */}
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        Products
                      </Text>
                      <Text as="span" variant="bodyMd" tone="subdued">
                        {totalProducts.toLocaleString()} /{" "}
                        {limits.products === Infinity
                          ? "\u221E"
                          : limits.products.toLocaleString()}
                      </Text>
                    </InlineStack>
                    {limits.products !== Infinity && (
                      <ProgressBar
                        progress={productUsagePercent}
                        size="small"
                        tone={
                          productUsagePercent >= 90 ? "critical" : "primary"
                        }
                      />
                    )}
                  </BlockStack>

                  {/* Fitment usage */}
                  <BlockStack gap="200">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodyMd">
                        Fitments
                      </Text>
                      <Text as="span" variant="bodyMd" tone="subdued">
                        {fitmentCount.toLocaleString()} /{" "}
                        {limits.fitments === Infinity
                          ? "\u221E"
                          : limits.fitments.toLocaleString()}
                      </Text>
                    </InlineStack>
                    {limits.fitments !== Infinity && (
                      <ProgressBar
                        progress={fitmentUsagePercent}
                        size="small"
                        tone={
                          fitmentUsagePercent >= 90 ? "critical" : "primary"
                        }
                      />
                    )}
                  </BlockStack>
                </InlineGrid>

                {plan === "free" && (
                  <>
                    <Divider />
                    <Banner
                      title="Upgrade your plan"
                      tone="warning"
                      action={{
                        content: "View Plans",
                        onAction: () => navigate("/app/plans"),
                      }}
                    >
                      <p>
                        You are on the Free plan with limited product and
                        fitment capacity. Upgrade to unlock auto-extraction,
                        collections, API providers, and more.
                      </p>
                    </Banner>
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
