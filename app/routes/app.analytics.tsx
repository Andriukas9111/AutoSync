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
  Button,
} from "@shopify/polaris";
import {
  GaugeIcon,
  ProductIcon,
  ChartVerticalIcon,
  TargetIcon,
  PackageIcon,
  DatabaseIcon,
  SearchIcon,
  AlertTriangleIcon,
  CartIcon,
  ViewIcon,
  OrderIcon,
  ConnectIcon,
} from "@shopify/polaris-icons";
import { DataTable } from "../components/DataTable";

import { authenticate } from "../shopify.server";
import db, { paginatedSelect } from "../lib/db.server";
import { getTenant, getPlanLimits, assertFeature, getEffectivePlan } from "../lib/billing.server";
import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import { PlanGate } from "../components/PlanGate";
import { statGridStyle, statMiniStyle } from "../lib/design";
import type { PlanTier, PlanLimits } from "../lib/types";
import { useAppData } from "../lib/use-app-data";
import { RouteError } from "../components/RouteError";

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

interface ConversionFunnel {
  searches: number;
  productViews: number;
  addToCarts: number;
  purchases: number;
  searchToViewRate: number;
  viewToCartRate: number;
  cartToPurchaseRate: number;
  overallRate: number;
}

interface ConversionBySource {
  source: string;
  views: number;
  carts: number;
  purchases: number;
}

interface ConversionByVehicle {
  make: string;
  model: string;
  views: number;
  carts: number;
  purchases: number;
}

interface AnalyticsData {
  plan: PlanTier;
  limits: PlanLimits;
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
  conversionFunnel: ConversionFunnel;
  conversionBySource: ConversionBySource[];
  conversionByVehicle: ConversionByVehicle[];
  recentPlateLookups: Array<{ plate: string; make: string | null; model: string | null; year: number | null; fuel_type: string | null; colour: string | null; created_at: string }>;
  totalPlateLookups: number;
  topPlateMakes: Array<{ make: string; count: number }>;
  searchCount: number;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const tenant = await getTenant(shopId);
  const plan = getEffectivePlan(tenant) as PlanTier;
  const limits = getPlanLimits(plan);
  const analyticsLevel = limits.features.dashboardAnalytics;

  // Plan gate: dashboardAnalytics feature required
  try {
    await assertFeature(shopId, "dashboardAnalytics");
  } catch {
    return {
      gated: true,
      plan,
      limits,
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
      conversionFunnel: { searches: 0, productViews: 0, addToCarts: 0, purchases: 0, searchToViewRate: 0, viewToCartRate: 0, cartToPurchaseRate: 0, overallRate: 0 },
      conversionBySource: [],
      conversionByVehicle: [],
      recentPlateLookups: [],
      totalPlateLookups: 0,
      topPlateMakes: [],
      searchCount: 0,
    } satisfies AnalyticsData & { gated: boolean };
  }

  // Gate: "none" means no analytics at all
  if (analyticsLevel === "none") {
    return {
      plan,
      limits,
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
      conversionFunnel: { searches: 0, productViews: 0, addToCarts: 0, purchases: 0, searchToViewRate: 0, viewToCartRate: 0, cartToPurchaseRate: 0, overallRate: 0 },
      conversionBySource: [],
      conversionByVehicle: [],
      recentPlateLookups: [],
      totalPlateLookups: 0,
      topPlateMakes: [],
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
    conversionEventsRes,
  ] = await Promise.all([
    // Total vehicle products for this tenant (exclude wheels — they use a different mapping system)
    db.from("products").select("*", { count: "exact", head: true }).eq("shop_id", shopId).or("product_category.eq.vehicle_parts,product_category.is.null"),

    // Products that have at least one fitment — cap at 50K to prevent OOM
    db.from("vehicle_fitments").select("product_id")
      .eq("shop_id", shopId).limit(50000),

    // Product fitment status breakdown — vehicle parts only (no row limit)
    Promise.all(
      ["unmapped", "auto_mapped", "smart_mapped", "manual_mapped", "flagged", "no_match", "partial"].map((s) =>
        db.from("products").select("id", { count: "exact", head: true })
          .eq("shop_id", shopId).eq("fitment_status", s)
          .or("product_category.eq.vehicle_parts,product_category.is.null")
          .then((r) => ({ status: s, count: r.count ?? 0 })),
      ),
    ),

    // Fitments grouped by make (top 15) — cap at 50K to prevent OOM
    db.from("vehicle_fitments").select("make, product_id")
      .eq("shop_id", shopId).limit(50000),

    // Fitments grouped by model (top 15) — cap at 50K to prevent OOM
    db.from("vehicle_fitments").select("make, model, product_id")
      .eq("shop_id", shopId).limit(50000),

    // Provider metrics
    db.from("providers")
      .select("id, name, type, status, product_count, last_fetch_at")
      .eq("shop_id", shopId)
      .order("product_count", { ascending: false }),

    // Sync jobs summary
    db.from("sync_jobs")
      .select("type, status")
      .eq("shop_id", shopId)
      .limit(1000),

    // Global YMME counts (head-only for count)
    db.from("ymme_makes").select("id, name", { count: "exact" }).limit(1000),
    db.from("ymme_models").select("*", { count: "exact", head: true }),

    // Search events (last 30 days)
    db.from("search_events")
      .select("search_make, search_model")
      .eq("shop_id", shopId)
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .not("search_make", "is", null)
      .limit(5000),

    // Conversion events (last 30 days)
    db.from("conversion_events")
      .select("event_type, source, vehicle_make, vehicle_model")
      .eq("shop_id", shopId)
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(5000),
  ]);

  // ── Plate lookup analytics ──────────────────────────────────
  const [plateLookupRes, plateLookupCountRes] = await Promise.all([
    db.from("plate_lookups")
      .select("plate, make, model, year, fuel_type, colour, created_at")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false })
      .limit(20),
    db.from("plate_lookups")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId),
  ]);

  const recentPlateLookups = plateLookupRes.data ?? [];
  const totalPlateLookups = plateLookupCountRes.count ?? 0;

  // Top looked-up makes from plate lookups
  const plateMakeCounts: Record<string, number> = {};
  for (const pl of recentPlateLookups) {
    if (pl.make) plateMakeCounts[pl.make] = (plateMakeCounts[pl.make] || 0) + 1;
  }
  const topPlateMakes = Object.entries(plateMakeCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([make, count]) => ({ make, count }));

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

  // ── Status breakdown (from server-side counts) ─────────────
  const statusCounts: Record<string, number> = {};
  for (const entry of (statusRes as { status: string; count: number }[])) {
    if (entry.count > 0) statusCounts[entry.status] = entry.count;
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

  // ── Conversion funnel (last 30 days) ────────────────────
  const conversionEvents = (conversionEventsRes.data ?? []) as Array<{
    event_type: string;
    source: string;
    vehicle_make: string | null;
    vehicle_model: string | null;
  }>;

  const searchCount = (searchEventsRes.data ?? []).length;
  let viewCount = 0;
  let cartCount = 0;
  let purchaseCount = 0;

  const sourceCounts: Record<string, { views: number; carts: number; purchases: number }> = {};
  const vehicleCounts: Record<string, { views: number; carts: number; purchases: number }> = {};

  for (const evt of conversionEvents) {
    if (evt.event_type === "product_view") viewCount++;
    else if (evt.event_type === "add_to_cart") cartCount++;
    else if (evt.event_type === "purchase") purchaseCount++;

    // Source breakdown
    const src = evt.source || "direct";
    if (!sourceCounts[src]) sourceCounts[src] = { views: 0, carts: 0, purchases: 0 };
    if (evt.event_type === "product_view") sourceCounts[src].views++;
    else if (evt.event_type === "add_to_cart") sourceCounts[src].carts++;
    else if (evt.event_type === "purchase") sourceCounts[src].purchases++;

    // Vehicle breakdown (only if vehicle context exists)
    if (evt.vehicle_make) {
      const vKey = `${evt.vehicle_make}|||${evt.vehicle_model || "(any)"}`;
      if (!vehicleCounts[vKey]) vehicleCounts[vKey] = { views: 0, carts: 0, purchases: 0 };
      if (evt.event_type === "product_view") vehicleCounts[vKey].views++;
      else if (evt.event_type === "add_to_cart") vehicleCounts[vKey].carts++;
      else if (evt.event_type === "purchase") vehicleCounts[vKey].purchases++;
    }
  }

  const conversionFunnel: ConversionFunnel = {
    searches: searchCount,
    productViews: viewCount,
    addToCarts: cartCount,
    purchases: purchaseCount,
    searchToViewRate: searchCount > 0 ? Math.round((viewCount / searchCount) * 1000) / 10 : 0,
    viewToCartRate: viewCount > 0 ? Math.round((cartCount / viewCount) * 1000) / 10 : 0,
    cartToPurchaseRate: cartCount > 0 ? Math.round((purchaseCount / cartCount) * 1000) / 10 : 0,
    overallRate: searchCount > 0 ? Math.round((purchaseCount / searchCount) * 1000) / 10 : 0,
  };

  const conversionBySource: ConversionBySource[] = Object.entries(sourceCounts)
    .map(([source, counts]) => ({ source, ...counts }))
    .sort((a, b) => (b.views + b.carts + b.purchases) - (a.views + a.carts + a.purchases))
    .slice(0, 10);

  const conversionByVehicle: ConversionByVehicle[] = Object.entries(vehicleCounts)
    .map(([key, counts]) => {
      const [make, model] = key.split("|||");
      return { make, model, ...counts };
    })
    .sort((a, b) => (b.views + b.carts + b.purchases) - (a.views + a.carts + a.purchases))
    .slice(0, 15);

  return {
    plan,
    limits,
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
    conversionFunnel,
    conversionBySource,
    conversionByVehicle,
    recentPlateLookups,
    totalPlateLookups,
    topPlateMakes,
    searchCount: (searchEventsRes.data ?? []).length,
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
  const loaderData = useLoaderData<typeof loader>();
  const {
    plan,
    limits,
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
    conversionFunnel,
    conversionBySource,
    conversionByVehicle,
    recentPlateLookups,
    totalPlateLookups,
    topPlateMakes,
    searchCount,
  } = loaderData;
  const gated = "gated" in loaderData && (loaderData as Record<string, unknown>).gated === true;

  const [showExport, setShowExport] = useState(false);

  // Live stats polling via unified hook
  const { stats: liveStats } = useAppData({
    total: fitmentCoverage.total,
    fitments: fitmentCoverage.withFitments,
  });

  // ── Plan gate ──────────────────────────────────────────────
  if (gated || analyticsLevel === "none") {
    return (
      <Page title="Analytics" fullWidth>
        <PlanGate feature="dashboardAnalytics" currentPlan={plan} limits={limits as PlanLimits}>
          {/* Children never shown when gated */}
          <></>
        </PlanGate>
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
      fullWidth
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
        {/* How It Works */}
        <HowItWorks
          steps={[
            { number: 1, title: "Fitment Coverage", description: "Track how many of your products have vehicle compatibility data mapped. Higher coverage means better search results for customers." },
            { number: 2, title: "Popular Vehicles", description: "See which makes and models appear most in your product catalog. Use this to prioritize vehicle data sourcing and collection creation." },
            { number: 3, title: "Supplier Performance", description: "Monitor import quality from each provider — how many products have usable vehicle data, error rates, and mapping success." },
          ]}
        />

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
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={GaugeIcon} bg="var(--p-color-bg-fill-info-secondary)" color="var(--p-color-icon-info)" />
                  <Text as="h2" variant="headingMd">Fitment Coverage</Text>
                </InlineStack>
                <div style={statGridStyle(5)}>
                  {[
                    { icon: ProductIcon, count: fitmentCoverage.total.toLocaleString(), label: "Total Products" },
                    { icon: GaugeIcon, count: fitmentCoverage.withFitments.toLocaleString(), label: "With Fitments" },
                    { icon: AlertTriangleIcon, count: fitmentCoverage.withoutFitments.toLocaleString(), label: "Without Fitments" },
                    { icon: ChartVerticalIcon, count: `${fitmentCoverage.coveragePercent}%`, label: "Coverage" },
                    { icon: ConnectIcon, count: (s.vehicleCoverage ?? Math.round(s.fitments * 8)).toLocaleString(), label: "Vehicle Coverage" },
                  ].map((item) => (
                    <div key={item.label} style={statMiniStyle}>
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
                {fitmentCoverage.coveragePercent > 0 && (
                  <ProgressBar progress={Math.min(fitmentCoverage.coveragePercent, 100)} size="small" />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ── Product Status Breakdown ───────────────────── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={ProductIcon} bg="var(--p-color-bg-fill-success-secondary)" color="var(--p-color-icon-success)" />
                    <Text as="h2" variant="headingMd">Product Status Breakdown</Text>
                  </InlineStack>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {`${fitmentCoverage.total.toLocaleString()} total products`}
                  </Text>
                </InlineStack>
                <div style={statGridStyle(statusBreakdown.length || 1)}>
                  {statusBreakdown.map(({ status, count }) => {
                    const pct = fitmentCoverage.total > 0
                      ? Math.round((count / fitmentCoverage.total) * 100) : 0;
                    const labels: Record<string, string> = {
                      unmapped: "Unmapped", flagged: "Flagged", auto_mapped: "Auto Mapped",
                      smart_mapped: "Smart Mapped", manual_mapped: "Manual", partial: "Partial",
                    };
                    return (
                      <div key={status} style={statMiniStyle}>
                        <BlockStack gap="100">
                          <InlineStack gap="100" blockAlign="center">
                            <Badge tone={STATUS_TONE[status]}>{labels[status] ?? status}</Badge>
                          </InlineStack>
                          <Text as="p" variant="headingMd" fontWeight="bold">
                            {count.toLocaleString()}
                          </Text>
                          <Text as="p" variant="bodySm" tone="subdued">{`${pct}%`}</Text>
                        </BlockStack>
                      </div>
                    );
                  })}
                </div>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ── Popular Makes & Models (side by side) ──── */}
          {!isBasic && (
            <Layout.Section>
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                {/* Popular Makes */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <IconBadge icon={TargetIcon} color="var(--p-color-icon-emphasis)" />
                        <Text as="h2" variant="headingMd">Popular Makes</Text>
                      </InlineStack>
                      <Badge>{`${popularMakes.length} makes`}</Badge>
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

                {/* Popular Models */}
                <Card>
                  <BlockStack gap="400">
                    <InlineStack align="space-between" blockAlign="center">
                      <InlineStack gap="200" blockAlign="center">
                        <IconBadge icon={TargetIcon} color="var(--p-color-icon-emphasis)" />
                        <Text as="h2" variant="headingMd">Popular Models</Text>
                      </InlineStack>
                      <Badge>{`${popularModels.length} models`}</Badge>
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
              </InlineGrid>
            </Layout.Section>
          )}

          {/* ── Supplier Performance ──────────────────────── */}
          {!isBasic && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={PackageIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">
                      Supplier Performance
                    </Text>
                  </InlineStack>
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
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={ChartVerticalIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">
                      Sync Job History
                    </Text>
                  </InlineStack>
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
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={SearchIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingMd">
                        Popular Storefront Searches (Last 30 Days)
                      </Text>
                    </InlineStack>
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

          {/* ── REG Plate Lookups ─────────────────────────── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={SearchIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">REG Plate Lookups</Text>
                  </InlineStack>
                  <Badge>{`${totalPlateLookups} total`}</Badge>
                </InlineStack>
                {recentPlateLookups.length === 0 ? (
                  <Banner tone="info">
                    <p>No plate lookups recorded yet. Plate lookup tracking is now active — data will appear here as customers use the registration lookup widget on your storefront.</p>
                  </Banner>
                ) : (
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric", "text", "text"]}
                    headings={["Plate", "Make", "Model", "Year", "Fuel", "Date"]}
                    rows={recentPlateLookups.map((pl) => [
                      pl.plate,
                      pl.make ?? "—",
                      pl.model ?? "—",
                      pl.year ? String(pl.year) : "—",
                      pl.fuel_type ?? "—",
                      new Date(pl.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
                    ])}
                  />
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ── Conversion Funnel ─────────────────────────── */}
          {!isBasic && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={CartIcon} bg="var(--p-color-bg-fill-warning-secondary)" color="var(--p-color-icon-warning)" />
                    <Text as="h2" variant="headingMd">
                      Conversion Funnel (Last 30 Days)
                    </Text>
                  </InlineStack>

                  {conversionFunnel.searches === 0 && conversionFunnel.productViews === 0 ? (
                    <Banner tone="info">
                      <p>
                        No conversion data yet. As customers use your storefront YMME widget,
                        product views, add-to-cart, and purchase events will appear here
                        automatically.
                      </p>
                    </Banner>
                  ) : (
                    <BlockStack gap="400">
                      {/* Funnel stats row */}
                      <div style={statGridStyle(4)}>
                        <div style={statMiniStyle}>
                          <BlockStack gap="100">
                            <InlineStack gap="100" blockAlign="center">
                              <IconBadge icon={SearchIcon} size={20} color="var(--p-color-icon-emphasis)" />
                              <Text as="p" variant="bodySm" tone="subdued">Searches</Text>
                            </InlineStack>
                            <Text as="p" variant="headingLg" fontWeight="bold">{conversionFunnel.searches.toLocaleString()}</Text>
                          </BlockStack>
                        </div>

                        <div style={statMiniStyle}>
                          <BlockStack gap="100">
                            <InlineStack gap="100" blockAlign="center">
                              <IconBadge icon={ViewIcon} size={20} color="var(--p-color-icon-emphasis)" />
                              <Text as="p" variant="bodySm" tone="subdued">Product Views</Text>
                            </InlineStack>
                            <Text as="p" variant="headingLg" fontWeight="bold">{conversionFunnel.productViews.toLocaleString()}</Text>
                            {conversionFunnel.searchToViewRate > 0 && (
                              <Badge tone="info">{`${conversionFunnel.searchToViewRate}% from search`}</Badge>
                            )}
                          </BlockStack>
                        </div>

                        <div style={statMiniStyle}>
                          <BlockStack gap="100">
                            <InlineStack gap="100" blockAlign="center">
                              <IconBadge icon={CartIcon} size={20} color="var(--p-color-icon-emphasis)" />
                              <Text as="p" variant="bodySm" tone="subdued">Add to Cart</Text>
                            </InlineStack>
                            <Text as="p" variant="headingLg" fontWeight="bold">{conversionFunnel.addToCarts.toLocaleString()}</Text>
                            {conversionFunnel.viewToCartRate > 0 && (
                              <Badge tone="success">{`${conversionFunnel.viewToCartRate}% of views`}</Badge>
                            )}
                          </BlockStack>
                        </div>

                        <div style={statMiniStyle}>
                          <BlockStack gap="100">
                            <InlineStack gap="100" blockAlign="center">
                              <IconBadge icon={OrderIcon} size={20} color="var(--p-color-icon-emphasis)" />
                              <Text as="p" variant="bodySm" tone="subdued">Purchases</Text>
                            </InlineStack>
                            <Text as="p" variant="headingLg" fontWeight="bold">{conversionFunnel.purchases.toLocaleString()}</Text>
                            {conversionFunnel.overallRate > 0 && (
                              <Badge tone="success">{`${conversionFunnel.overallRate}% overall`}</Badge>
                            )}
                          </BlockStack>
                        </div>
                      </div>

                      {/* Funnel progress bars */}
                      <BlockStack gap="200">
                        <InlineStack align="space-between">
                          <Text as="p" variant="bodySm" tone="subdued">Search to View</Text>
                          <Text as="p" variant="bodySm" fontWeight="semibold">{`${conversionFunnel.searchToViewRate}%`}</Text>
                        </InlineStack>
                        <ProgressBar progress={Math.min(conversionFunnel.searchToViewRate, 100)} size="small" />

                        <InlineStack align="space-between">
                          <Text as="p" variant="bodySm" tone="subdued">View to Cart</Text>
                          <Text as="p" variant="bodySm" fontWeight="semibold">{`${conversionFunnel.viewToCartRate}%`}</Text>
                        </InlineStack>
                        <ProgressBar progress={Math.min(conversionFunnel.viewToCartRate, 100)} size="small" />

                        <InlineStack align="space-between">
                          <Text as="p" variant="bodySm" tone="subdued">Cart to Purchase</Text>
                          <Text as="p" variant="bodySm" fontWeight="semibold">{`${conversionFunnel.cartToPurchaseRate}%`}</Text>
                        </InlineStack>
                        <ProgressBar progress={Math.min(conversionFunnel.cartToPurchaseRate, 100)} size="small" />
                      </BlockStack>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* ── Conversions by Source ──────────────────────── */}
          {!isBasic && conversionBySource.length > 0 && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={TargetIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">
                      Conversions by Source
                    </Text>
                  </InlineStack>
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                    headings={["Source", "Views", "Add to Cart", "Purchases"]}
                    rows={conversionBySource.map((s) => [
                      s.source.replace(/_/g, " "),
                      s.views.toLocaleString(),
                      s.carts.toLocaleString(),
                      s.purchases.toLocaleString(),
                    ])}
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* ── Conversions by Vehicle ─────────────────────── */}
          {!isBasic && conversionByVehicle.length > 0 && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={DatabaseIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingMd">
                        Conversions by Vehicle Type (Top 15)
                      </Text>
                    </InlineStack>
                    <Text as="span" variant="bodySm" tone="subdued">
                      Last 30 days
                    </Text>
                  </InlineStack>
                  <DataTable
                    columnContentTypes={["text", "text", "numeric", "numeric", "numeric"]}
                    headings={["Make", "Model", "Views", "Carts", "Purchases"]}
                    rows={conversionByVehicle.map((v) => [
                      v.make,
                      v.model,
                      v.views.toLocaleString(),
                      v.carts.toLocaleString(),
                      v.purchases.toLocaleString(),
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
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={AlertTriangleIcon} bg="var(--p-color-bg-fill-caution-secondary)" color="var(--p-color-icon-caution)" />
                    <Text as="h2" variant="headingMd">
                      Inventory Gap Analysis
                    </Text>
                  </InlineStack>
                  <div style={statGridStyle(4)}>
                    <div style={statMiniStyle}>
                      <BlockStack gap="100" inlineAlign="center">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Total Makes in DB
                        </Text>
                        <Text as="p" variant="headingLg" fontWeight="bold">
                          {totalMakes.toLocaleString()}
                        </Text>
                      </BlockStack>
                    </div>
                    <div style={statMiniStyle}>
                      <BlockStack gap="100" inlineAlign="center">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Total Models in DB
                        </Text>
                        <Text as="p" variant="headingLg" fontWeight="bold">
                          {totalModels.toLocaleString()}
                        </Text>
                      </BlockStack>
                    </div>
                    <div style={statMiniStyle}>
                      <BlockStack gap="100" inlineAlign="center">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Makes Without Products
                        </Text>
                        <Text as="p" variant="headingLg" fontWeight="bold">
                          {inventoryGaps.makesWithoutProducts.toLocaleString()}
                        </Text>
                        {inventoryGaps.makesWithoutProducts > 0 && (
                          <Badge tone="warning">Opportunity</Badge>
                        )}
                      </BlockStack>
                    </div>
                    <div style={statMiniStyle}>
                      <BlockStack gap="100" inlineAlign="center">
                        <Text as="p" variant="bodySm" tone="subdued">
                          Avg Products per Make
                        </Text>
                        <Text as="p" variant="headingLg" fontWeight="bold">
                          {inventoryGaps.productsPerMakeAvg.toLocaleString()}
                        </Text>
                      </BlockStack>
                    </div>
                  </div>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* ── YMME Search Analytics ─────────────────────── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={DatabaseIcon} bg="var(--p-color-bg-fill-info-secondary)" color="var(--p-color-icon-info)" />
                    <Text as="h2" variant="headingMd">
                      YMME Search Analytics
                    </Text>
                  </InlineStack>
                  <Badge>{`${searchCount} searches (30 days)`}</Badge>
                </InlineStack>
                {popularSearches.length === 0 ? (
                  <Banner tone="info">
                    <p>
                      No YMME searches recorded yet. Search tracking is now active — as customers use
                      the Year/Make/Model/Engine widget on your storefront, their search patterns will
                      appear here showing which vehicles are most popular.
                    </p>
                  </Banner>
                ) : (
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm" tone="subdued">Top Searched Vehicles (Last 30 Days)</Text>
                    <DataTable
                      columnContentTypes={["text", "text", "numeric"]}
                      headings={["Make", "Model", "Searches"]}
                      rows={popularSearches.slice(0, 15).map((s) => [s.make, s.model, String(s.count)])}
                    />
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

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


export function ErrorBoundary() {
  return <RouteError pageName="Analytics" />;
}
