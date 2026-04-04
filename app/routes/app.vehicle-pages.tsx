import { useState, useCallback, useMemo, useEffect } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useFetcher, useNavigate } from "react-router";
import { data } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  InlineGrid,
  Badge,
  Button,
  Banner,
  Box,
  Divider,
  EmptyState,
  Icon,
  Spinner,
  Modal,
  ProgressBar,
  Collapsible,
  TextField,
  Select,
  Pagination,
} from "@shopify/polaris";
import {
  PageIcon,
  CheckCircleIcon,
  ClockIcon,
  AlertCircleIcon,
  ViewIcon,
  DeleteIcon,
  ProductIcon,
  SearchIcon,
  RefreshIcon,
  ChartVerticalFilledIcon,
  LinkIcon,
  SettingsIcon,
  ArrowRightIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import {
  getPlanLimits,
  getTenant,
  assertFeature,
  BillingGateError,
  getSerializedPlanLimits,
  getEffectivePlan,
} from "../lib/billing.server";
import { PlanGate } from "../components/PlanGate";
import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import { useAppData } from "../lib/use-app-data";
import { statMiniStyle, statGridStyle, STATUS_TONES, autoFitGridStyle } from "../lib/design";
import type { PlanTier } from "../lib/types";
import { RouteError } from "../components/RouteError";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VehicleRow {
  engineId: string;
  makeName: string;
  modelName: string;
  generation: string | null;
  engineName: string | null;
  engineCode: string | null;
  displacementCc: number | null;
  powerHp: number | null;
  powerKw: number | null;
  torqueNm: number | null;
  fuelType: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  bodyType: string | null;
  aspiration: string | null;
  cylinders: number | null;
  cylinderConfig: string | null;
  modification: string | null;
  productCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDisplacement(cc: number | null): string {
  if (!cc) return "";
  const litres = (cc / 1000).toFixed(1);
  return `${litres}L`;
}

function formatYearRange(from: number | null, to: number | null): string {
  if (!from && !to) return "All years";
  if (from && !to) return `${from}+`;
  if (!from && to) return `–${to}`;
  if (from === to) return `${from}`;
  return `${from}–${to}`;
}

function formatPower(hp: number | null): string {
  if (!hp) return "";
  return `${hp} HP`;
}

const stepNumberStyle = (active: boolean) =>
  ({
    width: "28px",
    height: "28px",
    borderRadius: "var(--p-border-radius-full)",
    background: active
      ? "var(--p-color-bg-fill-emphasis)"
      : "var(--p-color-bg-surface-secondary)",
    color: active
      ? "var(--p-color-text-inverse)"
      : "var(--p-color-text-secondary)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    fontSize: "13px",
    flexShrink: 0,
  }) as const;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Plan-gate: vehiclePages is Enterprise-only
  try {
    await assertFeature(shopId, "vehiclePages");
  } catch (err: unknown) {
    if (err instanceof BillingGateError) {
      const tenant = await getTenant(shopId);
      const plan: PlanTier = getEffectivePlan(tenant as any);
      const limits = getPlanLimits(plan);
      return data(
        {
          gated: true as const,
          plan,
          limits,
          allLimits: getSerializedPlanLimits(),
          syncStats: { synced: 0, pending: 0, failed: 0 },
          availableVehicles: 0,
          vehicles: [] as VehicleRow[],
          syncedEngineIds: [] as string[],
          vehiclePagesEnabled: false,
          totalLinkedProducts: 0,
        },
        { status: 403 },
      );
    }
    throw err;
  }

  const tenant = await getTenant(shopId);
  const plan: PlanTier = getEffectivePlan(tenant as any);
  const limits = getPlanLimits(plan);

  // Run all queries in parallel
  const [
    syncStatsResult,
    availableResult,
    vehiclesResult,
    syncedResult,
    settingsResult,
  ] = await Promise.all([
    // 1. Count by sync_status
    db
      .from("vehicle_page_sync")
      .select("sync_status")
      .eq("shop_id", shopId),

    // 2. Count unique engine IDs from fitments (for "Total Available")
    // Uses head:true to avoid fetching all rows (Supabase 1000-row limit)
    db
      .from("vehicle_fitments")
      .select("ymme_engine_id")
      .eq("shop_id", shopId)
      .not("ymme_engine_id", "is", null),

    // 3. Fetch fitments — paginated to handle >1000 rows
    // We fetch ALL fitments with engine IDs for the vehicle browser
    db
      .from("vehicle_fitments")
      .select(
        `
        id,
        ymme_engine_id,
        make,
        model,
        engine,
        engine_code,
        fuel_type,
        year_from,
        year_to,
        variant,
        product_id
      `,
      )
      .eq("shop_id", shopId)
      .not("ymme_engine_id", "is", null)
      .limit(1000),

    // 4. Fetch synced engine IDs
    db
      .from("vehicle_page_sync")
      .select("engine_id, linked_product_count")
      .eq("shop_id", shopId)
      .eq("sync_status", "synced"),

    // 5. Fetch app_settings
    db
      .from("app_settings")
      .select("vehicle_pages_enabled")
      .eq("shop_id", shopId)
      .maybeSingle(),
  ]);

  // Aggregate sync stats
  const syncStats = { synced: 0, pending: 0, failed: 0 };
  if (syncStatsResult.data) {
    for (const row of syncStatsResult.data) {
      if (row.sync_status === "synced") syncStats.synced++;
      else if (row.sync_status === "pending") syncStats.pending++;
      else if (row.sync_status === "failed") syncStats.failed++;
    }
  }

  // Count unique vehicles — use the engine IDs from availableResult
  // Since Supabase caps at 1000 rows, we need to paginate for the count
  const availEngineIds = new Set<string>();
  for (const f of (availableResult.data ?? []) as Record<string, unknown>[]) {
    if (f.ymme_engine_id) availEngineIds.add(f.ymme_engine_id as string);
  }
  // If we got exactly 1000, there are more — fetch remaining pages
  if ((availableResult.data?.length ?? 0) >= 1000) {
    let offset = 1000;
    while (true) {
      const { data: moreFitments } = await db
        .from("vehicle_fitments")
        .select("ymme_engine_id")
        .eq("shop_id", shopId)
        .not("ymme_engine_id", "is", null)
        .range(offset, offset + 999);
      if (!moreFitments || moreFitments.length === 0) break;
      for (const f of moreFitments) {
        if (f.ymme_engine_id) availEngineIds.add(f.ymme_engine_id);
      }
      offset += moreFitments.length;
      if (moreFitments.length < 1000) break;
    }
  }
  const uniqueVehicleKeys = availEngineIds;

  // Also paginate the vehicle browser fitments if needed
  let allVehicleFitments = vehiclesResult.data ?? [];
  if (allVehicleFitments.length >= 1000) {
    let offset = 1000;
    while (true) {
      const { data: moreVehicles } = await db
        .from("vehicle_fitments")
        .select("id, ymme_engine_id, make, model, engine, engine_code, fuel_type, year_from, year_to, variant, product_id")
        .eq("shop_id", shopId)
        .not("ymme_engine_id", "is", null)
        .range(offset, offset + 999);
      if (!moreVehicles || moreVehicles.length === 0) break;
      allVehicleFitments = [...allVehicleFitments, ...moreVehicles];
      offset += moreVehicles.length;
      if (moreVehicles.length < 1000) break;
    }
  }

  // Look up YMME engine data for fitments that have ymme_engine_id
  const engineIdsFromFitments = allVehicleFitments
    .map((r: any) => r.ymme_engine_id)
    .filter(Boolean) as string[];
  const uniqueEngineIds = [...new Set(engineIdsFromFitments)];

  let ymmeEngineData: Record<string, any> = {};
  if (uniqueEngineIds.length > 0) {
    const { data: engines } = await db
      .from("ymme_engines")
      .select(`
        id, name, code, displacement_cc, power_hp, power_kw, torque_nm,
        fuel_type, year_from, year_to, body_type, aspiration,
        cylinders, cylinder_config, modification,
        model:ymme_models!model_id (
          name, generation,
          make:ymme_makes!make_id ( name )
        )
      `)
      .in("id", uniqueEngineIds);
    if (engines) {
      for (const e of engines) {
        ymmeEngineData[e.id] = e;
      }
    }
  }

  // Build vehicle rows — ONLY vehicles with ymme_engine_id
  // Fitments without engine IDs are product categories (e.g. "Brake Lines") not real vehicles
  const vehicleMap = new Map<string, VehicleRow>();
  if (allVehicleFitments.length > 0) {
    for (const row of allVehicleFitments as Record<string, unknown>[]) {
      // Only include fitments with engine IDs — skip text-only entries
      if (!row.ymme_engine_id) continue;
      const key = `engine:${row.ymme_engine_id}`;

      if (vehicleMap.has(key)) {
        vehicleMap.get(key)!.productCount++;
        continue;
      }

      // Try YMME enrichment first
      const ymme = row.ymme_engine_id ? ymmeEngineData[row.ymme_engine_id] : null;
      const ymmeModel = ymme?.model as Record<string, unknown> | undefined;
      const ymmeMake = ymmeModel?.make as Record<string, unknown> | undefined;

      vehicleMap.set(key, {
        engineId: row.ymme_engine_id || key,
        makeName: ymmeMake?.name ?? row.make ?? "Unknown",
        modelName: ymmeModel?.name ?? row.model ?? "Unknown",
        generation: (() => { const g = ymmeModel?.generation ?? row.variant ?? null; return g && !g.includes(" | ") && !g.startsWith(ymmeModel?.name ?? "___") ? g : null; })(),
        engineName: ymme?.name ?? row.engine ?? null,
        engineCode: ymme?.code ?? row.engine_code ?? null,
        displacementCc: ymme?.displacement_cc ?? null,
        powerHp: ymme?.power_hp ?? null,
        powerKw: ymme?.power_kw ?? null,
        torqueNm: ymme?.torque_nm ?? null,
        fuelType: ymme?.fuel_type ?? row.fuel_type ?? null,
        yearFrom: ymme?.year_from ?? row.year_from ?? null,
        yearTo: ymme?.year_to ?? row.year_to ?? null,
        bodyType: ymme?.body_type ?? null,
        aspiration: ymme?.aspiration ?? null,
        cylinders: ymme?.cylinders ?? null,
        cylinderConfig: ymme?.cylinder_config ?? null,
        modification: ymme?.modification ?? null,
        productCount: 1,
      });
    }
  }
  const engineMap = vehicleMap;

  // Sort by make, then model, then engine name — take first 50
  const vehicles = Array.from(engineMap.values())
    .sort((a, b) => {
      const makeCompare = a.makeName.localeCompare(b.makeName);
      if (makeCompare !== 0) return makeCompare;
      const modelCompare = a.modelName.localeCompare(b.modelName);
      if (modelCompare !== 0) return modelCompare;
      return (a.engineName ?? "").localeCompare(b.engineName ?? "");
    })
;

  // Synced engine IDs
  const syncedEngineIds = (syncedResult.data ?? []).map(
    (r: any) => r.engine_id as string,
  );

  // Total linked products: count distinct products with fitments linked to synced vehicle pages
  const syncedEngineIdSet = new Set(syncedEngineIds);
  const linkedProductIds = new Set<string>();
  for (const f of allVehicleFitments as Record<string, unknown>[]) {
    if (f.product_id && f.ymme_engine_id && syncedEngineIdSet.has(f.ymme_engine_id)) {
      linkedProductIds.add(f.product_id);
    }
  }
  const totalLinkedProducts = linkedProductIds.size;

  return {
    gated: false as const,
    plan,
    limits,
    allLimits: getSerializedPlanLimits(),
    syncStats,
    availableVehicles: uniqueVehicleKeys.size,
    vehicles,
    syncedEngineIds,
    vehiclePagesEnabled: settingsResult.data?.vehicle_pages_enabled ?? false,
    totalLinkedProducts,
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    await assertFeature(shopId, "vehiclePages");
  } catch (err: unknown) {
    if (err instanceof BillingGateError) {
      return data({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  if (intent === "push_all") {
    const { data: vpJob, error: jobError } = await db
      .from("sync_jobs")
      .insert({
        shop_id: shopId,
        type: "vehicle_pages",
        status: "running",
        progress: 0,
        total_items: 0,
        processed_items: 0,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (jobError || !vpJob) {
      return data({ error: "Failed to create vehicle pages job" }, { status: 500 });
    }

    // Fire-and-forget: invoke Edge Function directly (no pg_cron dependency)
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseKey) {
      fetch(`${supabaseUrl}/functions/v1/process-jobs`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: vpJob.id, shop_id: shopId }),
      }).catch((err) => console.error("[vehicle-pages] Edge Function invocation failed:", err));
    }

    return data({
      success: true,
      jobCreated: true,
      message: "Vehicle pages push started. Processing in background...",
    });
  }

  if (intent === "delete_all") {
    // Create a delete job — processed by Edge Function (NOT Vercel)
    // This ensures delete continues even if the user closes the browser
    const { data: deleteJob, error: deleteJobError } = await db
      .from("sync_jobs")
      .insert({
        shop_id: shopId,
        type: "delete_vehicle_pages",
        status: "running",
        progress: 0,
        total_items: 0,
        processed_items: 0,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (deleteJobError || !deleteJob) {
      return data({ error: "Failed to create delete job" }, { status: 500 });
    }

    // Fire-and-forget: invoke Edge Function
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (supabaseUrl && supabaseKey) {
      fetch(`${supabaseUrl}/functions/v1/process-jobs`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: deleteJob.id, shop_id: shopId }),
      }).catch((err) => console.error("[vehicle-pages] Edge Function delete invocation failed:", err));
    }

    return data({
      success: true,
      jobCreated: true,
      message: "Vehicle pages delete started. Processing in background...",
    });
  }

  if (intent === "sync_status") {
    return data({ success: true, message: "Status refreshed." });
  }

  if (intent === "toggle_enabled") {
    const enabled = formData.get("enabled") === "true";
    const { error } = await db
      .from("app_settings")
      .upsert(
        {
          shop_id: shopId,
          vehicle_pages_enabled: enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "shop_id" },
      );

    if (error) {
      return data(
        { error: `Failed to update setting: ${error.message}` },
        { status: 500 },
      );
    }

    return data({
      success: true,
      message: enabled
        ? "Vehicle pages enabled."
        : "Vehicle pages disabled.",
    });
  }

  return data({ error: "Unknown action" }, { status: 400 });
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function VehiclePages() {
  const loaderData = useLoaderData<typeof loader>();
  const rawActionData = useActionData<typeof action>();
  const actionData = rawActionData as { error?: string; message?: string; success?: boolean } | undefined;
  const fetcher = useFetcher<{ success?: boolean; hasMore?: boolean; created?: number; failed?: number; error?: string; message?: string }>();
  const navigate = useNavigate();

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  // howItWorksOpen state moved to shared HowItWorks component
  const [searchValue, setSearchValue] = useState("");
  const [filterValue, setFilterValue] = useState("all");

  const isLoading = fetcher.state !== "idle";
  const fetcherData = fetcher.data as
    | { success?: boolean; message?: string; error?: string }
    | undefined;

  const showSuccess =
    (actionData && "success" in actionData && actionData.success) ||
    (fetcherData?.success && fetcherData?.message);
  const showError =
    (actionData && "error" in actionData) || fetcherData?.error;
  const errorMessage =
    (actionData && "error" in actionData ? actionData?.error : null) ||
    fetcherData?.error;
  const successMessage =
    (actionData && "message" in actionData
      ? actionData?.message
      : null) || fetcherData?.message;

  // Plan-gated view
  if (loaderData.gated) {
    return (
      <Page
        title="Vehicle Pages"
        subtitle="Professional+ — SEO-optimized vehicle specification pages"
        backAction={{ url: "/app" }}
        fullWidth
      >
        <Layout>
          <Layout.Section>
            <PlanGate
              feature="vehiclePages"
              currentPlan={loaderData.plan}
              limits={loaderData.limits}
              allLimits={loaderData.allLimits}
            >
              <div />
            </PlanGate>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const {
    syncStats: loaderSyncStats,
    availableVehicles,
    vehicles,
    syncedEngineIds,
    totalLinkedProducts: loaderLinkedProducts,
  } = loaderData;

  // Live stats polling — updates vehicle page counts every 5 seconds
  const { stats: polledStats } = useAppData();

  // Use polled stats when available, fall back to loader data
  const syncStats = {
    synced: polledStats?.vehiclePagesSynced ?? loaderSyncStats.synced,
    pending: polledStats?.vehiclePagesPending ?? loaderSyncStats.pending,
    failed: polledStats?.vehiclePagesFailed ?? loaderSyncStats.failed,
  };
  const totalLinkedProducts = loaderLinkedProducts;

  const syncedSet = useMemo(
    () => new Set(syncedEngineIds),
    [syncedEngineIds],
  );

  const noVehiclesAvailable = availableVehicles === 0;

  // Coverage percentage
  const coveragePercent =
    availableVehicles > 0
      ? Math.round((syncStats.synced / availableVehicles) * 100)
      : 0;

  // Filtered vehicles
  const filteredVehicles = useMemo(() => {
    let result = vehicles;

    // Apply search filter
    if (searchValue.trim()) {
      const query = searchValue.toLowerCase().trim();
      result = result.filter(
        (v: VehicleRow) =>
          v.makeName.toLowerCase().includes(query) ||
          v.modelName.toLowerCase().includes(query) ||
          (v.engineName ?? "").toLowerCase().includes(query) ||
          (v.engineCode ?? "").toLowerCase().includes(query) ||
          (v.generation ?? "").toLowerCase().includes(query),
      );
    }

    // Apply status filter
    if (filterValue === "published") {
      result = result.filter((v: VehicleRow) => syncedSet.has(v.engineId));
    } else if (filterValue === "not_published") {
      result = result.filter((v: VehicleRow) => !syncedSet.has(v.engineId));
    }

    return result;
  }, [vehicles, searchValue, filterValue, syncedSet]);

  // Pagination
  const PAGE_SIZE = 24;
  const [currentPage, setCurrentPage] = useState(1);
  const totalPages = Math.ceil(filteredVehicles.length / PAGE_SIZE);
  const paginatedVehicles = filteredVehicles.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE,
  );

  const [pushProgress, setPushProgress] = useState({ running: false, created: 0, failed: 0 });

  const handlePushAll = useCallback(() => {
    setPushProgress({ running: true, created: 0, failed: 0 });
    fetcher.submit({ intent: "push_all" }, { method: "post" });
  }, [fetcher]);

  // Auto-continue pushing when there are more pages
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      if (fetcher.data.hasMore && fetcher.data.success) {
        setPushProgress((prev) => ({
          running: true,
          created: prev.created + (fetcher.data?.created || 0),
          failed: prev.failed + (fetcher.data?.failed || 0),
        }));
        // Auto-trigger next batch after a short delay
        setTimeout(() => {
          fetcher.submit({ intent: "push_all" }, { method: "post" });
        }, 500);
      } else if (fetcher.data.success && !fetcher.data.hasMore) {
        setPushProgress((prev) => ({ ...prev, running: false }));
      } else {
        setPushProgress((prev) => ({ ...prev, running: false }));
      }
    }
  }, [fetcher.state, fetcher.data, fetcher]);

  const handleDeleteAll = useCallback(() => {
    fetcher.submit({ intent: "delete_all" }, { method: "post" });
    setDeleteModalOpen(false);
  }, [fetcher]);

  const handleRefresh = useCallback(() => {
    fetcher.submit({ intent: "sync_status" }, { method: "post" });
  }, [fetcher]);

  // Empty state — no fitments mapped yet
  if (
    noVehiclesAvailable &&
    syncStats.synced === 0 &&
    syncStats.pending === 0
  ) {
    return (
      <Page
        title="Vehicle Pages"
        subtitle="Professional+ — SEO-optimized vehicle specification pages"
        backAction={{ url: "/app" }}
        fullWidth
      >
        <Layout>
          <Layout.Section>
            <Card>
              <EmptyState
                heading="No vehicles to publish"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                action={{
                  content: "Map Fitments",
                  onAction: () => navigate("/app/fitment/manual"),
                }}
                secondaryAction={{
                  content: "Learn more",
                  onAction: () => navigate("/app/help"),
                }}
              >
                <p>
                  Map vehicle fitments to your products first, then come back to
                  publish SEO-optimized vehicle specification pages to your
                  storefront.
                </p>
              </EmptyState>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  return (
    <Page
      title="Vehicle Pages"
      subtitle="Professional+ — SEO-optimized vehicle specification pages"
      backAction={{ url: "/app" }}
      fullWidth
      primaryAction={{
        content: "Push All Vehicle Pages",
        disabled: noVehiclesAvailable || isLoading,
        loading: isLoading,
        onAction: handlePushAll,
      }}
      secondaryActions={[
        {
          content: "Refresh",
          onAction: handleRefresh,
          disabled: isLoading,
        },
        {
          content: "Delete All Pages",
          destructive: true,
          onAction: () => setDeleteModalOpen(true),
          disabled: isLoading,
        },
        {
          content: "Reset Definition",
          onAction: () => {
            fetcher.submit({ intent: "recreate_definition" }, { method: "post", action: "/app/api/vehicle-pages" });
          },
          disabled: isLoading,
        },
      ]}
    >
      <BlockStack gap="500">
        {/* Action banners */}
        {showError && (
          <Banner tone="critical" onDismiss={() => {}}>
            <p>{errorMessage}</p>
          </Banner>
        )}

        {showSuccess && (
          <Banner tone="success" onDismiss={() => {}}>
            <p>{successMessage}</p>
          </Banner>
        )}

        {/* ── Section 1: How It Works (Collapsible) ── */}
        <HowItWorks
          title="How Vehicle Pages Work"
          subtitle="Map Fitments → Push Pages → Set Up Template → Go Live"
          steps={[
            { number: 1, title: "Map Fitments", description: "Link your products to specific vehicles using the fitment mapping tool. Each product-vehicle link becomes a potential vehicle page.", linkText: "Go to Fitment Mapping", linkUrl: "/app/fitment/manual" },
            { number: 2, title: "Push Vehicle Pages", description: "Click \"Push All Vehicle Pages\" to create Shopify metaobjects for every unique vehicle in your fitments. Pages include full engine specs, power, displacement, and linked products." },
            { number: 3, title: "Set Up Metaobject Template", description: "In your Shopify admin, go to Online Store → Themes → Customize. Create a new template for the \"Vehicle Specification\" metaobject type. Add the AutoSync \"Vehicle Spec Detail\" widget block to display vehicle data beautifully.", linkText: "Open Theme Editor", linkUrl: "/app/settings" },
            { number: 4, title: "SEO Pages Go Live", description: "Each vehicle gets its own URL (e.g. /pages/vehicle-specs/audi-rs3-2-5-tfsi). Rich specs, linked products, and structured data help you rank for long-tail automotive searches like \"Audi RS3 exhaust upgrade\"." },
          ]}
        />

        {/* Loading/progress overlay — right below HowItWorks */}
        {isLoading && (
          <Card>
            <InlineStack gap="300" blockAlign="center">
              <Spinner size="small" />
              <BlockStack gap="100">
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  Processing vehicle pages...
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  This may take a moment depending on the number of vehicles.
                </Text>
              </BlockStack>
            </InlineStack>
          </Card>
        )}

        {/* ── Section 2: Stats Dashboard ── */}
        <Card padding="0">
          <div style={{
            ...autoFitGridStyle("120px", "8px"),
            borderBottom: "1px solid var(--p-color-border-secondary)",
          }}>
            {[
              { icon: ProductIcon, count: `${availableVehicles}`, label: "Total Available" },
              { icon: CheckCircleIcon, count: `${syncStats.synced}`, label: "Published Pages" },
              { icon: LinkIcon, count: `${totalLinkedProducts}`, label: "Products Linked" },
              { icon: ChartVerticalFilledIcon, count: `${syncStats.synced} / ${availableVehicles}`, label: "Sync Coverage" },
            ].map((item, i, arr) => (
              <div key={item.label} style={{
                padding: "var(--p-space-400)",
                borderRight: i < arr.length - 1 ? "1px solid var(--p-color-border-secondary)" : "none",
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

        {/* ── Section 3: Vehicle Browser ── */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={SearchIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingMd">
                  Vehicle Browser
                </Text>
                <Badge tone="info">{`${filteredVehicles.length} vehicles`}</Badge>
              </InlineStack>
            </InlineStack>

            {/* Filter bar */}
            <InlineGrid columns={{ xs: 1, md: "2fr 1fr" }} gap="300">
              <TextField
                label="Search"
                labelHidden
                placeholder="Search by make, model, engine..."
                value={searchValue}
                onChange={(v) => { setSearchValue(v); setCurrentPage(1); }}
                prefix={<Icon source={SearchIcon} />}
                clearButton
                onClearButtonClick={() => setSearchValue("")}
                autoComplete="off"
              />
              <Select
                label="Filter"
                labelHidden
                options={[
                  { label: "All Vehicles", value: "all" },
                  { label: "Published", value: "published" },
                  { label: "Not Published", value: "not_published" },
                ]}
                value={filterValue}
                onChange={setFilterValue}
              />
            </InlineGrid>

            <Divider />

            {/* Vehicle cards grid */}
            {filteredVehicles.length === 0 ? (
              <Box padding="400">
                <BlockStack gap="200" inlineAlign="center">
                  <Text as="p" variant="bodyMd" tone="subdued">
                    No vehicles match your search or filter criteria.
                  </Text>
                  <Button
                    variant="plain"
                    onClick={() => {
                      setSearchValue("");
                      setFilterValue("all");
                    }}
                  >
                    Clear filters
                  </Button>
                </BlockStack>
              </Box>
            ) : (
              <InlineGrid columns={{ xs: 1, sm: 2, lg: 3 }} gap="300">
                {paginatedVehicles.map((vehicle: VehicleRow) => {
                  const isSynced = syncedSet.has(vehicle.engineId);
                  const gen = vehicle.generation && !vehicle.generation.includes(" | ") && !vehicle.generation.startsWith(vehicle.modelName) ? vehicle.generation : null;
                  const heading = [
                    vehicle.makeName,
                    vehicle.modelName,
                    gen ? `(${gen})` : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  // Build a useful engine label from available data
                  const engineLabel = vehicle.engineName
                    || [
                        vehicle.displacementCc ? formatDisplacement(vehicle.displacementCc) : null,
                        vehicle.fuelType,
                        vehicle.powerHp ? `${vehicle.powerHp} HP` : null,
                        vehicle.engineCode,
                      ].filter(Boolean).join(" · ")
                    || "All engines";

                  const displacement = formatDisplacement(
                    vehicle.displacementCc,
                  );
                  const years = formatYearRange(
                    vehicle.yearFrom,
                    vehicle.yearTo,
                  );

                  return (
                    <div
                      key={vehicle.engineId}
                      style={{
                        borderRadius: "var(--p-border-radius-300)",
                        border: "var(--p-border-width-025) solid var(--p-color-border)",
                        padding: "var(--p-space-300)",
                        background: "var(--p-color-bg-surface)",
                        display: "flex",
                        flexDirection: "column",
                        minHeight: "160px",
                        minWidth: 0,
                      }}
                    >
                      {/* Header: Make Model + Published badge */}
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px", marginBottom: "4px" }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <Text as="h3" variant="headingSm" truncate>{heading}</Text>
                        </div>
                        {isSynced && (
                          <div style={{ flexShrink: 0 }}>
                            <Badge tone="success">{`Published`}</Badge>
                          </div>
                        )}
                      </div>

                      {/* Engine variant — single line truncated */}
                      <div style={{ marginBottom: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <Text as="p" variant="bodySm" tone="subdued" truncate>{engineLabel}</Text>
                      </div>

                      {/* Spec badges — max 2 rows with overflow hidden */}
                      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "8px", maxHeight: "54px", overflow: "hidden" }}>
                        {vehicle.engineCode && (
                          <Badge tone="info">{`${vehicle.engineCode}`}</Badge>
                        )}
                        {displacement && (
                          <Badge>{displacement}</Badge>
                        )}
                        {vehicle.fuelType && (
                          <Badge>{`${vehicle.fuelType}`}</Badge>
                        )}
                        {vehicle.aspiration && vehicle.aspiration !== "NA" && (
                          <Badge>{`${vehicle.aspiration}`}</Badge>
                        )}
                        {vehicle.bodyType && (
                          <Badge>{`${vehicle.bodyType}`}</Badge>
                        )}
                      </div>

                      {/* Footer: years + product count — pushed to bottom */}
                      <div style={{ marginTop: "auto", borderTop: "1px solid var(--p-color-border-secondary)", paddingTop: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <Text as="span" variant="bodySm" tone="subdued">{`${years}`}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">{`${vehicle.productCount} product${vehicle.productCount !== 1 ? "s" : ""}`}</Text>
                      </div>
                    </div>
                  );
                })}
              </InlineGrid>
            )}

            {totalPages > 1 && (
              <Box paddingBlockStart="400">
                <InlineStack align="center" gap="300" blockAlign="center">
                  <Text as="span" variant="bodySm" tone="subdued">
                    {`${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filteredVehicles.length)} of ${filteredVehicles.length} vehicles`}
                  </Text>
                  <Pagination
                    hasPrevious={currentPage > 1}
                    hasNext={currentPage < totalPages}
                    onPrevious={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  />
                </InlineStack>
              </Box>
            )}
          </BlockStack>
        </Card>

        {/* ── Section 4: Danger Zone ── */}
        {syncStats.synced > 0 && (
          <Card>
            <div
              style={{
                borderLeft: `3px solid var(--p-color-border-critical)`,
                paddingLeft: "var(--p-space-400)",
              }}
            >
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={DeleteIcon} bg="var(--p-color-bg-fill-critical-secondary)" color="var(--p-color-icon-critical)" />
                  <BlockStack gap="050">
                    <Text as="h2" variant="headingMd">
                      Danger Zone
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Permanently remove all vehicle pages from your storefront
                    </Text>
                  </BlockStack>
                </InlineStack>

                <Text as="p" variant="bodyMd" tone="subdued">
                  This will delete all {`${syncStats.synced}`} published
                  metaobjects and unlink them from products. This action cannot
                  be undone.
                </Text>

                <div>
                  <Button
                    tone="critical"
                    onClick={() => setDeleteModalOpen(true)}
                    disabled={isLoading}
                  >
                    Delete All Vehicle Pages
                  </Button>
                </div>
              </BlockStack>
            </div>
          </Card>
        )}
      </BlockStack>

      {/* Delete confirmation modal */}
      <Modal
        open={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        title="Delete all vehicle pages?"
        primaryAction={{
          content: "Delete All",
          destructive: true,
          onAction: handleDeleteAll,
          loading: isLoading,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setDeleteModalOpen(false),
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Text as="p" variant="bodyMd">
              This will permanently delete all {`${syncStats.synced}`} published
              vehicle pages from your storefront. The metaobjects will be
              removed and product links will be cleared.
            </Text>
            <Banner tone="critical">
              <p>This action cannot be undone.</p>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}


export function ErrorBoundary() {
  return <RouteError pageName="Vehicle Pages" />;
}
