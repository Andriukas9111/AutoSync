/**
 * Analytics Dashboard
 *
 * Fitment coverage, popular makes/models, supplier performance,
 * and inventory gap analysis. Gated by dashboardAnalytics plan feature.
 */

import { useState } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Banner,
  ProgressBar,
  DataTable,
  Box,
  Divider,
  Button,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant, getPlanLimits } from "../lib/billing.server";
import type { PlanTier } from "../lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FitmentCoverage {
  total: number;
  withFitments: number;
  withoutFitments: number;
  coveragePercent: number;
}

interface StatusBreakdown {
  status: string;
  count: number;
}

interface PopularMake {
  make: string;
  fitmentCount: number;
  productCount: number;
}

interface PopularModel {
  make: string;
  model: string;
  fitmentCount: number;
}

interface ProviderMetric {
  id: string;
  name: string;
  type: string;
  status: string;
  productCount: number;
  lastFetchAt: string | null;
}

interface SyncJobSummary {
  type: string;
  total: number;
  completed: number;
  failed: number;
  successRate: number;
}

interface PopularSearch {
  make: string;
  model: string;
  count: number;
}

interface AnalyticsData {
  plan: PlanTier;
  analyticsLevel: string;
  fitmentCoverage: FitmentCoverage;
  statusBreakdown: StatusBreakdown[];
  popularMakes: PopularMake[];
  popularModels: PopularModel[];
  providerMetrics: ProviderMetric[];
  syncJobSummary: SyncJobSummary[];
  inventoryGaps: { makesWithoutProducts: number; productsPerMakeAvg: number };
  totalMakes: number;
  totalModels: number;
  popularSearches: PopularSearch[];
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const tenant = await getTenant(shopId);
  const plan = (tenant?.plan ?? "free") as PlanTier;
  const limits = getPlanLimits(plan);
  const analyticsLevel = limits.features.dashboardAnalytics;

  // Gate: "none" means no analytics at all
  if (analyticsLevel === "none") {
    return {
      plan,
      analyticsLevel,
      fitmentCoverage: { total: 0, withFitments: 0, withoutFitments: 0, coveragePercent: 0 },
      statusBreakdown: [],
      popularMakes: [],
      popularModels: [],
      providerMetrics: [],
      syncJobSummary: [],
      inventoryGaps: { makesWithoutProducts: 0, productsPerMakeAvg: 0 },
      totalMakes: 0,
      totalModels: 0,
      popularSearches: [],
    } satisfies AnalyticsData;
  }

  // ── Parallel queries ────────────────────────────────────────
  const [
    productsRes,
    productsWithFitmentsRes,
    statusRes,
    fitmentsByMakeRes,
    fitmentsByModelRes,
    providersRes,
    syncJobsRes,
    makesRes,
    modelsRes,
    searchEventsRes,
  ] = await Promise.all([
    // Total products for this tenant
    db.from("products").select("*", { count: "exact", head: true }).eq("shop_id", shopId),

    // Products that have at least one fitment
    db.from("vehicle_fitments")
      .select("product_id")
      .eq("shop_id", shopId),

    // Product status breakdown
    db.from("products")
      .select("status")
      .eq("shop_id", shopId),

    // Fitments grouped by make (top 15)
    db.from("vehicle_fitments")
      .select("make, product_id")
      .eq("shop_id", shopId),

    // Fitments grouped by model (top 15)
    db.from("vehicle_fitments")
      .select("make, model, product_id")
      .eq("shop_id", shopId),

    // Provider metrics
    db.from("providers")
      .select("id, name, type, status, product_count, last_fetch_at")
      .eq("shop_id", shopId)
      .order("product_count", { ascending: false }),

    // Sync jobs summary
    db.from("sync_jobs")
      .select("type, status")
      .eq("shop_id", shopId),

    // Global YMME counts
    db.from("ymme_makes").select("id, name", { count: "exact" }),
    db.from("ymme_models").select("*", { count: "exact", head: true }),

    // Search events (last 30 days — silently returns empty if table doesn't exist)
    db.from("search_events")
      .select("search_make, search_model")
      .eq("shop_id", shopId)
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .not("search_make", "is", null),
  ]);

  // ── Compute fitment coverage ───────────────────────────────
  const totalProducts = productsRes.count ?? 0;
  const uniqueProductsWithFitments = new Set(
    (productsWithFitmentsRes.data ?? []).map((f: { product_id: string }) => f.product_id),
  ).size;
  const withoutFitments = totalProducts - uniqueProductsWithFitments;
  const coveragePercent = totalProducts > 0
    ? Math.round((uniqueProductsWithFitments / totalProducts) * 1000) / 10
    : 0;

  const fitmentCoverage: FitmentCoverage = {
    total: totalProducts,
    withFitments: uniqueProductsWithFitments,
    withoutFitments,
    coveragePercent,
  };

  // ── Status breakdown ───────────────────────────────────────
  const statusCounts: Record<string, number> = {};
  for (const p of statusRes.data ?? []) {
    const s = (p as { status: string }).status || "unknown";
    statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  }
  const statusBreakdown: StatusBreakdown[] = Object.entries(statusCounts)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  // ── Popular makes (by fitment count) ───────────────────────
  const makeFitmentCounts: Record<string, { fitments: number; products: Set<string> }> = {};
  for (const f of fitmentsByMakeRes.data ?? []) {
    const rec = f as { make: string; product_id: string };
    if (!rec.make) continue;
    if (!makeFitmentCounts[rec.make]) {
      makeFitmentCounts[rec.make] = { fitments: 0, products: new Set() };
    }
    makeFitmentCounts[rec.make].fitments++;
    makeFitmentCounts[rec.make].products.add(rec.product_id);
  }
  const popularMakes: PopularMake[] = Object.entries(makeFitmentCounts)
    .map(([make, data]) => ({
      make,
      fitmentCount: data.fitments,
      productCount: data.products.size,
    }))
    .sort((a, b) => b.fitmentCount - a.fitmentCount)
    .slice(0, 15);

  // ── Popular models (by fitment count) ──────────────────────
  const modelFitmentCounts: Record<string, number> = {};
  const modelMakes: Record<string, string> = {};
  for (const f of fitmentsByModelRes.data ?? []) {
    const rec = f as { make: string; model: string };
    if (!rec.model) continue;
    const key = `${rec.make}|||${rec.model}`;
    modelFitmentCounts[key] = (modelFitmentCounts[key] ?? 0) + 1;
    modelMakes[key] = rec.make;
  }
  const popularModels: PopularModel[] = Object.entries(modelFitmentCounts)
    .map(([key, fitmentCount]) => {
      const [make, model] = key.split("|||");
      return { make, model, fitmentCount };
    })
    .sort((a, b) => b.fitmentCount - a.fitmentCount)
    .slice(0, 15);

  // ── Provider metrics ───────────────────────────────────────
  const providerMetrics: ProviderMetric[] = (providersRes.data ?? []).map(
    (p: Record<string, unknown>) => ({
      id: String(p.id),
      name: String(p.name),
      type: String(p.type),
      status: String(p.status),
      productCount: Number(p.product_count ?? 0),
      lastFetchAt: p.last_fetch_at as string | null,
    }),
  );

  // ── Sync job summary ──────────────────────────────────────
  const jobCounts: Record<string, { total: number; completed: number; failed: number }> = {};
  for (const j of syncJobsRes.data ?? []) {
    const rec = j as { type: string; status: string };
    if (!jobCounts[rec.type]) {
      jobCounts[rec.type] = { total: 0, completed: 0, failed: 0 };
    }
    jobCounts[rec.type].total++;
    if (rec.status === "completed") jobCounts[rec.type].completed++;
    if (rec.status === "failed") jobCounts[rec.type].failed++;
  }
  const syncJobSummary: SyncJobSummary[] = Object.entries(jobCounts)
    .map(([type, data]) => ({
      type,
      total: data.total,
      completed: data.completed,
      failed: data.failed,
      successRate: data.total > 0
        ? Math.round((data.completed / data.total) * 1000) / 10
        : 0,
    }))
    .sort((a, b) => b.total - a.total);

  // ── Inventory gaps ─────────────────────────────────────────
  const totalMakes = makesRes.count ?? 0;
  const makesWithProducts = Object.keys(makeFitmentCounts).length;
  const makesWithoutProducts = totalMakes - makesWithProducts;
  const productsPerMakeAvg =
    makesWithProducts > 0
      ? Math.round(
          Object.values(makeFitmentCounts).reduce(
            (s, d) => s + d.products.size,
            0,
          ) / makesWithProducts,
        )
      : 0;

  // ── Popular storefront searches (last 30 days) ──────────
  const searchCounts: Record<string, number> = {};
  for (const s of (searchEventsRes.data ?? []) as Array<{ search_make: string; search_model: string }>) {
    const key = `${s.search_make}|||${s.search_model || "(any model)"}`;
    searchCounts[key] = (searchCounts[key] ?? 0) + 1;
  }
  const popularSearches: PopularSearch[] = Object.entries(searchCounts)
    .map(([key, count]) => {
      const [make, model] = key.split("|||");
      return { make, model, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    plan,
    analyticsLevel,
    fitmentCoverage,
    statusBreakdown,
    popularMakes,
    popularModels,
    providerMetrics,
    syncJobSummary,
    inventoryGaps: { makesWithoutProducts, productsPerMakeAvg },
    totalMakes,
    totalModels: modelsRes.count ?? 0,
    popularSearches,
  } satisfies AnalyticsData;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const STATUS_TONE: Record<string, "success" | "warning" | "critical" | "info" | "attention" | undefined> = {
  approved: "success",
  published: "success",
  pending: "attention",
  draft: undefined,
  rejected: "critical",
  needs_review: "warning",
  archived: undefined,
};

export default function AnalyticsPage() {
  const {
    plan,
    analyticsLevel,
    fitmentCoverage,
    statusBreakdown,
    popularMakes,
    popularModels,
    providerMetrics,
    syncJobSummary,
    inventoryGaps,
    totalMakes,
    totalModels,
    popularSearches,
  } = useLoaderData<typeof loader>();

  const [showExport, setShowExport] = useState(false);

  // ── Plan gate ──────────────────────────────────────────────
  if (analyticsLevel === "none") {
    return (
      <Page title="Analytics">
        <Banner title="Analytics requires the Starter plan or higher" tone="warning">
          <p>
            Upgrade your plan to access fitment coverage reports, popular vehicle
            searches, supplier performance metrics, and inventory gap analysis.
          </p>
        </Banner>
      </Page>
    );
  }

  const isBasic = analyticsLevel === "basic";
  const canExport = analyticsLevel === "full_export";

  // ── Export handler ─────────────────────────────────────────
  const handleExport = (format: "csv" | "json") => {
    const exportData = {
      fitmentCoverage,
      statusBreakdown,
      popularMakes,
      popularModels,
      providerMetrics,
      syncJobSummary,
      inventoryGaps,
      exportedAt: new Date().toISOString(),
    };

    if (format === "json") {
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `autosync-analytics-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      // CSV: export popular makes as a table
      const csvRows = [
        ["Make", "Fitments", "Products"],
        ...popularMakes.map((m) => [m.make, String(m.fitmentCount), String(m.productCount)]),
      ];
      const csv = csvRows.map((r) => r.join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `autosync-popular-makes-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <Page
      title="Analytics"
      subtitle="Fitment coverage, popular vehicles, and supplier performance"
      primaryAction={
        canExport
          ? {
              content: "Export Data",
              onAction: () => setShowExport(!showExport),
            }
          : undefined
      }
    >
      <BlockStack gap="600">
        {/* Export buttons */}
        {showExport && canExport && (
          <Banner title="Export Analytics" tone="info" onDismiss={() => setShowExport(false)}>
            <InlineStack gap="300">
              <Button onClick={() => handleExport("json")}>Export JSON</Button>
              <Button onClick={() => handleExport("csv")}>Export CSV (Makes)</Button>
            </InlineStack>
          </Banner>
        )}

        {/* ── Fitment Coverage ──────────────────────────────── */}
        <Layout>
          <Layout.Section>
            <Text as="h2" variant="headingLg">
              Fitment Coverage
            </Text>
          </Layout.Section>

          <Layout.Section>
            <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Total Products
                  </Text>
                  <Text as="p" variant="headingXl">
                    {fitmentCoverage.total.toLocaleString()}
                  </Text>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    With Fitments
                  </Text>
                  <Text as="p" variant="headingXl">
                    {fitmentCoverage.withFitments.toLocaleString()}
                  </Text>
                  <Badge tone="success">
                    {fitmentCoverage.coveragePercent}% coverage
                  </Badge>
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Without Fitments
                  </Text>
                  <Text as="p" variant="headingXl">
                    {fitmentCoverage.withoutFitments.toLocaleString()}
                  </Text>
                  {fitmentCoverage.withoutFitments > 0 && (
                    <Badge tone="warning">Needs mapping</Badge>
                  )}
                </BlockStack>
              </Card>

              <Card>
                <BlockStack gap="200">
                  <Text as="p" variant="bodySm" tone="subdued">
                    Coverage Progress
                  </Text>
                  <ProgressBar
                    progress={fitmentCoverage.coveragePercent}
                    tone="primary"
                    size="small"
                  />
                  <Text as="p" variant="bodySm">
                    {fitmentCoverage.coveragePercent}% of products have vehicle fitments
                  </Text>
                </BlockStack>
              </Card>
            </InlineGrid>
          </Layout.Section>

          {/* ── Product Status Breakdown ───────────────────── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Product Status Breakdown
                </Text>
                <InlineStack gap="400" wrap>
                  {statusBreakdown.map(({ status, count }) => (
                    <InlineStack key={status} gap="200" blockAlign="center">
                      <Badge tone={STATUS_TONE[status]}>
                        {status.replace(/_/g, " ")}
                      </Badge>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {count.toLocaleString()}
                      </Text>
                    </InlineStack>
                  ))}
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ── Popular Makes ─────────────────────────────── */}
          {!isBasic && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      Popular Makes (Top 15)
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      By fitment count
                    </Text>
                  </InlineStack>
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric"]}
                    headings={["Make", "Fitments", "Products"]}
                    rows={popularMakes.map((m) => [
                      m.make,
                      m.fitmentCount.toLocaleString(),
                      m.productCount.toLocaleString(),
                    ])}
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* ── Popular Models ────────────────────────────── */}
          {!isBasic && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      Popular Models (Top 15)
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      By fitment count
                    </Text>
                  </InlineStack>
                  <DataTable
                    columnContentTypes={["text", "text", "numeric"]}
                    headings={["Make", "Model", "Fitments"]}
                    rows={popularModels.map((m) => [
                      m.make,
                      m.model,
                      m.fitmentCount.toLocaleString(),
                    ])}
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* ── Supplier Performance ──────────────────────── */}
          {!isBasic && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Supplier Performance
                  </Text>
                  {providerMetrics.length === 0 ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      No providers configured. Add a provider to see supplier metrics.
                    </Text>
                  ) : (
                    <DataTable
                      columnContentTypes={[
                        "text",
                        "text",
                        "text",
                        "numeric",
                        "text",
                      ]}
                      headings={["Provider", "Type", "Status", "Products", "Last Fetch"]}
                      rows={providerMetrics.map((p) => [
                        p.name,
                        p.type.toUpperCase(),
                        p.status,
                        p.productCount.toLocaleString(),
                        p.lastFetchAt
                          ? new Date(p.lastFetchAt).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })
                          : "Never",
                      ])}
                    />
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* ── Sync Job Summary ──────────────────────────── */}
          {!isBasic && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Sync Job History
                  </Text>
                  {syncJobSummary.length === 0 ? (
                    <Text as="p" variant="bodySm" tone="subdued">
                      No sync jobs have been run yet.
                    </Text>
                  ) : (
                    <DataTable
                      columnContentTypes={[
                        "text",
                        "numeric",
                        "numeric",
                        "numeric",
                        "text",
                      ]}
                      headings={["Job Type", "Total Runs", "Completed", "Failed", "Success Rate"]}
                      rows={syncJobSummary.map((j) => [
                        j.type.replace(/_/g, " "),
                        j.total.toLocaleString(),
                        j.completed.toLocaleString(),
                        j.failed.toLocaleString(),
                        `${j.successRate}%`,
                      ])}
                    />
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* ── Popular Storefront Searches ────────────────── */}
          {!isBasic && popularSearches.length > 0 && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      Popular Storefront Searches (Last 30 Days)
                    </Text>
                    <Text as="span" variant="bodySm" tone="subdued">
                      From YMME widget usage
                    </Text>
                  </InlineStack>
                  <DataTable
                    columnContentTypes={["text", "text", "numeric"]}
                    headings={["Make", "Model", "Searches"]}
                    rows={popularSearches.map((s) => [
                      s.make,
                      s.model,
                      s.count.toLocaleString(),
                    ])}
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* ── Inventory Gap Analysis ────────────────────── */}
          {!isBasic && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Inventory Gap Analysis
                  </Text>
                  <Divider />
                  <InlineGrid columns={{ xs: 1, sm: 2, md: 4 }} gap="400">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Total Makes in DB
                      </Text>
                      <Text as="p" variant="headingLg">
                        {totalMakes.toLocaleString()}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Total Models in DB
                      </Text>
                      <Text as="p" variant="headingLg">
                        {totalModels.toLocaleString()}
                      </Text>
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Makes Without Your Products
                      </Text>
                      <Text as="p" variant="headingLg">
                        {inventoryGaps.makesWithoutProducts.toLocaleString()}
                      </Text>
                      {inventoryGaps.makesWithoutProducts > 0 && (
                        <Text as="p" variant="bodySm" tone="subdued">
                          Opportunity to expand catalogue
                        </Text>
                      )}
                    </BlockStack>
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm" tone="subdued">
                        Avg Products per Make
                      </Text>
                      <Text as="p" variant="headingLg">
                        {inventoryGaps.productsPerMakeAvg.toLocaleString()}
                      </Text>
                    </BlockStack>
                  </InlineGrid>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* ── Basic plan upsell ─────────────────────────── */}
          {isBasic && (
            <Layout.Section>
              <Banner title="Unlock full analytics" tone="info">
                <p>
                  Upgrade to the Growth plan to access popular makes/models tables,
                  supplier performance metrics, sync job history, and inventory gap
                  analysis. Business and Enterprise plans include data export.
                </p>
              </Banner>
            </Layout.Section>
          )}
        </Layout>
      </BlockStack>
    </Page>
  );
}
