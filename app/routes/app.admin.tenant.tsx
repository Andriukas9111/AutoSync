import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useFetcher, useNavigate, useSearchParams } from "react-router";
import { data } from "react-router";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Text,
  Badge,
  InlineStack,
  BlockStack,
  InlineGrid,
  Button,
  Banner,
  Divider,
  Box,
  Select,
  ProgressBar,
  Tabs,
  EmptyState,
  Thumbnail,
  Link,
  Icon,
} from "@shopify/polaris";
import {
  ProductIcon,
  LinkIcon,
  ChartVerticalFilledIcon,
  ConnectIcon,
  RefreshIcon,
} from "@shopify/polaris-icons";
import { DataTable } from "../components/DataTable";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { IconBadge } from "../components/IconBadge";
import type { PlanTier, FitmentStatus } from "../lib/types";
import { formatPrice } from "../lib/types";
import { isAdminShop } from "../lib/admin.server";
import { getPlanLimits } from "../lib/billing.server";
import { statMiniStyle, statGridStyle, listRowStyle } from "../lib/design";

const PLAN_BADGE_TONE: Record<PlanTier, "info" | "success" | "warning" | "critical" | "attention" | undefined> = {
  free: undefined,
  starter: "info",
  growth: "success",
  professional: "attention",
  business: "warning",
  enterprise: "critical",
};

const PLAN_DISPLAY_NAME: Record<PlanTier, string> = {
  free: "Free",
  starter: "Starter",
  growth: "Growth",
  professional: "Professional",
  business: "Business",
  enterprise: "Enterprise",
};

function capitalisePlan(plan: string): string {
  return PLAN_DISPLAY_NAME[plan as PlanTier] ?? plan.charAt(0).toUpperCase() + plan.slice(1);
}

const STATUS_BADGES: Record<string, { tone: "info" | "success" | "warning" | "critical" | undefined; label: string }> = {
  unmapped: { tone: undefined, label: "Unmapped" },
  auto_mapped: { tone: "info", label: "Auto Mapped" },
  smart_mapped: { tone: "success", label: "Smart Mapped" },
  manual_mapped: { tone: "success", label: "Manual" },
  partial: { tone: "warning", label: "Partial" },
  flagged: { tone: "critical", label: "Flagged" },
};

// ---------------------------------------------------------------------------
// Loader — fetches ALL data for a single tenant
// ---------------------------------------------------------------------------
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  if (!isAdminShop(session.shop)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const shopId = url.searchParams.get("shop");

  if (!shopId) {
    throw new Response("Missing shop parameter", { status: 400 });
  }

  // Fetch everything about this tenant in parallel
  const [
    tenantRes,
    productsRes,
    fitmentCountRes,
    recentFitmentsRes,
    syncJobsRes,
    providersRes,
    settingsRes,
    // Status breakdown counts
    unmappedRes,
    autoMappedRes,
    smartMappedRes,
    manualMappedRes,
    partialRes,
    flaggedRes,
    // Top makes used in fitments
    topMakesRes,
  ] = await Promise.all([
    db.from("tenants").select("*").eq("shop_id", shopId).single(),
    db.from("products")
      .select("id, title, handle, vendor, product_type, price, image_url, fitment_status, source, synced_at, created_at, shopify_product_id")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false })
      .limit(50),
    db.from("vehicle_fitments").select("*", { count: "exact", head: true }).eq("shop_id", shopId),
    db.from("vehicle_fitments")
      .select("id, make, model, year_from, year_to, engine, confidence, source, created_at, product_id")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false })
      .limit(30),
    db.from("sync_jobs")
      .select("id, type, status, progress, total_items, error, created_at, completed_at")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false })
      .limit(20),
    db.from("providers")
      .select("id, name, type, status, product_count, config, created_at")
      .eq("shop_id", shopId),
    db.from("app_settings").select("*").eq("shop_id", shopId).maybeSingle(),
    // Fitment status breakdown
    db.from("products").select("*", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "unmapped"),
    db.from("products").select("*", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "auto_mapped"),
    db.from("products").select("*", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "smart_mapped"),
    db.from("products").select("*", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "manual_mapped"),
    db.from("products").select("*", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "partial"),
    db.from("products").select("*", { count: "exact", head: true }).eq("shop_id", shopId).eq("fitment_status", "flagged"),
    // Top makes
    db.from("vehicle_fitments")
      .select("make")
      .eq("shop_id", shopId)
      .not("make", "is", null)
      .limit(500),
  ]);

  if (!tenantRes.data) {
    throw new Response(`Tenant not found: ${shopId}`, { status: 404 });
  }

  const tenant = tenantRes.data;
  const products = productsRes.data ?? [];
  const totalProducts = products.length; // from the 50 limit, but we'll use tenant counts
  const totalFitments = fitmentCountRes.count ?? 0;
  const recentFitments = recentFitmentsRes.data ?? [];
  const syncJobs = syncJobsRes.data ?? [];
  const providers = providersRes.data ?? [];
  const settings = settingsRes.data;

  const statusBreakdown = {
    unmapped: unmappedRes.count ?? 0,
    auto_mapped: autoMappedRes.count ?? 0,
    smart_mapped: smartMappedRes.count ?? 0,
    manual_mapped: manualMappedRes.count ?? 0,
    partial: partialRes.count ?? 0,
    flagged: flaggedRes.count ?? 0,
  };

  const totalProductCount = Object.values(statusBreakdown).reduce((a, b) => a + b, 0);
  const mappedCount = statusBreakdown.auto_mapped + statusBreakdown.smart_mapped + statusBreakdown.manual_mapped;
  const coveragePercent = totalProductCount > 0 ? Math.round((mappedCount / totalProductCount) * 100) : 0;

  // Count top makes from fitments
  const makeCounts: Record<string, number> = {};
  for (const f of (topMakesRes.data ?? []) as Array<{ make: string | null }>) {
    if (f.make) {
      makeCounts[f.make] = (makeCounts[f.make] ?? 0) + 1;
    }
  }
  const topMakes = Object.entries(makeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([make, count]) => ({ make, count }));

  // Get plan limits for this tenant
  const planLimits = getPlanLimits(tenant.plan ?? "free");

  return {
    tenant,
    products,
    totalFitments,
    recentFitments,
    syncJobs,
    providers,
    settings,
    statusBreakdown,
    totalProductCount,
    mappedCount,
    coveragePercent,
    topMakes,
    shopId,
    planLimits,
  };
};

// ---------------------------------------------------------------------------
// Action — tenant-specific admin operations
// ---------------------------------------------------------------------------
export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  if (!isAdminShop(session.shop)) {
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;
  const shopId = formData.get("shop_id") as string;

  if (!shopId) {
    return data({ ok: false, message: "Missing shop_id" });
  }

  switch (intent) {
    case "change-plan": {
      const newPlan = formData.get("new_plan") as PlanTier;
      const validPlans: PlanTier[] = ["free", "starter", "growth", "professional", "business", "enterprise"];
      if (!validPlans.includes(newPlan)) {
        return data({ ok: false, message: `Invalid plan: ${newPlan}` });
      }

      const { error } = await db.from("tenants").update({ plan: newPlan }).eq("shop_id", shopId);
      if (error) {
        return data({ ok: false, message: `Failed: ${error.message}` });
      }
      return data({ ok: true, message: `Plan changed to ${capitalisePlan(newPlan)}.` });
    }

    case "reset-settings": {
      const { error } = await db.from("app_settings").update({
        push_tags: true,
        push_metafields: true,
        collection_strategy: "none",
      }).eq("shop_id", shopId);

      if (error) {
        return data({ ok: false, message: `Failed: ${error.message}` });
      }
      return data({ ok: true, message: "Settings reset to defaults." });
    }

    case "update-counts": {
      // Re-count products and fitments for this tenant
      const [prodCount, fitCount] = await Promise.all([
        db.from("products").select("*", { count: "exact", head: true }).eq("shop_id", shopId),
        db.from("vehicle_fitments").select("*", { count: "exact", head: true }).eq("shop_id", shopId),
      ]);

      const { error } = await db.from("tenants").update({
        product_count: prodCount.count ?? 0,
        fitment_count: fitCount.count ?? 0,
      }).eq("shop_id", shopId);

      if (error) {
        return data({ ok: false, message: `Failed: ${error.message}` });
      }
      return data({
        ok: true,
        message: `Counts updated: ${prodCount.count ?? 0} products, ${fitCount.count ?? 0} fitments.`,
      });
    }

    case "purge-fitments": {
      const { error, count } = await db
        .from("vehicle_fitments")
        .delete()
        .eq("shop_id", shopId);

      if (error) {
        return data({ ok: false, message: `Failed: ${error.message}` });
      }

      // Reset all products to unmapped
      await db.from("products").update({ fitment_status: "unmapped" }).eq("shop_id", shopId);
      // Update tenant counts
      await db.from("tenants").update({ fitment_count: 0 }).eq("shop_id", shopId);

      return data({ ok: true, message: `Purged all fitments for this tenant. Products reset to unmapped.` });
    }

    case "purge-products": {
      // Delete fitments first (FK constraint)
      await db.from("vehicle_fitments").delete().eq("shop_id", shopId);
      const { error } = await db.from("products").delete().eq("shop_id", shopId);

      if (error) {
        return data({ ok: false, message: `Failed: ${error.message}` });
      }

      await db.from("tenants").update({ product_count: 0, fitment_count: 0 }).eq("shop_id", shopId);
      return data({ ok: true, message: "Purged all products and fitments for this tenant." });
    }

    default:
      return data({ ok: false, message: `Unknown action: ${intent}` });
  }
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function TenantDetail() {
  const {
    tenant,
    products,
    totalFitments,
    recentFitments,
    syncJobs,
    providers,
    settings,
    statusBreakdown,
    totalProductCount,
    mappedCount,
    coveragePercent,
    topMakes,
    shopId,
  } = useLoaderData<typeof loader>();

  const fetcher = useFetcher<{ ok: boolean; message: string }>();
  const navigate = useNavigate();
  const isSubmitting = fetcher.state !== "idle";
  const [searchParams, setSearchParams] = useSearchParams();
  const TENANT_TAB_IDS = ["overview", "products", "fitments", "sync-jobs", "settings", "actions"];
  const selectedTab = Math.max(0, TENANT_TAB_IDS.indexOf(searchParams.get("tab") ?? "overview"));
  const setSelectedTab = (idx: number) => { setSearchParams((prev) => { prev.set("tab", TENANT_TAB_IDS[idx] ?? "overview"); return prev; }); };
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(tenant.plan);
  const [confirmPurgeFitments, setConfirmPurgeFitments] = useState(false);
  const [confirmPurgeAll, setConfirmPurgeAll] = useState(false);

  const tabs = [
    { id: "overview", content: "Overview" },
    { id: "products", content: `Products (${totalProductCount})` },
    { id: "fitments", content: `Fitments (${totalFitments})` },
    { id: "sync-jobs", content: `Sync Jobs (${syncJobs.length})` },
    { id: "settings", content: "Settings" },
    { id: "actions", content: "Admin Actions" },
  ];

  const isActive = !tenant.uninstalled_at;
  const domain = (tenant.shop_domain ?? tenant.shop_id).replace(".myshopify.com", "");

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });
  };

  const formatDateTime = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    });
  };

  // Use shared formatPrice from types.ts

  return (
    <Page
      fullWidth
      title={domain}
      subtitle={`Tenant detail — ${capitalisePlan(tenant.plan)} plan`}
      backAction={{ content: "Admin Panel", onAction: () => navigate("/app/admin") }}
      titleMetadata={
        <InlineStack gap="200">
          <Badge tone={PLAN_BADGE_TONE[tenant.plan as PlanTier]}>
            {capitalisePlan(tenant.plan)}
          </Badge>
          <Badge tone={isActive ? "success" : "critical"}>
            {isActive ? "Active" : "Uninstalled"}
          </Badge>
        </InlineStack>
      }
    >
      <BlockStack gap="600">
        {/* Action result banner */}
        {fetcher.data?.message && !bannerDismissed && (
          <Banner
            title={fetcher.data.message}
            tone={fetcher.data.ok ? "success" : "critical"}
            onDismiss={() => setBannerDismissed(true)}
          />
        )}

        {/* ── KPI Cards ── */}
        <Card padding="0">
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            borderBottom: "1px solid var(--p-color-border-secondary)",
          }}>
            {[
              { icon: ProductIcon, count: totalProductCount.toLocaleString(), label: "Products" },
              { icon: LinkIcon, count: totalFitments.toLocaleString(), label: "Fitments" },
              { icon: ChartVerticalFilledIcon, count: `${coveragePercent}%`, label: "Coverage" },
              { icon: ConnectIcon, count: String(providers.length), label: "Providers" },
              { icon: RefreshIcon, count: String(syncJobs.length), label: "Sync Jobs" },
            ].map((item, i) => (
              <div key={item.label} style={{
                padding: "var(--p-space-400)",
                borderRight: i < 4 ? "1px solid var(--p-color-border-secondary)" : "none",
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
                </BlockStack>
              </div>
            ))}
          </div>
        </Card>

        {/* ── Tabbed Content ── */}
        <Card padding="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
            <Box padding="400">

              {/* ═══ OVERVIEW TAB ═══ */}
              {selectedTab === 0 && (
                <BlockStack gap="500">
                  {/* Tenant Info */}
                  <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                    <Card>
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">Tenant Information</Text>
                        <BlockStack gap="200">
                          <InlineStack align="space-between">
                            <Text as="p" variant="bodySm" tone="subdued">Shop ID</Text>
                            <Text as="p" variant="bodySm">{tenant.shop_id}</Text>
                          </InlineStack>
                          <InlineStack align="space-between">
                            <Text as="p" variant="bodySm" tone="subdued">Domain</Text>
                            <Text as="p" variant="bodySm">{tenant.shop_domain ?? "—"}</Text>
                          </InlineStack>
                          <InlineStack align="space-between">
                            <Text as="p" variant="bodySm" tone="subdued">Plan</Text>
                            <Badge tone={PLAN_BADGE_TONE[tenant.plan as PlanTier]}>{capitalisePlan(tenant.plan)}</Badge>
                          </InlineStack>
                          <InlineStack align="space-between">
                            <Text as="p" variant="bodySm" tone="subdued">Plan Status</Text>
                            <Text as="p" variant="bodySm">{tenant.plan_status ?? "active"}</Text>
                          </InlineStack>
                          <InlineStack align="space-between">
                            <Text as="p" variant="bodySm" tone="subdued">Installed</Text>
                            <Text as="p" variant="bodySm">{formatDate(tenant.installed_at)}</Text>
                          </InlineStack>
                          {tenant.uninstalled_at && (
                            <InlineStack align="space-between">
                              <Text as="p" variant="bodySm" tone="subdued">Uninstalled</Text>
                              <Text as="p" variant="bodySm" tone="critical">{formatDate(tenant.uninstalled_at)}</Text>
                            </InlineStack>
                          )}
                          <InlineStack align="space-between">
                            <Text as="p" variant="bodySm" tone="subdued">Scopes</Text>
                            <Text as="p" variant="bodySm">{tenant.scopes ? "Granted" : "—"}</Text>
                          </InlineStack>
                        </BlockStack>
                      </BlockStack>
                    </Card>

                    <Card>
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">Fitment Status Breakdown</Text>
                        <BlockStack gap="200">
                          {Object.entries(statusBreakdown).map(([status, count]) => {
                            const badge = STATUS_BADGES[status] ?? { tone: undefined as undefined, label: status };
                            const pct = totalProductCount > 0 ? Math.round((count / totalProductCount) * 100) : 0;
                            return (
                              <InlineStack key={status} align="space-between" blockAlign="center">
                                <Badge tone={badge.tone}>{badge.label}</Badge>
                                <Text as="p" variant="bodySm">{count.toLocaleString()} ({pct}%)</Text>
                              </InlineStack>
                            );
                          })}
                        </BlockStack>
                        <Divider />
                        <InlineStack align="space-between">
                          <Text as="p" variant="bodySm" fontWeight="semibold">Total</Text>
                          <Text as="p" variant="bodySm" fontWeight="semibold">{totalProductCount.toLocaleString()}</Text>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  </InlineGrid>

                  {/* Top Makes */}
                  {topMakes.length > 0 && (
                    <Card>
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">Top Vehicle Makes (by fitment count)</Text>
                        <InlineStack gap="200" wrap>
                          {topMakes.map((m) => (
                            <Badge key={m.make} tone="info">
                              {`${m.make}: ${m.count}`}
                            </Badge>
                          ))}
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  )}

                  {/* Providers */}
                  {providers.length > 0 && (
                    <Card>
                      <BlockStack gap="300">
                        <Text as="h3" variant="headingSm">Configured Providers</Text>
                        <DataTable
                          columnContentTypes={["text", "text", "text", "numeric", "text"]}
                          headings={["Name", "Type", "Status", "Products", "Added"]}
                          rows={providers.map((p: any) => [
                            p.name,
                            (p.type ?? "—").toUpperCase(),
                            p.status ? p.status.charAt(0).toUpperCase() + p.status.slice(1) : "—",
                            (p.product_count ?? 0).toLocaleString(),
                            formatDate(p.created_at),
                          ])}
                        />
                      </BlockStack>
                    </Card>
                  )}
                </BlockStack>
              )}

              {/* ═══ PRODUCTS TAB ═══ */}
              {selectedTab === 1 && (
                <BlockStack gap="400">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Showing the most recent 50 products for this tenant.
                  </Text>

                  {products.length === 0 ? (
                    <EmptyState
                      heading="No products"
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                      <p>This tenant has not imported any products yet.</p>
                    </EmptyState>
                  ) : (
                    <IndexTable
                      resourceName={{ singular: "product", plural: "products" }}
                      itemCount={products.length}
                      headings={[
                        { title: "Image" },
                        { title: "Title" },
                        { title: "Vendor" },
                        { title: "Price" },
                        { title: "Status" },
                        { title: "Source" },
                        { title: "Synced" },
                      ]}
                      selectable={false}
                    >
                      {products.map((product: any, idx: number) => {
                        const badge = STATUS_BADGES[product.fitment_status] ?? STATUS_BADGES.unmapped;
                        return (
                          <IndexTable.Row id={product.id} key={product.id} position={idx}>
                            <IndexTable.Cell>
                              <Thumbnail
                                source={product.image_url || "https://cdn.shopify.com/s/files/1/0533/2089/files/placeholder-images-image_large.png"}
                                alt={product.title}
                                size="small"
                              />
                            </IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text as="span" variant="bodyMd" fontWeight="semibold">
                                {product.title}
                              </Text>
                            </IndexTable.Cell>
                            <IndexTable.Cell>{product.vendor || "—"}</IndexTable.Cell>
                            <IndexTable.Cell>{formatPrice(product.price)}</IndexTable.Cell>
                            <IndexTable.Cell>
                              <Badge tone={badge.tone}>{badge.label}</Badge>
                            </IndexTable.Cell>
                            <IndexTable.Cell>{product.source || "—"}</IndexTable.Cell>
                            <IndexTable.Cell>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {formatDate(product.synced_at || product.created_at)}
                              </Text>
                            </IndexTable.Cell>
                          </IndexTable.Row>
                        );
                      })}
                    </IndexTable>
                  )}
                </BlockStack>
              )}

              {/* ═══ FITMENTS TAB ═══ */}
              {selectedTab === 2 && (
                <BlockStack gap="400">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Showing the most recent 30 vehicle fitments for this tenant.
                    Total: {totalFitments.toLocaleString()} fitments.
                  </Text>

                  {recentFitments.length === 0 ? (
                    <EmptyState
                      heading="No fitments"
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                      <p>This tenant has no vehicle fitment data yet.</p>
                    </EmptyState>
                  ) : (
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                      headings={["Make", "Model", "Years", "Engine", "Confidence", "Source"]}
                      rows={recentFitments.map((f: any) => [
                        f.make || "—",
                        f.model || "—",
                        f.year_from && f.year_to
                          ? f.year_from === f.year_to ? String(f.year_from) : `${f.year_from}-${f.year_to}`
                          : f.year_from ? String(f.year_from) : "—",
                        f.engine || "—",
                        f.confidence ? `${Math.round(f.confidence * 100)}%` : "—",
                        f.source || "—",
                      ])}
                    />
                  )}
                </BlockStack>
              )}

              {/* ═══ SYNC JOBS TAB ═══ */}
              {selectedTab === 3 && (
                <BlockStack gap="400">
                  <Text as="p" variant="bodySm" tone="subdued">
                    All sync jobs for this tenant, most recent first.
                  </Text>

                  {syncJobs.length === 0 ? (
                    <EmptyState
                      heading="No sync jobs"
                      image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                    >
                      <p>This tenant has not run any sync jobs yet.</p>
                    </EmptyState>
                  ) : (
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text", "text", "text"]}
                      headings={["Type", "Status", "Progress", "Errors", "Started", "Duration"]}
                      rows={syncJobs.map((j: any) => {
                        const started = new Date(j.created_at);
                        const duration = j.completed_at
                          ? `${Math.round((new Date(j.completed_at).getTime() - started.getTime()) / 1000)}s`
                          : j.status === "running" ? "Running..." : "—";

                        const progress = j.total > 0
                          ? `${j.progress ?? 0}/${j.total}`
                          : "—";

                        const errorCount = Array.isArray(j.errors) ? j.errors.length : 0;

                        return [
                          j.type.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
                          j.status.charAt(0).toUpperCase() + j.status.slice(1),
                          progress,
                          errorCount > 0 ? `${errorCount} errors` : "None",
                          formatDateTime(j.created_at),
                          duration,
                        ];
                      })}
                    />
                  )}
                </BlockStack>
              )}

              {/* ═══ SETTINGS TAB ═══ */}
              {selectedTab === 4 && (
                <BlockStack gap="400">
                  <Text as="h3" variant="headingSm">App Settings (Read-Only View)</Text>

                  {!settings ? (
                    <Banner title="No settings found" tone="warning">
                      <p>This tenant has no app_settings record. They may need to visit the Settings page to initialise it.</p>
                    </Banner>
                  ) : (
                    <Card>
                      <BlockStack gap="200">
                        {Object.entries(settings).map(([key, value]) => {
                          if (key === "id" || key === "shop_id") return null;
                          return (
                            <InlineStack key={key} align="space-between">
                              <Text as="p" variant="bodySm" tone="subdued">
                                {key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                              </Text>
                              <Text as="p" variant="bodySm">
                                {value === null ? "—" : value === true ? "Yes" : value === false ? "No" : String(value)}
                              </Text>
                            </InlineStack>
                          );
                        })}
                      </BlockStack>
                    </Card>
                  )}
                </BlockStack>
              )}

              {/* ═══ ADMIN ACTIONS TAB ═══ */}
              {selectedTab === 5 && (
                <BlockStack gap="600">
                  {/* Change Plan */}
                  <Card>
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">Change Plan</Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Override this tenant's plan. This does NOT affect their Shopify billing subscription
                        — only the feature gates within the app.
                      </Text>
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="change-plan" />
                        <input type="hidden" name="shop_id" value={shopId} />
                        <InlineStack gap="200" blockAlign="center">
                          <Select
                            label="New plan"
                            labelHidden
                            options={[
                              { label: "Free", value: "free" },
                              { label: "Starter", value: "starter" },
                              { label: "Growth", value: "growth" },
                              { label: "Professional", value: "professional" },
                              { label: "Business", value: "business" },
                              { label: "Enterprise", value: "enterprise" },
                            ]}
                            value={selectedPlan}
                            name="new_plan"
                            onChange={setSelectedPlan}
                          />
                          <Button submit loading={isSubmitting}>
                            Update Plan
                          </Button>
                        </InlineStack>
                      </fetcher.Form>
                    </BlockStack>
                  </Card>

                  {/* Refresh Counts */}
                  <Card>
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">Refresh Counts</Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Re-count this tenant's products and fitments from the database and update
                        their tenant record. Useful if counts appear stale or incorrect.
                      </Text>
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="update-counts" />
                        <input type="hidden" name="shop_id" value={shopId} />
                        <Button submit loading={isSubmitting}>
                          Refresh Counts
                        </Button>
                      </fetcher.Form>
                    </BlockStack>
                  </Card>

                  {/* Reset Settings */}
                  <Card>
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">Reset Settings</Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Reset this tenant's app settings to defaults (push_tags: on, push_metafields: on,
                        collection_strategy: none). Useful if a tenant's settings get into a bad state.
                      </Text>
                      <fetcher.Form method="post">
                        <input type="hidden" name="intent" value="reset-settings" />
                        <input type="hidden" name="shop_id" value={shopId} />
                        <Button submit loading={isSubmitting} tone="critical">
                          Reset to Defaults
                        </Button>
                      </fetcher.Form>
                    </BlockStack>
                  </Card>

                  <Divider />

                  {/* Danger Zone */}
                  <Banner title="Danger Zone" tone="critical">
                    <p>These operations are destructive and cannot be undone.</p>
                  </Banner>

                  <Card>
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">Purge Fitments</Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Delete ALL vehicle fitments for this tenant and reset all their products
                        to "unmapped" status. Their products will remain but lose all fitment data.
                      </Text>
                      {!confirmPurgeFitments ? (
                        <Button onClick={() => setConfirmPurgeFitments(true)} tone="critical">
                          Purge All Fitments
                        </Button>
                      ) : (
                        <Banner tone="critical" onDismiss={() => setConfirmPurgeFitments(false)}>
                          <BlockStack gap="200">
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              Are you sure? This will permanently delete all fitments for this tenant.
                            </Text>
                            <InlineStack gap="200">
                              <fetcher.Form method="post">
                                <input type="hidden" name="intent" value="purge-fitments" />
                                <input type="hidden" name="shop_id" value={shopId} />
                                <Button submit loading={isSubmitting} tone="critical">
                                  Yes, purge all fitments
                                </Button>
                              </fetcher.Form>
                              <Button onClick={() => setConfirmPurgeFitments(false)}>Cancel</Button>
                            </InlineStack>
                          </BlockStack>
                        </Banner>
                      )}
                    </BlockStack>
                  </Card>

                  <Card>
                    <BlockStack gap="300">
                      <Text as="h3" variant="headingSm">Purge All Data</Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Delete ALL products AND fitments for this tenant. This is a complete data
                        wipe — the tenant will need to re-fetch products from Shopify.
                      </Text>
                      {!confirmPurgeAll ? (
                        <Button onClick={() => setConfirmPurgeAll(true)} tone="critical">
                          Purge All Products & Fitments
                        </Button>
                      ) : (
                        <Banner tone="critical" onDismiss={() => setConfirmPurgeAll(false)}>
                          <BlockStack gap="200">
                            <Text as="p" variant="bodySm" fontWeight="semibold">
                              Are you absolutely sure? This will permanently delete ALL products and fitments. The tenant will need to re-fetch everything from Shopify.
                            </Text>
                            <InlineStack gap="200">
                              <fetcher.Form method="post">
                                <input type="hidden" name="intent" value="purge-products" />
                                <input type="hidden" name="shop_id" value={shopId} />
                                <Button submit loading={isSubmitting} tone="critical">
                                  Yes, purge everything
                                </Button>
                              </fetcher.Form>
                              <Button onClick={() => setConfirmPurgeAll(false)}>Cancel</Button>
                            </InlineStack>
                          </BlockStack>
                        </Banner>
                      )}
                    </BlockStack>
                  </Card>
                </BlockStack>
              )}

            </Box>
          </Tabs>
        </Card>
      </BlockStack>
    </Page>
  );
}
