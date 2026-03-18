import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useFetcher } from "react-router";
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
  TextField,
  Spinner,
  EmptyState,
  Icon,
  Divider,
  ProgressBar,
} from "@shopify/polaris";
import {
  SearchIcon,
  ChevronLeftIcon,
  DatabaseIcon,
  CategoriesIcon,
  GaugeIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getPlanLimits, getTenant, PLAN_LIMITS } from "../lib/billing.server";
import type { PlanTier } from "../lib/types";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Run all queries in parallel
  const [tenantResult, makesResult, activeResult, fitmentResult, modelCountResult, engineCountResult] = await Promise.all([
    getTenant(shopId),
    db.from("ymme_makes")
      .select("id, name, slug, country, logo_url, nhtsa_make_id")
      .eq("active", true)
      .order("name", { ascending: true }),
    db.from("tenant_active_makes")
      .select("ymme_make_id")
      .eq("shop_id", shopId),
    db.from("vehicle_fitments")
      .select("make")
      .eq("shop_id", shopId)
      .not("make", "is", null),
    db.from("ymme_models")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
    db.from("ymme_engines")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
  ]);

  const tenant = tenantResult;
  const plan: PlanTier = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);

  const allMakes = makesResult.data ?? [];
  const activeMakeIds = new Set(
    (activeResult.data ?? []).map((tam: any) => tam.ymme_make_id)
  );

  // Count fitments per make name
  const productCountByMake: Record<string, number> = {};
  if (fitmentResult.data) {
    for (const row of fitmentResult.data) {
      if (row.make) {
        productCountByMake[row.make] = (productCountByMake[row.make] || 0) + 1;
      }
    }
  }

  // Build makes list with enriched data
  const makes = allMakes.map((make: any) => ({
    ...make,
    isActive: activeMakeIds.has(make.id),
    productCount: productCountByMake[make.name] || 0,
  }));

  return {
    plan,
    limits,
    makes,
    activeMakeCount: activeMakeIds.size,
    totalModels: modelCountResult.count ?? 0,
    totalEngines: engineCountResult.count ?? 0,
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const _action = formData.get("_action");

  if (_action === "toggle_make") {
    const makeId = formData.get("make_id") as string;
    const enable = formData.get("enable") === "true";

    if (!makeId) {
      return data({ error: "Missing make_id" }, { status: 400 });
    }

    if (enable) {
      const tenant = await getTenant(shopId);
      const plan: PlanTier = tenant?.plan ?? "free";
      const limits = getPlanLimits(plan);

      const { count: currentActive } = await db
        .from("tenant_active_makes")
        .select("*", { count: "exact", head: true })
        .eq("shop_id", shopId);

      if ((currentActive ?? 0) >= limits.activeMakes) {
        return data(
          {
            error: `You have reached your plan limit of ${limits.activeMakes} active makes. Upgrade to add more.`,
          },
          { status: 403 }
        );
      }

      const { error } = await db
        .from("tenant_active_makes")
        .insert({ shop_id: shopId, ymme_make_id: makeId });

      if (error && !error.message.includes("duplicate")) {
        return data({ error: "Failed to enable make: " + error.message }, { status: 500 });
      }
    } else {
      const { error } = await db
        .from("tenant_active_makes")
        .delete()
        .eq("shop_id", shopId)
        .eq("ymme_make_id", makeId);

      if (error) {
        return data({ error: "Failed to disable make: " + error.message }, { status: 500 });
      }
    }

    return data({ success: true, makeId, enabled: enable });
  }

  return data({ error: "Unknown action" }, { status: 400 });
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MakeItem {
  id: string;
  name: string;
  slug: string | null;
  country: string | null;
  logo_url: string | null;
  nhtsa_make_id: number | null;
  isActive: boolean;
  productCount: number;
}

interface ModelItem {
  id: string;
  name: string;
  generation: string | null;
  year_from: number | null;
  year_to: number | null;
  body_type: string | null;
}

interface EngineItem {
  id: string;
  code: string | null;
  name: string | null;
  displacement_cc: number | null;
  fuel_type: string | null;
  power_hp: number | null;
  power_kw: number | null;
  torque_nm: number | null;
  year_from: number | null;
  year_to: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatYearRange(from: number | null, to: number | null): string {
  if (!from && !to) return "";
  if (from && !to) return `${from}\u2013present`;
  if (!from && to) return `\u2013${to}`;
  if (from === to) return `${from}`;
  return `${from}\u2013${to}`;
}

function formatDisplacement(cc: number | null): string {
  if (!cc) return "";
  return `${(cc / 1000).toFixed(1)}L`;
}

function fuelBadgeTone(fuel: string | null): "info" | "success" | "warning" | "critical" | undefined {
  if (!fuel) return undefined;
  const f = fuel.toLowerCase();
  if (f.includes("petrol") || f.includes("gasoline")) return "warning";
  if (f.includes("diesel")) return "info";
  if (f.includes("electric")) return "success";
  if (f.includes("hybrid")) return "success";
  return undefined;
}

function makeInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Vehicles() {
  const { plan, limits, makes, activeMakeCount, totalModels, totalEngines } =
    useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher();

  const [searchValue, setSearchValue] = useState("");

  // Navigation state
  const [selectedMake, setSelectedMake] = useState<{
    id: string;
    name: string;
    logo_url: string | null;
  } | null>(null);
  const [selectedModel, setSelectedModel] = useState<{
    id: string;
    name: string;
    generation: string | null;
  } | null>(null);

  // Data state
  const [models, setModels] = useState<ModelItem[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [engines, setEngines] = useState<EngineItem[]>([]);
  const [enginesLoading, setEnginesLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [enginesError, setEnginesError] = useState<string | null>(null);

  const showError = actionData && "error" in actionData;

  // Filter makes by search
  const filteredMakes = makes.filter((make: MakeItem) =>
    make.name.toLowerCase().includes(searchValue.toLowerCase())
  );

  // Navigate into a make - fetch its models
  const handleSelectMake = useCallback(async (make: MakeItem) => {
    setSelectedMake({ id: make.id, name: make.name, logo_url: make.logo_url });
    setSelectedModel(null);
    setEngines([]);
    setModels([]);
    setModelsLoading(true);
    setModelsError(null);
    setSearchValue("");

    try {
      const response = await fetch(
        `/app/api/ymme?level=models&make_id=${make.id}`
      );
      if (response.ok) {
        const result = await response.json();
        setModels(result.models ?? result.data ?? []);
      } else {
        setModelsError("Failed to load models. Please try again.");
      }
    } catch (err) {
      setModelsError("Network error loading models. Check your connection.");
    } finally {
      setModelsLoading(false);
    }
  }, []);

  // Navigate into a model - fetch its engines
  const handleSelectModel = useCallback(async (model: ModelItem) => {
    setSelectedModel({
      id: model.id,
      name: model.name,
      generation: model.generation,
    });
    setEngines([]);
    setEnginesLoading(true);
    setEnginesError(null);

    try {
      const response = await fetch(
        `/app/api/ymme?level=engines&model_id=${model.id}`
      );
      if (response.ok) {
        const result = await response.json();
        setEngines(result.engines ?? result.data ?? []);
      } else {
        setEnginesError("Failed to load engines. Please try again.");
      }
    } catch (err) {
      setEnginesError("Network error loading engines. Check your connection.");
    } finally {
      setEnginesLoading(false);
    }
  }, []);

  // Navigation helpers
  const goToMakes = useCallback(() => {
    setSelectedMake(null);
    setSelectedModel(null);
    setModels([]);
    setEngines([]);
    setSearchValue("");
  }, []);

  const goToModels = useCallback(() => {
    setSelectedModel(null);
    setEngines([]);
  }, []);

  const handleToggleMake = useCallback(
    (makeId: string, currentlyActive: boolean) => {
      const formData = new FormData();
      formData.set("_action", "toggle_make");
      formData.set("make_id", makeId);
      formData.set("enable", String(!currentlyActive));
      fetcher.submit(formData, { method: "post" });
    },
    [fetcher]
  );

  const isToggling = fetcher.state !== "idle";
  const activePct = limits.activeMakes > 0
    ? Math.min(Math.round((activeMakeCount / limits.activeMakes) * 100), 100)
    : 0;

  // Determine current view
  const currentView: "makes" | "models" | "engines" =
    selectedMake && selectedModel
      ? "engines"
      : selectedMake
        ? "models"
        : "makes";

  // ------- Breadcrumb -------
  const renderBreadcrumb = () => {
    if (currentView === "makes") return null;

    return (
      <Card>
        <InlineStack gap="100" blockAlign="center" wrap={false}>
          <Button
            variant="plain"
            onClick={goToMakes}
            icon={ChevronLeftIcon}
          >
            All Makes
          </Button>
          {selectedMake && (
            <>
              <Text as="span" tone="subdued">/</Text>
              {currentView === "engines" ? (
                <Button variant="plain" onClick={goToModels}>
                  {selectedMake.name}
                </Button>
              ) : (
                <Text as="span" variant="bodyMd" fontWeight="semibold">
                  {selectedMake.name}
                </Text>
              )}
            </>
          )}
          {selectedModel && (
            <>
              <Text as="span" tone="subdued">/</Text>
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {selectedModel.name}
                {selectedModel.generation ? ` (${selectedModel.generation})` : ""}
              </Text>
            </>
          )}
        </InlineStack>
      </Card>
    );
  };

  // ------- Makes Grid -------
  const renderMakesView = () => (
    <BlockStack gap="400">
      {/* Search */}
      <Card>
        <TextField
          label="Search makes"
          labelHidden
          value={searchValue}
          onChange={setSearchValue}
          placeholder="Search by make name..."
          clearButton
          onClearButtonClick={() => setSearchValue("")}
          autoComplete="off"
          prefix={<Icon source={SearchIcon} />}
        />
      </Card>

      {filteredMakes.length === 0 ? (
        <Card>
          <EmptyState
            heading={
              searchValue
                ? "No makes match your search"
                : "No vehicle makes available"
            }
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>
              {searchValue
                ? "Try a different search term."
                : "Vehicle makes will appear here once the YMME database is populated."}
            </p>
          </EmptyState>
        </Card>
      ) : (
        <>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }} gap="400">
            {filteredMakes.map((make: MakeItem) => (
              <Card key={make.id}>
                <BlockStack gap="300">
                  {/* Header: logo + name */}
                  <InlineStack gap="300" blockAlign="center" wrap={false}>
                    {make.logo_url ? (
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 8,
                          overflow: "hidden",
                          backgroundColor: "var(--p-color-bg-surface-secondary)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <img
                          src={make.logo_url}
                          alt={make.name}
                          loading="lazy"
                          onError={(e) => {
                            const target = e.currentTarget;
                            target.style.display = "none";
                            const fallback = target.nextElementSibling as HTMLElement;
                            if (fallback) fallback.style.display = "flex";
                          }}
                          style={{
                            width: 32,
                            height: 32,
                            objectFit: "contain",
                          }}
                        />
                        <span
                          style={{
                            display: "none",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 32,
                            height: 32,
                            fontSize: 13,
                            fontWeight: 700,
                            color: "var(--p-color-text-subdued)",
                          }}
                        >
                          {makeInitials(make.name)}
                        </span>
                      </div>
                    ) : (
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 8,
                          backgroundColor: "var(--p-color-bg-surface-secondary)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                        }}
                      >
                        <Text as="span" variant="bodySm" fontWeight="bold" tone="subdued">
                          {makeInitials(make.name)}
                        </Text>
                      </div>
                    )}
                    <BlockStack gap="050">
                      <Text as="span" variant="bodyMd" fontWeight="semibold">
                        {make.name}
                      </Text>
                      {make.country && (
                        <Text as="span" variant="bodySm" tone="subdued">
                          {make.country}
                        </Text>
                      )}
                    </BlockStack>
                  </InlineStack>

                  {/* Badges */}
                  <InlineStack gap="200" wrap>
                    {make.isActive ? (
                      <Badge tone="success">Active</Badge>
                    ) : (
                      <Badge>Inactive</Badge>
                    )}
                    {make.productCount > 0 && (
                      <Badge tone="info">
                        {`${make.productCount} fitment${make.productCount !== 1 ? "s" : ""}`}
                      </Badge>
                    )}
                  </InlineStack>

                  <Divider />

                  {/* Actions */}
                  <InlineStack gap="200" align="space-between" blockAlign="center">
                    <Button
                      size="slim"
                      onClick={() => handleSelectMake(make)}
                    >
                      Browse models
                    </Button>
                    <Button
                      size="slim"
                      variant={make.isActive ? "secondary" : "primary"}
                      onClick={() => handleToggleMake(make.id, make.isActive)}
                      loading={isToggling}
                    >
                      {make.isActive ? "Disable" : "Enable"}
                    </Button>
                  </InlineStack>
                </BlockStack>
              </Card>
            ))}
          </InlineGrid>

          {/* Results count */}
          <Box paddingInlineStart="100">
            <Text as="span" variant="bodySm" tone="subdued">
              Showing {filteredMakes.length} of {makes.length} makes
              {searchValue ? " (filtered)" : ""}
            </Text>
          </Box>
        </>
      )}
    </BlockStack>
  );

  // ------- Models List -------
  const renderModelsView = () => (
    <BlockStack gap="400">
      {modelsLoading ? (
        <Card>
          <Box padding="800">
            <InlineStack align="center" gap="200" blockAlign="center">
              <Spinner size="small" />
              <Text as="span" variant="bodySm" tone="subdued">
                Loading models for {selectedMake?.name}...
              </Text>
            </InlineStack>
          </Box>
        </Card>
      ) : modelsError ? (
        <Banner tone="critical" onDismiss={() => setModelsError(null)}>
          <p>{modelsError}</p>
        </Banner>
      ) : models.length === 0 ? (
        <Card>
          <EmptyState
            heading={`No models found for ${selectedMake?.name}`}
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>Models will appear here once they are added to the YMME database.</p>
          </EmptyState>
        </Card>
      ) : (
        <>
          <Card>
            <BlockStack gap="0">
              <Box paddingBlockEnd="300">
                <InlineStack gap="200" blockAlign="center">
                  <Icon source={CategoriesIcon} />
                  <Text as="p" variant="bodyMd" fontWeight="semibold">
                    {models.length} model{models.length !== 1 ? "s" : ""} for {selectedMake?.name}
                  </Text>
                </InlineStack>
              </Box>
              <Divider />
              {models.map((model, index) => {
                const yearRange = formatYearRange(model.year_from, model.year_to);
                return (
                  <Box key={model.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectModel(model)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSelectModel(model);
                      }}
                      style={{
                        cursor: "pointer",
                        padding: "12px 0",
                        transition: "background-color 0.15s",
                      }}
                    >
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                        wrap={false}
                      >
                        <InlineStack gap="200" blockAlign="center" wrap>
                          <Text as="span" variant="bodyMd" fontWeight="medium">
                            {model.name}
                          </Text>
                          {model.generation && (
                            <Badge tone="info">{model.generation}</Badge>
                          )}
                          {model.body_type && (
                            <Badge>{model.body_type}</Badge>
                          )}
                        </InlineStack>
                        <InlineStack gap="200" blockAlign="center">
                          {yearRange && (
                            <Text as="span" variant="bodySm" tone="subdued">
                              {yearRange}
                            </Text>
                          )}
                          <Text as="span" tone="subdued">&rsaquo;</Text>
                        </InlineStack>
                      </InlineStack>
                    </div>
                    {index < models.length - 1 && <Divider />}
                  </Box>
                );
              })}
            </BlockStack>
          </Card>
        </>
      )}
    </BlockStack>
  );

  // ------- Engines Grid -------
  const renderEnginesView = () => (
    <BlockStack gap="400">
      {enginesLoading ? (
        <Card>
          <Box padding="800">
            <InlineStack align="center" gap="200" blockAlign="center">
              <Spinner size="small" />
              <Text as="span" variant="bodySm" tone="subdued">
                Loading engines for {selectedModel?.name}...
              </Text>
            </InlineStack>
          </Box>
        </Card>
      ) : enginesError ? (
        <Banner tone="critical" onDismiss={() => setEnginesError(null)}>
          <p>{enginesError}</p>
        </Banner>
      ) : engines.length === 0 ? (
        <Card>
          <EmptyState
            heading={`No engines found for ${selectedModel?.name}`}
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>Engines will appear here once they are added to the YMME database.</p>
          </EmptyState>
        </Card>
      ) : (
        <>
          <Box paddingInlineStart="100">
            <InlineStack gap="200" blockAlign="center">
              <Icon source={GaugeIcon} />
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                {engines.length} engine{engines.length !== 1 ? "s" : ""} for{" "}
                {selectedMake?.name} {selectedModel?.name}
                {selectedModel?.generation ? ` (${selectedModel.generation})` : ""}
              </Text>
            </InlineStack>
          </Box>

          <InlineGrid columns={{ xs: 1, sm: 1, md: 2 }} gap="400">
            {engines.map((engine) => {
              const yearRange = formatYearRange(engine.year_from, engine.year_to);
              const engineTitle = engine.name || engine.code || "Unknown Engine";

              return (
                <Card key={engine.id}>
                  <BlockStack gap="300">
                    {/* Engine heading + code badge */}
                    <InlineStack gap="200" blockAlign="center" wrap>
                      <Text as="span" variant="headingSm" fontWeight="semibold">
                        {engineTitle}
                      </Text>
                      {engine.code && engine.name && (
                        <Badge>{engine.code}</Badge>
                      )}
                    </InlineStack>

                    <Divider />

                    {/* Structured specs */}
                    <BlockStack gap="200">
                      {engine.displacement_cc && (
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="bodySm" tone="subdued">
                            Displacement
                          </Text>
                          <Badge tone="info">
                            {formatDisplacement(engine.displacement_cc)}
                          </Badge>
                        </InlineStack>
                      )}
                      {engine.fuel_type && (
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="bodySm" tone="subdued">
                            Fuel
                          </Text>
                          <Badge tone={fuelBadgeTone(engine.fuel_type)}>
                            {engine.fuel_type}
                          </Badge>
                        </InlineStack>
                      )}
                      {engine.power_hp && (
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="bodySm" tone="subdued">
                            Power
                          </Text>
                          <Text as="span" variant="bodySm">
                            {engine.power_hp} hp
                            {engine.power_kw ? ` (${engine.power_kw} kW)` : ""}
                          </Text>
                        </InlineStack>
                      )}
                      {engine.torque_nm && (
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="bodySm" tone="subdued">
                            Torque
                          </Text>
                          <Text as="span" variant="bodySm">
                            {engine.torque_nm} Nm
                          </Text>
                        </InlineStack>
                      )}
                      {yearRange && (
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="bodySm" tone="subdued">
                            Years
                          </Text>
                          <Text as="span" variant="bodySm">
                            {yearRange}
                          </Text>
                        </InlineStack>
                      )}
                    </BlockStack>
                  </BlockStack>
                </Card>
              );
            })}
          </InlineGrid>
        </>
      )}
    </BlockStack>
  );

  return (
    <Page
      fullWidth
      title="Vehicle Database"
      subtitle="Browse and manage your YMME vehicle database"
    >
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* Error banners */}
            {showError && (
              <Banner tone="critical">
                <p>{(actionData as any).error}</p>
              </Banner>
            )}
            {fetcher.data && "error" in (fetcher.data as any) && (
              <Banner tone="critical">
                <p>{(fetcher.data as any).error}</p>
              </Banner>
            )}

            {/* Stats Cards */}
            <InlineGrid columns={{ xs: 2, sm: 2, md: 4 }} gap="400">
              <Card>
                <BlockStack gap="200">
                  <InlineStack gap="100" blockAlign="center">
                    <div style={{
                      width: "20px", height: "20px",
                      borderRadius: "var(--p-border-radius-100)",
                      background: "var(--p-color-bg-surface-secondary)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "var(--p-color-icon-emphasis)",
                    }}>
                      <Icon source={DatabaseIcon} />
                    </div>
                    <Text as="p" variant="bodySm" tone="subdued">Total Makes</Text>
                  </InlineStack>
                  <Text as="p" variant="headingXl" fontWeight="bold">
                    {makes.length}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <InlineStack gap="100" blockAlign="center">
                    <div style={{
                      width: "20px", height: "20px",
                      borderRadius: "var(--p-border-radius-100)",
                      background: "var(--p-color-bg-surface-secondary)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "var(--p-color-icon-emphasis)",
                    }}>
                      <Icon source={CategoriesIcon} />
                    </div>
                    <Text as="p" variant="bodySm" tone="subdued">Total Models</Text>
                  </InlineStack>
                  <Text as="p" variant="headingXl" fontWeight="bold">
                    {totalModels.toLocaleString()}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <InlineStack gap="100" blockAlign="center">
                    <div style={{
                      width: "20px", height: "20px",
                      borderRadius: "var(--p-border-radius-100)",
                      background: "var(--p-color-bg-surface-secondary)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "var(--p-color-icon-emphasis)",
                    }}>
                      <Icon source={GaugeIcon} />
                    </div>
                    <Text as="p" variant="bodySm" tone="subdued">Total Engines</Text>
                  </InlineStack>
                  <Text as="p" variant="headingXl" fontWeight="bold">
                    {totalEngines.toLocaleString()}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="p" variant="bodySm" tone="subdued">Active Makes</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {activeMakeCount} / {limits.activeMakes === 999_999 ? "\u221E" : limits.activeMakes}
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="headingXl" fontWeight="bold">
                    {activeMakeCount}
                  </Text>
                  {limits.activeMakes !== 999_999 && (
                    <ProgressBar progress={activePct} size="small" tone="primary" />
                  )}
                </BlockStack>
              </Card>
            </InlineGrid>

            {/* Breadcrumb navigation */}
            {renderBreadcrumb()}

            {/* Content based on current view */}
            {currentView === "makes" && renderMakesView()}
            {currentView === "models" && renderModelsView()}
            {currentView === "engines" && renderEnginesView()}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
