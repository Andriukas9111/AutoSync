/**
 * Analytics Dashboard
 *
 * Fitment coverage, popular makes/models, supplier performance,
 * and inventory gap analysis. Gated by dashboardAnalytics plan feature.
 */

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
  Banner,
  ProgressBar,
  Button,
  Collapsible,
  Box,
  Icon,
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
  ChevronUpIcon,
  ChevronDownIcon,
} from "@shopify/polaris-icons";
import { DataTable } from "../components/DataTable";

import { authenticate } from "../shopify.server";
import db, { paginatedSelect } from "../lib/db.server";
import { getTenant, getPlanLimits, assertFeature, getEffectivePlan } from "../lib/billing.server";
import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import { PlanGate } from "../components/PlanGate";
import { statGridStyle, statMiniStyle, formatJobType, autoFitGridStyle, listRowStyle } from "../lib/design";
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
  demandGaps: Array<{ make: string; model: string; searches: number }>;
  // Shopify platform limits tracker — shows how close the store is to
  // caps like 5,000 collections, 250 tags/product, etc.
  shopifyLimits: {
    collections: { used: number; limit: number; label: string; description: string };
    tagsPerProduct: { used: number; limit: number; label: string; description: string };
    products: { used: number; limit: number; label: string; description: string };
    vehiclePages: { used: number; limit: number; label: string; description: string };
    metaobjectDefs: { used: number; limit: number; label: string; description: string };
  };
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
      demandGaps: [],
      shopifyLimits: {
        collections: { used: 0, limit: 5000, label: "Smart Collections", description: "" },
        tagsPerProduct: { used: 0, limit: 250, label: "Tags per Product", description: "" },
        products: { used: 0, limit: 2000000, label: "Products", description: "" },
        vehiclePages: { used: 0, limit: 10000000, label: "Vehicle Spec Pages", description: "" },
        metaobjectDefs: { used: 0, limit: 1000, label: "Metaobject Definitions", description: "" },
      },
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
      searchCount: 0,
      demandGaps: [],
      shopifyLimits: {
        collections: { used: 0, limit: 5000, label: "Smart Collections", description: "" },
        tagsPerProduct: { used: 0, limit: 250, label: "Tags per Product", description: "" },
        products: { used: 0, limit: 2000000, label: "Products", description: "" },
        vehiclePages: { used: 0, limit: 10000000, label: "Vehicle Spec Pages", description: "" },
        metaobjectDefs: { used: 0, limit: 1000, label: "Metaobject Definitions", description: "" },
      },
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
    // Total vehicle products for this tenant (exclude wheels AND staged)
    db.from("products").select("*", { count: "exact", head: true }).eq("shop_id", shopId).neq("product_category", "wheels").neq("status", "staged"),

    // Products that have at least one fitment — cap at 50K to prevent OOM
    db.from("vehicle_fitments").select("product_id")
      .eq("shop_id", shopId).limit(50000),

    // Product fitment status breakdown — vehicle parts only, exclude staged
    Promise.all(
      ["unmapped", "auto_mapped", "smart_mapped", "manual_mapped", "flagged", "no_match", "partial"].map((s) =>
        db.from("products").select("id", { count: "exact", head: true })
          .eq("shop_id", shopId).eq("fitment_status", s)
          .neq("product_category", "wheels").neq("status", "staged")
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

    // Search events (last 30 days) — include result_count for demand gap analysis
    db.from("search_events")
      .select("search_make, search_model, result_count")
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

  // ── Shopify Platform Limits tracker ─────────────────────────
  // Show merchants how close they are to Shopify-imposed caps so they can
  // upgrade the store plan (Plus/Enterprise raise these) or prune data
  // before creates silently start failing. Collections is the most common
  // wall because we create make/make_model/year combinations.
  const [
    collectionsCountRes,
    productsCountRes,
    vehiclePagesCountRes,
    metaobjectDefsCountRes,
  ] = await Promise.all([
    db.from("collection_mappings").select("id", { count: "exact", head: true })
      .eq("shop_id", shopId).not("shopify_collection_id", "is", null),
    db.from("products").select("id", { count: "exact", head: true })
      .eq("shop_id", shopId).neq("status", "staged"),
    db.from("vehicle_page_sync").select("id", { count: "exact", head: true })
      .eq("shop_id", shopId).eq("sync_status", "synced"),
    // Metaobject definitions are 1 for vehicle-spec (shared by all vehicle_pages)
    // so we count them as a constant.
    Promise.resolve({ count: 1 }),
  ]);

  // Product with MOST PROJECTED TAGS — ranks tag usage against Shopify's 250 cap.
  //
  // AutoSync pushes auto-generated tags when products sync to Shopify:
  //   _autosync_{Make}, _autosync_{Make_Model}, _autosync_{Make_Model_Year} for each year in range.
  // PLUS any base tags the merchant/provider already set on the product.
  //
  // A product with many fitments (e.g., a universal VAG engine part that fits 6 makes, 40 models,
  // across 20 years) can silently exceed Shopify's 250 tags/product cap — Shopify will reject the
  // push. Merchants need to know WHICH products are hitting the cap so they can prune fitments
  // or split the product. That's why we show the peak product with its projected tag total.
  //
  // We compute this via a single JOIN query (base tags + distinct make/model tags + year range
  // totals) instead of fetching rows and iterating in JS — the JS approach capped at limit(50)
  // and missed the real peak products which have the most fitments.
  const { data: topTagProducts } = await db.rpc("get_top_tag_products", {
    p_shop_id: shopId,
    p_limit: 5,
  }).select();

  // Fallback: if RPC doesn't exist yet, compute manually via SQL-ish approach on client.
  // We ask Supabase for top-10 products by fitment count, then compute projected tags.
  let maxTagsProduct: { title: string; tagCount: number; handle: string } | null = null;
  if (topTagProducts && Array.isArray(topTagProducts) && topTagProducts.length > 0) {
    const top = topTagProducts[0] as { title: string; handle: string; total_tags: number };
    maxTagsProduct = { title: top.title, tagCount: top.total_tags, handle: top.handle };
  } else {
    // RPC not deployed — fall back to a direct SQL-ish computation.
    // Fetch top 200 products with most fitments (those are most likely candidates for tag peak)
    // then compute projected tag count per product.
    const { data: fitmentAgg } = await db
      .from("vehicle_fitments")
      .select("product_id, make, model, year_from, year_to")
      .eq("shop_id", shopId)
      .limit(50000);

    // Build per-product stats in memory: distinct makes, distinct (make,model), year-range total
    const perProduct: Record<string, { makes: Set<string>; models: Set<string>; years: number }> = {};
    for (const f of fitmentAgg ?? []) {
      const rec = f as { product_id: string; make: string | null; model: string | null; year_from: number | null; year_to: number | null };
      if (!perProduct[rec.product_id]) {
        perProduct[rec.product_id] = { makes: new Set(), models: new Set(), years: 0 };
      }
      if (rec.make) perProduct[rec.product_id].makes.add(rec.make);
      if (rec.make && rec.model) perProduct[rec.product_id].models.add(`${rec.make}|${rec.model}`);
      if (rec.year_from && rec.year_to) perProduct[rec.product_id].years += (rec.year_to - rec.year_from + 1);
      else if (rec.year_from) perProduct[rec.product_id].years += 1;
    }

    // Find the top-5 product_ids by projected tag count
    const scored = Object.entries(perProduct)
      .map(([pid, s]) => ({ pid, tagCount: s.makes.size + s.models.size + s.years }))
      .sort((a, b) => b.tagCount - a.tagCount)
      .slice(0, 5);

    if (scored.length > 0) {
      // Fetch titles/handles for those IDs — plus base tag count
      const topIds = scored.map((s) => s.pid);
      const { data: productRows } = await db
        .from("products")
        .select("id, title, handle, tags")
        .in("id", topIds);

      // Merge: base_tags + projected from fitments → find the true peak.
      const enriched = scored.map((s) => {
        const pr = (productRows ?? []).find((p) => String(p.id) === s.pid) as
          | { title: string; handle: string; tags: unknown }
          | undefined;
        const baseTags = Array.isArray(pr?.tags) ? pr!.tags.length : 0;
        return {
          title: pr?.title ?? "Unknown",
          handle: pr?.handle ?? "",
          tagCount: s.tagCount + baseTags,
        };
      }).sort((a, b) => b.tagCount - a.tagCount);

      maxTagsProduct = enriched[0] ?? null;
    }
  }

  // Shopify limits. These are public Shopify API limits as of 2026.
  // Plus/Enterprise stores get higher caps; we assume standard cap so the
  // warning is pessimistic and safe. If merchant is on Plus, they'll see
  // "cap reached" later than they actually would.
  const shopifyLimits = {
    collections: {
      used: collectionsCountRes.count ?? 0,
      limit: 5000,          // Standard store max
      label: "Smart Collections",
      description: "Shopify caps stores at 5,000 collections. Plus/Enterprise raises this to 50,000.",
    },
    tagsPerProduct: {
      used: maxTagsProduct?.tagCount ?? 0,
      limit: 250,
      label: maxTagsProduct
        ? `Projected Tags on "${maxTagsProduct.title.length > 48 ? maxTagsProduct.title.slice(0, 48) + "…" : maxTagsProduct.title}"`
        : "Projected Tags per Product",
      description: "Shopify caps each product at 250 tags. AutoSync pushes _autosync_{Make}, _autosync_{Make_Model}, _autosync_{Make_Model_Year} tags based on fitments — plus your base tags. Products with many fitments (universal parts spanning multiple makes/years) can silently exceed 250 and fail to push. The product shown has the highest projected tag count in your catalog.",
    },
    products: {
      used: productsCountRes.count ?? 0,
      limit: 2_000_000,     // Standard Shopify cap; Plus is unlimited
      label: "Products",
      description: "Standard Shopify plans cap at 2M products per store.",
    },
    vehiclePages: {
      used: vehiclePagesCountRes.count ?? 0,
      limit: 10_000_000,    // Metaobject entries per type — very high
      label: "Vehicle Spec Pages",
      description: "Metaobjects per type: 10M. Essentially unlimited for automotive use.",
    },
    metaobjectDefs: {
      used: (metaobjectDefsCountRes.count ?? 0),
      limit: 1000,
      label: "Metaobject Definitions",
      description: "Max 1,000 metaobject definitions per store.",
    },
  };

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
  //
  // IMPORTANT: We return ALL models across ALL makes in `popularMakes` (not a global top-15).
  // The drilldown in Fitment Coverage by Make filters popularModels by make on the client,
  // so if we only returned the top-15 global models, makes like Renault (whose top model
  // Megane has 72 fitments, losing to the Big 3 German makes) would show "0 models" in the
  // drilldown even though the make has dozens of models with fitments. That was the bug.
  //
  // To keep payload small we:
  //   - Include all models for each make in the top-15 makes list (popularMakes)
  //   - Skip all other makes
  // For a typical store this is ~15 makes × ~30 models = ~450 rows. Fits well in payload.
  const topMakeSet = new Set<string>();
  // We need to know which makes are in popularMakes; compute that first.
  const interimPopularMakes = Object.entries(makeFitmentCounts)
    .map(([make, data]) => ({ make, fitmentCount: data.fitments, productCount: data.products.size }))
    .sort((a, b) => b.fitmentCount - a.fitmentCount)
    .slice(0, 15);
  for (const m of interimPopularMakes) topMakeSet.add(m.make);

  const modelFitmentCounts: Record<string, number> = {};
  const modelMakes: Record<string, string> = {};
  for (const f of fitmentsByModelRes.data ?? []) {
    const rec = f as { make: string; model: string };
    if (!rec.model || !rec.make) continue;
    // Only track models for the top 15 makes — keeps payload small while giving the drilldown full detail.
    if (!topMakeSet.has(rec.make)) continue;
    const key = `${rec.make}|||${rec.model}`;
    modelFitmentCounts[key] = (modelFitmentCounts[key] ?? 0) + 1;
    modelMakes[key] = rec.make;
  }
  const popularModels: PopularModel[] = Object.entries(modelFitmentCounts)
    .map(([key, fitmentCount]) => {
      const [make, model] = key.split("|||");
      return { make, model, fitmentCount };
    })
    .sort((a, b) => b.fitmentCount - a.fitmentCount);

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

  // ── Demand gaps — vehicles searched with 0 results ──────
  const demandGapCounts: Record<string, { searches: number; resultsFound: number }> = {};
  for (const s of (searchEventsRes.data ?? []) as Array<{ search_make: string; search_model: string; result_count: number | null }>) {
    const key = `${s.search_make}|||${s.search_model || "(any model)"}`;
    if (!demandGapCounts[key]) demandGapCounts[key] = { searches: 0, resultsFound: 0 };
    demandGapCounts[key].searches++;
    demandGapCounts[key].resultsFound = Math.max(demandGapCounts[key].resultsFound, s.result_count ?? 0);
  }
  const demandGaps = Object.entries(demandGapCounts)
    .filter(([, data]) => data.resultsFound === 0)
    .map(([key, data]) => {
      const [make, model] = key.split("|||");
      return { make, model, searches: data.searches };
    })
    .sort((a, b) => b.searches - a.searches);

  // ── Popular storefront searches (last 30 days) ──────────
  const searchCounts: Record<string, number> = {};
  for (const s of (searchEventsRes.data ?? []) as Array<{ search_make: string; search_model: string; result_count: number | null }>) {
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
    demandGaps,
    shopifyLimits,
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
    syncJobSummary,
    popularSearches,
    conversionFunnel,
    searchCount,
    demandGaps,
    recentPlateLookups,
    totalPlateLookups,
    conversionBySource,
    conversionByVehicle,
    providerMetrics,
    shopifyLimits,
  } = loaderData;
  const gated = "gated" in loaderData && (loaderData as Record<string, unknown>).gated === true;

  const navigate = useNavigate();

  // Live stats polling via unified hook
  const { stats: liveStats } = useAppData({
    total: fitmentCoverage.total,
    fitments: fitmentCoverage.withFitments,
    vehicleCoverage: Math.round(fitmentCoverage.withFitments * 8),
  });

  // Expandable make drilldown
  const [expandedMake, setExpandedMake] = useState<string | null>(null);

  // ── Plan gate ──────────────────────────────────────────────
  if (gated || analyticsLevel === "none") {
    return (
      <Page title="Analytics" fullWidth>
        <PlanGate feature="dashboardAnalytics" currentPlan={plan} limits={limits as PlanLimits}>
          <></>
        </PlanGate>
      </Page>
    );
  }

  const isBasic = analyticsLevel === "basic";

  // Models for drilldown
  const modelsForMake = (make: string) =>
    popularModels.filter((m) => m.make === make);

  // Export handler removed — add back when proper CSV report is implemented
  return (
    <Page
      fullWidth
      title="Analytics"
      subtitle="Fitment coverage, demand insights, and conversion tracking"
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

        {/* ── Key Metrics — unified stat bar ──────────────── */}
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <div style={{ ...autoFitGridStyle("100px", "0px"), borderBottom: "1px solid var(--p-color-border-secondary)" }}>
                {[
                  { icon: ProductIcon, count: fitmentCoverage.total.toLocaleString(), label: "Products" },
                  { icon: GaugeIcon, count: fitmentCoverage.withFitments.toLocaleString(), label: "Mapped" },
                  { icon: ChartVerticalIcon, count: `${fitmentCoverage.coveragePercent}%`, label: "Coverage" },
                  { icon: SearchIcon, count: searchCount.toLocaleString(), label: "Searches (30d)" },
                  { icon: ViewIcon, count: conversionFunnel.productViews.toLocaleString(), label: "Views (30d)" },
                ].map((item, i) => (
                  <div key={item.label} style={{ padding: "var(--p-space-400)", borderRight: i < 4 ? "1px solid var(--p-color-border-secondary)" : "none", textAlign: "center" }}>
                    <BlockStack gap="200" inlineAlign="center">
                      <IconBadge icon={item.icon} color="var(--p-color-icon-emphasis)" />
                      <Text as="p" variant="headingLg" fontWeight="bold">{item.count}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">{item.label}</Text>
                    </BlockStack>
                  </div>
                ))}
              </div>
            </Card>
          </Layout.Section>

          {/* ── Shopify Platform Limits ────────────────────── */}
          {/* Shows how close this store is to Shopify caps (5K collections, */}
          {/* 250 tags/product, etc.) so merchants can upgrade store plan or */}
          {/* prune data before Shopify silently starts rejecting creates. */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={GaugeIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">Shopify Platform Limits</Text>
                  </InlineStack>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Live usage vs Shopify-imposed caps
                  </Text>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Shopify enforces hard caps on collections, tags, and metafields per store. When you hit them, new creates silently fail. Monitor these numbers so you can upgrade to Shopify Plus or prune unused data before they block AutoSync.
                </Text>
                <BlockStack gap="300">
                  {[
                    shopifyLimits.collections,
                    shopifyLimits.tagsPerProduct,
                    shopifyLimits.products,
                    shopifyLimits.vehiclePages,
                    shopifyLimits.metaobjectDefs,
                  ].map((limit) => {
                    const pct = Math.min(100, Math.round((limit.used / limit.limit) * 100));
                    const tone: "success" | "warning" | "critical" =
                      pct >= 90 ? "critical" : pct >= 75 ? "warning" : "success";
                    return (
                      <Card key={limit.label} padding="400" background="bg-surface-secondary">
                        <BlockStack gap="200">
                          <InlineStack align="space-between" blockAlign="center" wrap={false}>
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="p" variant="bodyMd" fontWeight="medium">{limit.label}</Text>
                              <Badge tone={tone}>{`${pct}% used`}</Badge>
                            </InlineStack>
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {`${limit.used.toLocaleString()} / ${limit.limit.toLocaleString()}`}
                            </Text>
                          </InlineStack>
                          <ProgressBar progress={pct} tone={tone === "success" ? undefined : tone === "warning" ? "highlight" : "critical"} size="small" />
                          <Text as="p" variant="bodySm" tone="subdued">
                            {limit.description}
                          </Text>
                        </BlockStack>
                      </Card>
                    );
                  })}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ── Demand Gaps — vehicles searched with 0 matching products ── */}
          {demandGaps && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={AlertTriangleIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingMd">Inventory Gaps</Text>
                    </InlineStack>
                    <Badge tone={demandGaps.length > 0 ? "warning" : "success"}>
                      {demandGaps.length > 0 ? `${demandGaps.length} gaps` : "No gaps"}
                    </Badge>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Vehicles customers searched for but found 0 matching products. Fill these gaps to capture missed sales.
                  </Text>
                  {demandGaps.length > 0 ? (
                    <DataTable
                      columnContentTypes={["text", "text", "numeric"]}
                      headings={["Make", "Model", "Searches"]}
                      rows={demandGaps.map((g) => [g.make, g.model, g.searches.toLocaleString()])}
                    />
                  ) : (
                    <Text as="p" variant="bodySm" tone="subdued">
                      No demand gaps detected yet. As customers use your YMME search widget, vehicles with no matching products will appear here.
                    </Text>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* Coverage by Make — see Fitment page for detailed drilldown */}

          {/* ── Product Status Breakdown ───────────────────── */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={ProductIcon} color="var(--p-color-icon-emphasis)" />
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

          {/* ── Fitment Coverage by Make — expandable drilldown (same pattern as Recent Fitment Activity) ── */}
          {!isBasic && popularMakes.length > 0 && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={TargetIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingMd">Fitment Coverage by Make</Text>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">{`${popularMakes.length} makes · ${popularModels.length} models`}</Text>
                  </InlineStack>

                  <BlockStack gap="0">
                    {popularMakes.map((m, idx) => {
                      const isExpanded = expandedMake === m.make;
                      const models = modelsForMake(m.make);
                      const isLast = idx === popularMakes.length - 1;

                      return (
                        <div key={m.make}>
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => setExpandedMake(isExpanded ? null : m.make)}
                            onKeyDown={(e) => { if (e.key === "Enter") setExpandedMake(isExpanded ? null : m.make); }}
                            style={{
                              ...listRowStyle(isLast && !isExpanded),
                              cursor: "pointer",
                              backgroundColor: isExpanded ? "var(--p-color-bg-surface-hover)" : "var(--p-color-bg-surface)",
                              flexWrap: "wrap",
                            }}
                          >
                            <div style={{ flex: "1 1 0", minWidth: 0 }}>
                              <BlockStack gap="100">
                                <Text as="span" variant="bodyMd" fontWeight="semibold">{m.make}</Text>
                                <InlineStack gap="200" blockAlign="center" wrap>
                                  <Badge tone="info" size="small">{`${m.fitmentCount} fitments`}</Badge>
                                  <Text as="span" variant="bodySm" tone="subdued">{`${m.productCount} product${m.productCount !== 1 ? "s" : ""} · ${models.length} model${models.length !== 1 ? "s" : ""}`}</Text>
                                </InlineStack>
                              </BlockStack>
                            </div>
                            <InlineStack gap="200" blockAlign="center">
                              {models.slice(0, 3).map((mod) => (
                                <Badge key={mod.model} size="small">{mod.model}</Badge>
                              ))}
                              {models.length > 3 && <Badge size="small">{`+${models.length - 3}`}</Badge>}
                              <Icon source={isExpanded ? ChevronUpIcon : ChevronDownIcon} />
                            </InlineStack>
                          </div>

                          <Collapsible open={isExpanded} id={`make-${m.make}`} transition={{ duration: "200ms", timingFunction: "ease-in-out" }}>
                            <Box padding="400" background="bg-surface-secondary">
                              <BlockStack gap="200">
                                <Text as="p" variant="bodySm" fontWeight="semibold">Models ({models.length})</Text>
                                <div style={{ overflowX: "auto" }}>
                                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                    <thead><tr style={{ borderBottom: "1px solid var(--p-color-border-secondary)" }}>
                                      {["Model", "Fitments"].map((h) => (
                                        <th key={h} style={{ textAlign: h === "Fitments" ? "right" : "left", padding: "var(--p-space-100) var(--p-space-200)" }}>
                                          <Text as="span" variant="bodySm" fontWeight="semibold">{h}</Text>
                                        </th>
                                      ))}
                                    </tr></thead>
                                    <tbody>{models.map((mod) => (
                                      <tr key={mod.model} style={{ borderBottom: "1px solid var(--p-color-border-secondary)" }}>
                                        <td style={{ padding: "var(--p-space-100) var(--p-space-200)" }}>
                                          <Text as="span" variant="bodySm">{mod.model}</Text>
                                        </td>
                                        <td style={{ textAlign: "right", padding: "var(--p-space-100) var(--p-space-200)" }}>
                                          <Text as="span" variant="bodySm">{mod.fitmentCount.toLocaleString()}</Text>
                                        </td>
                                      </tr>
                                    ))}</tbody>
                                  </table>
                                </div>
                              </BlockStack>
                            </Box>
                          </Collapsible>
                        </div>
                      );
                    })}
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* ── Storefront Widget Usage — YMME + REG Plate side by side ── */}
          <Layout.Section>
            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      <IconBadge icon={SearchIcon} color="var(--p-color-icon-emphasis)" />
                      <Text as="h2" variant="headingMd">YMME Searches</Text>
                    </InlineStack>
                    <Badge>{`${searchCount} total`}</Badge>
                  </InlineStack>
                  {popularSearches.length === 0 ? (
                    <Text as="p" variant="bodySm" tone="subdued">No searches recorded yet. Data will appear as customers use the vehicle search widget.</Text>
                  ) : (
                    <DataTable
                      columnContentTypes={["text", "text", "numeric"]}
                      headings={["Make", "Model", "Searches"]}
                      rows={popularSearches.slice(0, 10).map((s) => [s.make, s.model, s.count.toLocaleString()])}
                    />
                  )}
                </BlockStack>
              </Card>
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
                    <Text as="p" variant="bodySm" tone="subdued">No lookups recorded yet. Data will appear as customers use the registration lookup widget.</Text>
                  ) : (
                    <DataTable
                      columnContentTypes={["text", "text", "text", "text"]}
                      headings={["Plate", "Make", "Model", "Date"]}
                      rows={recentPlateLookups.slice(0, 10).map((pl) => [
                        pl.plate, pl.make ?? "—", pl.model ?? "—",
                        new Date(pl.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
                      ])}
                    />
                  )}
                </BlockStack>
              </Card>
            </InlineGrid>
          </Layout.Section>

          {/* ── Sync Job History — full width ── */}
          {!isBasic && syncJobSummary.length > 0 && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={ChartVerticalIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">Sync Job History</Text>
                  </InlineStack>
                  <DataTable
                    columnContentTypes={["text", "numeric", "numeric", "numeric", "text"]}
                    headings={["Job Type", "Total Runs", "Completed", "Failed", "Success Rate"]}
                    rows={syncJobSummary.map((j) => [
                      formatJobType(j.type),
                      j.total.toLocaleString(),
                      j.completed.toLocaleString(),
                      j.failed.toLocaleString(),
                      `${j.successRate}%`,
                    ])}
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

          {/* ── Conversion Funnel ─────────────────────────── */}
          {!isBasic && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={CartIcon} color="var(--p-color-icon-emphasis)" />
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
                      {/* Funnel stats — unified stat bar pattern */}
                      <Card padding="0">
                        <div style={{ ...autoFitGridStyle("100px", "0px"), borderBottom: "1px solid var(--p-color-border-secondary)" }}>
                          {[
                            { icon: SearchIcon, count: conversionFunnel.searches, label: "Searches" },
                            { icon: ViewIcon, count: conversionFunnel.productViews, label: "Product Views" },
                            { icon: CartIcon, count: conversionFunnel.addToCarts, label: "Add to Cart" },
                            { icon: OrderIcon, count: conversionFunnel.purchases, label: "Purchases" },
                          ].map((item, i) => (
                            <div key={item.label} style={{ padding: "var(--p-space-400)", borderRight: i < 3 ? "1px solid var(--p-color-border-secondary)" : "none", textAlign: "center" }}>
                              <BlockStack gap="200" inlineAlign="center">
                                <IconBadge icon={item.icon} color="var(--p-color-icon-emphasis)" />
                                <Text as="p" variant="headingLg" fontWeight="bold">{item.count.toLocaleString()}</Text>
                                <Text as="p" variant="bodySm" tone="subdued">{item.label}</Text>
                              </BlockStack>
                            </div>
                          ))}
                        </div>
                      </Card>

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

          {/* ── Conversions by Source + Vehicle Type ─────── */}
          {!isBasic && (conversionBySource.length > 0 || conversionByVehicle.length > 0) && (
            <Layout.Section>
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                {conversionBySource.length > 0 && (
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack gap="200" blockAlign="center">
                        <IconBadge icon={TargetIcon} color="var(--p-color-icon-emphasis)" />
                        <Text as="h2" variant="headingMd">Conversions by Source</Text>
                      </InlineStack>
                      <DataTable
                        columnContentTypes={["text", "numeric", "numeric", "numeric"]}
                        headings={["Source", "Views", "Add to Cart", "Purchases"]}
                        rows={conversionBySource.map((s) => [s.source.replace(/_/g, " "), s.views.toLocaleString(), s.carts.toLocaleString(), s.purchases.toLocaleString()])}
                      />
                    </BlockStack>
                  </Card>
                )}
                {conversionByVehicle.length > 0 && (
                  <Card>
                    <BlockStack gap="400">
                      <InlineStack align="space-between" blockAlign="center">
                        <InlineStack gap="200" blockAlign="center">
                          <IconBadge icon={DatabaseIcon} color="var(--p-color-icon-emphasis)" />
                          <Text as="h2" variant="headingMd">Conversions by Vehicle</Text>
                        </InlineStack>
                        <Text as="span" variant="bodySm" tone="subdued">Last 30 days</Text>
                      </InlineStack>
                      <DataTable
                        columnContentTypes={["text", "text", "numeric", "numeric", "numeric"]}
                        headings={["Make", "Model", "Views", "Carts", "Purchases"]}
                        rows={conversionByVehicle.map((v) => [v.make, v.model, v.views.toLocaleString(), v.carts.toLocaleString(), v.purchases.toLocaleString()])}
                      />
                    </BlockStack>
                  </Card>
                )}
              </InlineGrid>
            </Layout.Section>
          )}

          {/* Inventory Gap Analysis removed — confusing for users, not actionable */}

          {/* YMME Search Analytics removed — duplicate of Popular Storefront Searches above */}

          {/* ── Basic plan upsell ─────────────────────────── */}
          {/* ── Supplier Performance — full width ── */}
          {!isBasic && providerMetrics.length > 0 && (
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={PackageIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">Supplier Performance</Text>
                  </InlineStack>
                  <DataTable
                    columnContentTypes={["text", "text", "text", "numeric", "text"]}
                    headings={["Provider", "Type", "Status", "Products", "Last Fetch"]}
                    rows={providerMetrics.map((p) => [
                      p.name,
                      p.type.toUpperCase(),
                      p.status,
                      p.productCount.toLocaleString(),
                      p.lastFetchAt ? new Date(p.lastFetchAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "Never",
                    ])}
                  />
                </BlockStack>
              </Card>
            </Layout.Section>
          )}

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
