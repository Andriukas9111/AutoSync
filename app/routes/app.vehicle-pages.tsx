import { useState, useCallback, useMemo } from "react";
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
  PLAN_LIMITS,
} from "../lib/billing.server";
import { PlanGate } from "../components/PlanGate";
import type { PlanTier } from "../lib/types";

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
  fuelType: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  bodyType: string | null;
  aspiration: string | null;
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

const iconBadgeStyle = (
  bg: string = "var(--p-color-bg-surface-secondary)",
  color: string = "var(--p-color-icon-emphasis)",
) =>
  ({
    width: "32px",
    height: "32px",
    borderRadius: "var(--p-border-radius-200)",
    background: bg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color,
    flexShrink: 0,
  }) as const;

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
      const plan: PlanTier = tenant?.plan ?? "free";
      const limits = getPlanLimits(plan);
      return data(
        {
          gated: true as const,
          plan,
          limits,
          allLimits: PLAN_LIMITS,
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
  const plan: PlanTier = tenant?.plan ?? "free";
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

    // 2. Count unique engines linked to this tenant's products
    db
      .from("vehicle_fitments")
      .select("ymme_engine_id")
      .eq("shop_id", shopId)
      .not("ymme_engine_id", "is", null),

    // 3. Fetch 50 vehicles with full YMME data via joins
    db
      .from("vehicle_fitments")
      .select(
        `
        ymme_engine_id,
        product_id,
        engine:ymme_engines!ymme_engine_id (
          id,
          name,
          code,
          displacement_cc,
          power_hp,
          fuel_type,
          year_from,
          year_to,
          body_type,
          aspiration,
          model:ymme_models!model_id (
            name,
            generation,
            make:ymme_makes!make_id (
              name
            )
          )
        )
      `,
      )
      .eq("shop_id", shopId)
      .not("ymme_engine_id", "is", null)
      .limit(500),

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

  // Count unique engines
  const uniqueEngineIds = availableResult.data
    ? new Set(availableResult.data.map((r: any) => r.ymme_engine_id))
    : new Set<string>();

  // Build vehicle rows grouped by engine_id
  const engineMap = new Map<string, VehicleRow>();
  if (vehiclesResult.data) {
    for (const row of vehiclesResult.data as any[]) {
      const engine = row.engine;
      if (!engine?.id) continue;
      const eid = engine.id as string;

      if (engineMap.has(eid)) {
        // Just increment product count
        const existing = engineMap.get(eid)!;
        existing.productCount++;
      } else {
        const model = engine.model;
        const make = model?.make;
        engineMap.set(eid, {
          engineId: eid,
          makeName: make?.name ?? "Unknown",
          modelName: model?.name ?? "Unknown",
          generation: model?.generation ?? null,
          engineName: engine.name ?? null,
          engineCode: engine.code ?? null,
          displacementCc: engine.displacement_cc ?? null,
          powerHp: engine.power_hp ?? null,
          fuelType: engine.fuel_type ?? null,
          yearFrom: engine.year_from ?? null,
          yearTo: engine.year_to ?? null,
          bodyType: engine.body_type ?? null,
          aspiration: engine.aspiration ?? null,
          productCount: 1,
        });
      }
    }
  }

  // Sort by make, then model, then engine name — take first 50
  const vehicles = Array.from(engineMap.values())
    .sort((a, b) => {
      const makeCompare = a.makeName.localeCompare(b.makeName);
      if (makeCompare !== 0) return makeCompare;
      const modelCompare = a.modelName.localeCompare(b.modelName);
      if (modelCompare !== 0) return modelCompare;
      return (a.engineName ?? "").localeCompare(b.engineName ?? "");
    })
    .slice(0, 50);

  // Synced engine IDs
  const syncedEngineIds = (syncedResult.data ?? []).map(
    (r: any) => r.engine_id as string,
  );

  // Total linked products across synced pages
  const totalLinkedProducts = (syncedResult.data ?? []).reduce(
    (sum: number, r: any) => sum + (r.linked_product_count ?? 0),
    0,
  );

  return {
    gated: false as const,
    plan,
    limits,
    allLimits: PLAN_LIMITS,
    syncStats,
    availableVehicles: uniqueEngineIds.size,
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
    try {
      const { pushVehiclePages } = await import(
        "../lib/pipeline/vehicle-pages.server"
      );
      const result = await pushVehiclePages(admin, shopId);
      return data({
        success: true,
        message: `Successfully pushed ${result.created + result.updated} vehicle pages (${result.created} created, ${result.updated} updated${result.failed > 0 ? `, ${result.failed} failed` : ""}).`,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to push vehicle pages";
      return data({ error: message }, { status: 500 });
    }
  }

  if (intent === "delete_all") {
    try {
      const { deleteVehiclePages } = await import(
        "../lib/pipeline/vehicle-pages.server"
      );
      const result = await deleteVehiclePages(admin, shopId);
      return data({
        success: true,
        message: `Deleted ${result.deleted} vehicle pages.`,
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to delete vehicle pages";
      return data({ error: message }, { status: 500 });
    }
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
  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher();
  const navigate = useNavigate();

  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
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
    (actionData && "error" in actionData ? (actionData as any).error : null) ||
    fetcherData?.error;
  const successMessage =
    (actionData && "message" in actionData
      ? (actionData as any).message
      : null) || fetcherData?.message;

  // Plan-gated view
  if (loaderData.gated) {
    return (
      <Page
        title="Vehicle Pages"
        subtitle="Enterprise \u00b7 SEO-optimized vehicle specification pages"
        backAction={{ url: "/app" }}
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
    syncStats,
    availableVehicles,
    vehicles,
    syncedEngineIds,
    totalLinkedProducts,
  } = loaderData;

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

  const handlePushAll = useCallback(() => {
    fetcher.submit({ intent: "push_all" }, { method: "post" });
  }, [fetcher]);

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
        subtitle="Enterprise \u00b7 SEO-optimized vehicle specification pages"
        backAction={{ url: "/app" }}
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
      subtitle="Enterprise \u00b7 SEO-optimized vehicle specification pages"
      backAction={{ url: "/app" }}
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
          disabled: syncStats.synced === 0 || isLoading,
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

        {/* Loading overlay */}
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

        {/* ── Section 1: How It Works (Collapsible) ── */}
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <InlineStack gap="200" blockAlign="center">
                <div style={iconBadgeStyle()}>
                  <Icon source={PageIcon} />
                </div>
                <Text as="h2" variant="headingMd">
                  How Vehicle Pages Work
                </Text>
              </InlineStack>
              <Button
                variant="plain"
                onClick={() => setHowItWorksOpen(!howItWorksOpen)}
              >
                {howItWorksOpen ? "Hide" : "Show"}
              </Button>
            </InlineStack>

            <Collapsible
              open={howItWorksOpen}
              id="how-it-works-collapsible"
              transition={{
                duration: "var(--p-motion-duration-200)",
                timingFunction: "var(--p-motion-ease-in-out)",
              }}
            >
              <Box paddingBlockStart="300">
                <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
                  {/* Step 1 */}
                  <div
                    style={{
                      padding: "var(--p-space-400)",
                      borderRadius: "var(--p-border-radius-300)",
                      background: "var(--p-color-bg-surface-secondary)",
                    }}
                  >
                    <BlockStack gap="300">
                      <InlineStack gap="200" blockAlign="center">
                        <div style={stepNumberStyle(true)}>1</div>
                        <Text as="h3" variant="headingSm">
                          Map Fitments
                        </Text>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Link your products to specific vehicles using the
                        fitment mapping tool. Each product-vehicle link becomes a
                        potential vehicle page.
                      </Text>
                      <Button
                        variant="plain"
                        onClick={() => navigate("/app/fitment/manual")}
                        icon={ArrowRightIcon}
                      >
                        Go to Fitment Mapping
                      </Button>
                    </BlockStack>
                  </div>

                  {/* Step 2 */}
                  <div
                    style={{
                      padding: "var(--p-space-400)",
                      borderRadius: "var(--p-border-radius-300)",
                      background: "var(--p-color-bg-surface-secondary)",
                    }}
                  >
                    <BlockStack gap="300">
                      <InlineStack gap="200" blockAlign="center">
                        <div style={stepNumberStyle(true)}>2</div>
                        <Text as="h3" variant="headingSm">
                          Push Vehicle Pages
                        </Text>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Click "Push All Vehicle Pages" to create Shopify
                        metaobjects for every unique vehicle in your fitments.
                        Pages include full engine specs and linked products.
                      </Text>
                    </BlockStack>
                  </div>

                  {/* Step 3 */}
                  <div
                    style={{
                      padding: "var(--p-space-400)",
                      borderRadius: "var(--p-border-radius-300)",
                      background: "var(--p-color-bg-surface-secondary)",
                    }}
                  >
                    <BlockStack gap="300">
                      <InlineStack gap="200" blockAlign="center">
                        <div style={stepNumberStyle(true)}>3</div>
                        <Text as="h3" variant="headingSm">
                          SEO Pages Go Live
                        </Text>
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        Auto-generated URLs appear on your storefront with rich
                        vehicle data, helping you rank for long-tail automotive
                        search terms.
                      </Text>
                    </BlockStack>
                  </div>
                </InlineGrid>
              </Box>
            </Collapsible>
          </BlockStack>
        </Card>

        {/* ── Section 2: Stats Dashboard ── */}
        <InlineGrid columns={{ xs: 2, md: 4 }} gap="400">
          {/* Total Vehicles Available */}
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <div
                  style={iconBadgeStyle(
                    "var(--p-color-bg-fill-info-secondary)",
                    "var(--p-color-icon-info)",
                  )}
                >
                  <Icon source={ProductIcon} />
                </div>
                <Text as="p" variant="bodySm" tone="subdued">
                  Total Available
                </Text>
              </InlineStack>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {`${availableVehicles}`}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Unique vehicles from fitments
              </Text>
            </BlockStack>
          </Card>

          {/* Published Pages */}
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <div
                  style={iconBadgeStyle(
                    "var(--p-color-bg-fill-success-secondary)",
                    "var(--p-color-icon-success)",
                  )}
                >
                  <Icon source={CheckCircleIcon} />
                </div>
                <Text as="p" variant="bodySm" tone="subdued">
                  Published Pages
                </Text>
              </InlineStack>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {`${syncStats.synced}`}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Live on storefront
              </Text>
            </BlockStack>
          </Card>

          {/* Products Linked */}
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <div
                  style={iconBadgeStyle(
                    "var(--p-color-bg-surface-secondary)",
                    "var(--p-color-icon-emphasis)",
                  )}
                >
                  <Icon source={LinkIcon} />
                </div>
                <Text as="p" variant="bodySm" tone="subdued">
                  Products Linked
                </Text>
              </InlineStack>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {`${totalLinkedProducts}`}
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Across all vehicle pages
              </Text>
            </BlockStack>
          </Card>

          {/* Sync Coverage */}
          <Card>
            <BlockStack gap="200">
              <InlineStack gap="200" blockAlign="center">
                <div
                  style={iconBadgeStyle(
                    "var(--p-color-bg-surface-secondary)",
                    "var(--p-color-icon-emphasis)",
                  )}
                >
                  <Icon source={ChartVerticalFilledIcon} />
                </div>
                <Text as="p" variant="bodySm" tone="subdued">
                  Sync Coverage
                </Text>
              </InlineStack>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {`${syncStats.synced} / ${availableVehicles}`}
              </Text>
              <Box paddingBlockStart="100">
                <ProgressBar
                  progress={coveragePercent}
                  size="small"
                  tone="primary"
                />
              </Box>
              <Text as="p" variant="bodySm" tone="subdued">
                {`${coveragePercent}% coverage`}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* ── Section 3: Vehicle Browser ── */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center" wrap>
              <InlineStack gap="200" blockAlign="center">
                <div style={iconBadgeStyle()}>
                  <Icon source={SearchIcon} />
                </div>
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
                onChange={setSearchValue}
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
                {filteredVehicles.map((vehicle: VehicleRow) => {
                  const isSynced = syncedSet.has(vehicle.engineId);
                  const heading = [
                    vehicle.makeName,
                    vehicle.modelName,
                    vehicle.generation ? `(${vehicle.generation})` : "",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  const engineLabel = vehicle.engineName
                    ? `${vehicle.engineName}${vehicle.powerHp ? ` (${formatPower(vehicle.powerHp)})` : ""}`
                    : vehicle.engineCode ?? "Engine";

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
                        padding: "var(--p-space-400)",
                        background: "var(--p-color-bg-surface)",
                        transition:
                          "box-shadow var(--p-motion-duration-200) var(--p-motion-ease-in-out)",
                      }}
                    >
                      <BlockStack gap="200">
                        {/* Header row: heading + status */}
                        <InlineStack
                          align="space-between"
                          blockAlign="start"
                          wrap={false}
                        >
                          <BlockStack gap="050">
                            <Text
                              as="h3"
                              variant="headingSm"
                              truncate
                            >
                              {heading}
                            </Text>
                            <Text
                              as="p"
                              variant="bodySm"
                              tone="subdued"
                              truncate
                            >
                              {engineLabel}
                            </Text>
                          </BlockStack>
                          {isSynced && (
                            <Badge tone="success">{`Published`}</Badge>
                          )}
                        </InlineStack>

                        {/* Spec badges row */}
                        <InlineStack gap="100" wrap>
                          {vehicle.engineCode && (
                            <Badge tone="info">
                              {`${vehicle.engineCode}`}
                            </Badge>
                          )}
                          {displacement && (
                            <Badge>{displacement}</Badge>
                          )}
                          {vehicle.fuelType && (
                            <Badge>{`${vehicle.fuelType}`}</Badge>
                          )}
                          {vehicle.aspiration &&
                            vehicle.aspiration !== "NA" && (
                              <Badge>{`${vehicle.aspiration}`}</Badge>
                            )}
                          {vehicle.bodyType && (
                            <Badge>{`${vehicle.bodyType}`}</Badge>
                          )}
                        </InlineStack>

                        {/* Footer row: years + product count */}
                        <Divider />
                        <InlineStack
                          align="space-between"
                          blockAlign="center"
                        >
                          <Text as="span" variant="bodySm" tone="subdued">
                            {`Years: ${years}`}
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            {`${vehicle.productCount} product${vehicle.productCount !== 1 ? "s" : ""} linked`}
                          </Text>
                        </InlineStack>
                      </BlockStack>
                    </div>
                  );
                })}
              </InlineGrid>
            )}

            {vehicles.length >= 50 && (
              <Box paddingBlockStart="200">
                <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                  {`Showing first 50 of ${availableVehicles} vehicles. Use search to find specific vehicles.`}
                </Text>
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
                  <div
                    style={iconBadgeStyle(
                      "var(--p-color-bg-fill-critical-secondary)",
                      "var(--p-color-icon-critical)",
                    )}
                  >
                    <Icon source={DeleteIcon} />
                  </div>
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
