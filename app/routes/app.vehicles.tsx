import { useState, useCallback, useMemo } from "react";
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
  Modal,
  Tabs,
} from "@shopify/polaris";
import {
  SearchIcon,
  ChevronLeftIcon,
  DatabaseIcon,
  CategoriesIcon,
  GaugeIcon,
  CheckCircleIcon,
  ViewIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getPlanLimits, getTenant } from "../lib/billing.server";
import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import type { PlanTier } from "../lib/types";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Run all queries in parallel
  const [
    tenantResult,
    makesResult,
    activeResult,
    fitmentResult,
    modelCountResult,
    engineCountResult,
  ] = await Promise.all([
    getTenant(shopId),
    db
      .from("ymme_makes")
      .select("id, name, slug, country, logo_url")
      .eq("active", true)
      .order("name", { ascending: true }),
    db
      .from("tenant_active_makes")
      .select("ymme_make_id")
      .eq("shop_id", shopId),
    db
      .from("vehicle_fitments")
      .select("make")
      .eq("shop_id", shopId)
      .not("make", "is", null),
    db
      .from("ymme_models")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
    db
      .from("ymme_engines")
      .select("id", { count: "exact", head: true })
      .eq("active", true),
  ]);

  const tenant = tenantResult;
  const plan: PlanTier = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);

  const allMakes = makesResult.data ?? [];
  const activeMakeIds = new Set(
    (activeResult.data ?? []).map((tam: { ymme_make_id: string }) => tam.ymme_make_id),
  );

  // Count fitments per make — use active makes as the source of truth
  // (active makes are synced from fitments by the Edge Function)
  const productCountByMake: Record<string, number> = {};
  const activeMakeNames = allMakes
    .filter((m: { id: string }) => activeMakeIds.has(m.id))
    .map((m: { name: string }) => m.name);

  // For each active make, get the fitment count efficiently (one query per active make)
  // This is fast because there are only ~36 active makes, not 5000+ fitments
  if (activeMakeNames.length > 0 && activeMakeNames.length <= 50) {
    const countPromises = activeMakeNames.map(async (makeName: string) => {
      const { count } = await db.from("vehicle_fitments")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId)
        .eq("make", makeName);
      return { make: makeName, count: count ?? 0 };
    });
    const counts = await Promise.all(countPromises);
    for (const { make, count } of counts) {
      productCountByMake[make] = count;
    }
  }

  // Build makes list with enriched data
  const makes = allMakes.map((make: { id: string; name: string; slug: string | null; country: string | null; logo_url: string | null }) => ({
    ...make,
    isActive: activeMakeIds.has(make.id),
    productCount: productCountByMake[make.name] || 0,
  }));

  // Count how many makes have products
  const mappedMakeCount = makes.filter((m: { productCount: number }) => m.productCount > 0).length;

  return {
    plan,
    limits,
    makes,
    activeMakeCount: activeMakeIds.size,
    mappedMakeCount,
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

      if (
        limits.activeMakes < 999_999 &&
        (currentActive ?? 0) >= limits.activeMakes
      ) {
        return data(
          {
            error: `You have reached your plan limit of ${limits.activeMakes} active makes. Upgrade to add more.`,
          },
          { status: 403 },
        );
      }

      const { error } = await db
        .from("tenant_active_makes")
        .insert({ shop_id: shopId, ymme_make_id: makeId });

      if (error && !error.message.includes("duplicate")) {
        return data(
          { error: "Failed to enable make: " + error.message },
          { status: 500 },
        );
      }
    } else {
      const { error } = await db
        .from("tenant_active_makes")
        .delete()
        .eq("shop_id", shopId)
        .eq("ymme_make_id", makeId);

      if (error) {
        return data(
          { error: "Failed to disable make: " + error.message },
          { status: 500 },
        );
      }
    }

    return data({ success: true, makeId, enabled: enable });
  }

  if (_action === "auto_activate") {
    // Auto-activate all makes that have mapped products
    const { data: fitments } = await db
      .from("vehicle_fitments")
      .select("make")
      .eq("shop_id", shopId)
      .not("make", "is", null);

    const fitmentMakes = new Set(
      (fitments ?? []).map((f: { make: string }) => f.make),
    );

    if (fitmentMakes.size === 0) {
      return data({ error: "No mapped products found. Import and map products first." }, { status: 400 });
    }

    // Find make IDs for these make names
    const { data: matchedMakes } = await db
      .from("ymme_makes")
      .select("id, name")
      .in("name", Array.from(fitmentMakes));

    if (!matchedMakes || matchedMakes.length === 0) {
      return data({ error: "No YMME makes match your mapped products." }, { status: 400 });
    }

    // Get existing active makes
    const { data: existing } = await db
      .from("tenant_active_makes")
      .select("ymme_make_id")
      .eq("shop_id", shopId);

    const existingIds = new Set(
      (existing ?? []).map((e: { ymme_make_id: string }) => e.ymme_make_id),
    );

    // Insert missing ones
    const toInsert = matchedMakes
      .filter((m: { id: string }) => !existingIds.has(m.id))
      .map((m: { id: string }) => ({
        shop_id: shopId,
        ymme_make_id: m.id,
      }));

    if (toInsert.length > 0) {
      const { error } = await db
        .from("tenant_active_makes")
        .insert(toInsert);

      if (error) {
        return data(
          { error: "Failed to auto-activate: " + error.message },
          { status: 500 },
        );
      }
    }

    return data({
      success: true,
      activated: toInsert.length,
      total: matchedMakes.length,
    });
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
  cylinders: number | null;
  cylinder_config: string | null;
  aspiration: string | null;
  modification: string | null;
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

function fuelBadgeTone(
  fuel: string | null,
): "info" | "success" | "warning" | "critical" | undefined {
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
  const {
    plan,
    limits,
    makes,
    activeMakeCount,
    mappedMakeCount,
    totalModels,
    totalEngines,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const fetcher = useFetcher();
  const autoFetcher = useFetcher();

  const [searchValue, setSearchValue] = useState("");
  const [selectedTab, setSelectedTab] = useState(0);

  // Track which make is currently being toggled
  const [togglingMakeId, setTogglingMakeId] = useState<string | null>(null);

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

  // Engine detail modal
  const [detailEngine, setDetailEngine] = useState<EngineItem | null>(null);

  const showError = actionData && "error" in actionData;

  // Clear toggling state when fetcher completes
  if (fetcher.state === "idle" && togglingMakeId !== null) {
    // Defer the state update
    setTimeout(() => setTogglingMakeId(null), 0);
  }

  // Filter tabs
  const tabs = [
    { id: "all", content: `All (${makes.length})` },
    {
      id: "mapped",
      content: `With Fitments (${mappedMakeCount})`,
    },
    { id: "active", content: `Active (${activeMakeCount})` },
  ];

  // Filter makes by tab + search
  const filteredMakes = useMemo(() => {
    let filtered = makes as MakeItem[];

    // Tab filter
    if (selectedTab === 1) {
      filtered = filtered.filter((m) => m.productCount > 0);
    } else if (selectedTab === 2) {
      filtered = filtered.filter((m) => m.isActive);
    }

    // Search filter
    if (searchValue) {
      const q = searchValue.toLowerCase();
      filtered = filtered.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.country && m.country.toLowerCase().includes(q)),
      );
    }

    return filtered;
  }, [makes, selectedTab, searchValue]);

  // Navigate into a make - fetch its models
  const handleSelectMake = useCallback(async (make: MakeItem) => {
    setSelectedMake({
      id: make.id,
      name: make.name,
      logo_url: make.logo_url,
    });
    setSelectedModel(null);
    setEngines([]);
    setModels([]);
    setModelsLoading(true);
    setModelsError(null);
    setSearchValue("");

    try {
      const response = await fetch(
        `/app/api/ymme?level=models&make_id=${make.id}`,
      );
      if (response.ok) {
        const result = await response.json();
        setModels(result.models ?? result.data ?? []);
      } else {
        setModelsError("Failed to load models. Please try again.");
      }
    } catch {
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
        `/app/api/ymme?level=engines&model_id=${model.id}`,
      );
      if (response.ok) {
        const result = await response.json();
        setEngines(result.engines ?? result.data ?? []);
      } else {
        setEnginesError("Failed to load engines. Please try again.");
      }
    } catch {
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
      setTogglingMakeId(makeId);
      const formData = new FormData();
      formData.set("_action", "toggle_make");
      formData.set("make_id", makeId);
      formData.set("enable", String(!currentlyActive));
      fetcher.submit(formData, { method: "post" });
    },
    [fetcher],
  );

  const handleAutoActivate = useCallback(() => {
    const formData = new FormData();
    formData.set("_action", "auto_activate");
    autoFetcher.submit(formData, { method: "post" });
  }, [autoFetcher]);

  const activePct =
    limits.activeMakes > 0 && limits.activeMakes < 999_999
      ? Math.min(
          Math.round((activeMakeCount / limits.activeMakes) * 100),
          100,
        )
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
              <Text as="span" tone="subdued">
                /
              </Text>
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
              <Text as="span" tone="subdued">
                /
              </Text>
              <Text as="span" variant="bodyMd" fontWeight="semibold">
                {selectedModel.name}
                {selectedModel.generation && !selectedModel.generation.includes(" | ")
                  ? ` (${selectedModel.generation})`
                  : ""}
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
      {/* Tabs + Search */}
      <Card padding="0">
        <Box padding="400" paddingBlockEnd="0">
          <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} />
        </Box>
        <Box padding="400">
          <InlineStack gap="300" blockAlign="end" wrap={false}>
            <div style={{ flex: 1 }}>
              <TextField
                label="Search makes"
                labelHidden
                value={searchValue}
                onChange={setSearchValue}
                placeholder="Search by name or country..."
                clearButton
                onClearButtonClick={() => setSearchValue("")}
                autoComplete="off"
                prefix={<Icon source={SearchIcon} />}
              />
            </div>
            {/* Makes auto-activate when they have fitments — no manual button needed */}
          </InlineStack>
        </Box>
      </Card>

      {/* Auto-activate result */}
      {autoFetcher.data &&
        "success" in (autoFetcher.data as Record<string, unknown>) && (
          <Banner
            tone="success"
            onDismiss={() => {}}
          >
            <p>
              {`Activated ${(autoFetcher.data as { activated: number }).activated} makes that have mapped products.`}
            </p>
          </Banner>
        )}
      {autoFetcher.data &&
        "error" in (autoFetcher.data as Record<string, unknown>) && (
          <Banner tone="warning">
            <p>{(autoFetcher.data as { error: string }).error}</p>
          </Banner>
        )}

      {filteredMakes.length === 0 ? (
        <Card>
          <EmptyState
            heading={
              searchValue
                ? "No makes match your search"
                : selectedTab === 1
                  ? "No makes with mapped products yet"
                  : selectedTab === 2
                    ? "No active makes yet"
                    : "No vehicle makes available"
            }
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>
              {searchValue
                ? "Try a different search term."
                : selectedTab === 1
                  ? "Map products to vehicle fitments to see makes here."
                  : selectedTab === 2
                    ? "Enable makes to activate them for your store."
                    : "Vehicle makes will appear once the YMME database is populated."}
            </p>
          </EmptyState>
        </Card>
      ) : (
        <>
          <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 4 }} gap="400">
            {filteredMakes.map((make: MakeItem) => {
              const isThisToggling = togglingMakeId === make.id;
              return (
                <Card key={make.id}>
                  <BlockStack gap="300">
                    {/* Header: logo + name */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectMake(make)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleSelectMake(make);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <InlineStack
                        gap="300"
                        blockAlign="center"
                        wrap={false}
                      >
                        {make.logo_url ? (
                          <div
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 8,
                              overflow: "hidden",
                              backgroundColor:
                                "var(--p-color-bg-surface-secondary)",
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
                                const fallback =
                                  target.nextElementSibling as HTMLElement;
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
                              backgroundColor:
                                "var(--p-color-bg-surface-secondary)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              flexShrink: 0,
                            }}
                          >
                            <Text
                              as="span"
                              variant="bodySm"
                              fontWeight="bold"
                              tone="subdued"
                            >
                              {makeInitials(make.name)}
                            </Text>
                          </div>
                        )}
                        <BlockStack gap="050">
                          <Text
                            as="span"
                            variant="bodyMd"
                            fontWeight="semibold"
                          >
                            {make.name}
                          </Text>
                          {make.country && (
                            <Text as="span" variant="bodySm" tone="subdued">
                              {make.country}
                            </Text>
                          )}
                        </BlockStack>
                      </InlineStack>
                    </div>

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
                    <InlineStack
                      gap="200"
                      align="space-between"
                      blockAlign="center"
                    >
                      <Button
                        size="slim"
                        onClick={() => handleSelectMake(make)}
                      >
                        Browse models
                      </Button>
                      <Button
                        size="slim"
                        variant={make.isActive ? "secondary" : "primary"}
                        onClick={() =>
                          handleToggleMake(make.id, make.isActive)
                        }
                        loading={isThisToggling}
                        disabled={isThisToggling}
                      >
                        {make.isActive ? "Disable" : "Enable"}
                      </Button>
                    </InlineStack>
                  </BlockStack>
                </Card>
              );
            })}
          </InlineGrid>

          {/* Results count */}
          <Box paddingInlineStart="100">
            <Text as="span" variant="bodySm" tone="subdued">
              {`Showing ${filteredMakes.length} of ${makes.length} makes`}
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
                {`Loading models for ${selectedMake?.name}...`}
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
            <p>
              Models will appear here once they are added to the YMME database.
            </p>
          </EmptyState>
        </Card>
      ) : (
        <Card>
          <BlockStack gap="0">
            <Box paddingBlockEnd="300">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge
                  icon={CategoriesIcon}
                  color="var(--p-color-icon-emphasis)"
                />
                <Text as="p" variant="bodyMd" fontWeight="semibold">
                  {`${models.length} model${models.length !== 1 ? "s" : ""} for ${selectedMake?.name}`}
                </Text>
              </InlineStack>
            </Box>
            <Divider />
            {models.map((model, index) => {
              const yearRange = formatYearRange(
                model.year_from,
                model.year_to,
              );
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
                        <Text
                          as="span"
                          variant="bodyMd"
                          fontWeight="medium"
                        >
                          {model.name}
                        </Text>
                        {model.generation && !model.generation.includes(" | ") && !model.generation.startsWith(model.name) && model.generation !== model.name && (
                          <Badge tone="info">{model.generation}</Badge>
                        )}
                        {model.body_type && <Badge>{model.body_type}</Badge>}
                      </InlineStack>
                      <InlineStack gap="200" blockAlign="center">
                        {yearRange && (
                          <Text as="span" variant="bodySm" tone="subdued">
                            {yearRange}
                          </Text>
                        )}
                        <Text as="span" tone="subdued">
                          &rsaquo;
                        </Text>
                      </InlineStack>
                    </InlineStack>
                  </div>
                  {index < models.length - 1 && <Divider />}
                </Box>
              );
            })}
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );

  // ------- Engine Detail Modal -------
  const renderEngineModal = () => {
    if (!detailEngine) return null;

    const e = detailEngine;
    const yearRange = formatYearRange(e.year_from, e.year_to);

    const specs: { label: string; value: string }[] = [];
    if (e.displacement_cc)
      specs.push({
        label: "Displacement",
        value: `${formatDisplacement(e.displacement_cc)} (${e.displacement_cc} cc)`,
      });
    if (e.cylinders)
      specs.push({
        label: "Cylinders",
        value: `${e.cylinders}${e.cylinder_config ? ` (${e.cylinder_config})` : ""}`,
      });
    if (e.fuel_type) specs.push({ label: "Fuel Type", value: e.fuel_type });
    if (e.aspiration)
      specs.push({ label: "Aspiration", value: e.aspiration });
    if (e.power_hp)
      specs.push({
        label: "Power",
        value: `${e.power_hp} hp${e.power_kw ? ` / ${e.power_kw} kW` : ""}`,
      });
    if (e.torque_nm)
      specs.push({ label: "Torque", value: `${e.torque_nm} Nm` });
    if (yearRange)
      specs.push({ label: "Production Years", value: yearRange });
    if (e.code) specs.push({ label: "Engine Code", value: e.code });
    if (e.modification)
      specs.push({ label: "Modification", value: e.modification });

    return (
      <Modal
        open={true}
        onClose={() => setDetailEngine(null)}
        title={`${(e.name || "Engine Details").replace(/\s*\[[0-9a-f]{8}\]$/, "")}`}
      >
        <Modal.Section>
          <BlockStack gap="400">
            {/* Summary badges */}
            <InlineStack gap="200" wrap>
              {e.fuel_type && (
                <Badge tone={fuelBadgeTone(e.fuel_type)}>{e.fuel_type}</Badge>
              )}
              {e.displacement_cc && (
                <Badge tone="info">
                  {formatDisplacement(e.displacement_cc)}
                </Badge>
              )}
              {e.power_hp && <Badge>{`${e.power_hp} hp`}</Badge>}
              {yearRange && <Badge>{yearRange}</Badge>}
            </InlineStack>

            <Divider />

            {/* Full specs table */}
            <BlockStack gap="300">
              <Text as="p" variant="headingSm" fontWeight="semibold">
                Full Specifications
              </Text>
              {specs.map((spec) => (
                <InlineStack
                  key={spec.label}
                  align="space-between"
                  blockAlign="center"
                  wrap={false}
                >
                  <Text as="span" variant="bodySm" tone="subdued">
                    {spec.label}
                  </Text>
                  <Text as="span" variant="bodySm" fontWeight="medium">
                    {spec.value}
                  </Text>
                </InlineStack>
              ))}
            </BlockStack>

            {/* Vehicle context */}
            {selectedMake && selectedModel && (
              <>
                <Divider />
                <BlockStack gap="200">
                  <Text as="p" variant="headingSm" fontWeight="semibold">
                    Vehicle
                  </Text>
                  <InlineStack
                    align="space-between"
                    blockAlign="center"
                    wrap={false}
                  >
                    <Text as="span" variant="bodySm" tone="subdued">
                      Make
                    </Text>
                    <Text as="span" variant="bodySm" fontWeight="medium">
                      {selectedMake.name}
                    </Text>
                  </InlineStack>
                  <InlineStack
                    align="space-between"
                    blockAlign="center"
                    wrap={false}
                  >
                    <Text as="span" variant="bodySm" tone="subdued">
                      Model
                    </Text>
                    <Text as="span" variant="bodySm" fontWeight="medium">
                      {selectedModel.name}
                    </Text>
                  </InlineStack>
                </BlockStack>
              </>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    );
  };

  // ------- Engines Grid -------
  const renderEnginesView = () => (
    <BlockStack gap="400">
      {enginesLoading ? (
        <Card>
          <Box padding="800">
            <InlineStack align="center" gap="200" blockAlign="center">
              <Spinner size="small" />
              <Text as="span" variant="bodySm" tone="subdued">
                {`Loading engines for ${selectedModel?.name}...`}
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
            <p>
              Engines will appear here once they are added to the YMME
              database.
            </p>
          </EmptyState>
        </Card>
      ) : (
        <>
          <Box paddingInlineStart="100">
            <InlineStack gap="200" blockAlign="center">
              <IconBadge
                icon={GaugeIcon}
                color="var(--p-color-icon-emphasis)"
              />
              <Text as="p" variant="bodyMd" fontWeight="semibold">
                {`${engines.length} engine${engines.length !== 1 ? "s" : ""} for ${selectedMake?.name} ${selectedModel?.name}`}
              </Text>
            </InlineStack>
          </Box>

          <InlineGrid columns={{ xs: 1, sm: 1, md: 2 }} gap="400">
            {engines.map((engine) => {
              const yearRange = formatYearRange(
                engine.year_from,
                engine.year_to,
              );
              const rawName = engine.name || "Unknown Engine";
              // Strip dedup suffixes like " [92efc5dd]" from display
              const engineTitle = rawName.replace(/\s*\[[0-9a-f]{8}\]$/, "");

              return (
                <Card key={engine.id}>
                  <BlockStack gap="300">
                    {/* Engine heading + code badge */}
                    <InlineStack
                      align="space-between"
                      blockAlign="start"
                      wrap={false}
                    >
                      <InlineStack gap="200" blockAlign="center" wrap>
                        <Text
                          as="span"
                          variant="headingSm"
                          fontWeight="semibold"
                        >
                          {engineTitle}
                        </Text>
                        {engine.code && engine.name && (
                          <Badge>{engine.code}</Badge>
                        )}
                      </InlineStack>
                      <Button
                        size="slim"
                        variant="plain"
                        onClick={() => setDetailEngine(engine)}
                        icon={ViewIcon}
                        accessibilityLabel={`View details for ${engineTitle}`}
                      />
                    </InlineStack>

                    <Divider />

                    {/* Compact spec badges */}
                    <InlineStack gap="200" wrap>
                      {engine.displacement_cc && (
                        <Badge tone="info">
                          {formatDisplacement(engine.displacement_cc)}
                        </Badge>
                      )}
                      {engine.fuel_type && (
                        <Badge tone={fuelBadgeTone(engine.fuel_type)}>
                          {engine.fuel_type}
                        </Badge>
                      )}
                      {engine.power_hp && (
                        <Badge>{`${engine.power_hp} hp`}</Badge>
                      )}
                      {engine.aspiration && (
                        <Badge>{engine.aspiration}</Badge>
                      )}
                    </InlineStack>

                    {/* Key stats row */}
                    <InlineStack gap="400" wrap>
                      {engine.torque_nm && (
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">
                            Torque
                          </Text>
                          <Text as="span" variant="bodySm" fontWeight="medium">
                            {`${engine.torque_nm} Nm`}
                          </Text>
                        </BlockStack>
                      )}
                      {engine.cylinders && (
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">
                            Cylinders
                          </Text>
                          <Text as="span" variant="bodySm" fontWeight="medium">
                            {`${engine.cylinders}${engine.cylinder_config ? ` ${engine.cylinder_config}` : ""}`}
                          </Text>
                        </BlockStack>
                      )}
                      {yearRange && (
                        <BlockStack gap="050">
                          <Text as="span" variant="bodySm" tone="subdued">
                            Years
                          </Text>
                          <Text as="span" variant="bodySm" fontWeight="medium">
                            {yearRange}
                          </Text>
                        </BlockStack>
                      )}
                    </InlineStack>
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
            {/* How It Works */}
            <HowItWorks
              steps={[
                { number: 1, title: "Browse Makes", description: "View all vehicle makes in the database. Activate makes that match your product catalog to show them in the storefront YMME widget." },
                { number: 2, title: "Explore Models", description: "Click any make to see its models with generation info, body types, and year ranges. Each model links to specific engine variants." },
                { number: 3, title: "View Engines", description: "Drill down to engine specifications including displacement, power, torque, fuel type, and engine codes for precise fitment matching." },
              ]}
            />

            {/* Error banners */}
            {showError && (
              <Banner tone="critical">
                <p>{(actionData as { error: string }).error}</p>
              </Banner>
            )}
            {fetcher.data &&
              "error" in (fetcher.data as Record<string, unknown>) && (
                <Banner tone="critical">
                  <p>{(fetcher.data as { error: string }).error}</p>
                </Banner>
              )}

            {/* Stats Cards */}
            <Card padding="0">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fit, minmax(120px, 1fr))",
                  borderBottom:
                    "1px solid var(--p-color-border-secondary)",
                }}
              >
                {[
                  {
                    icon: DatabaseIcon,
                    count: `${makes.length}`,
                    label: "Total Makes",
                  },
                  {
                    icon: CategoriesIcon,
                    count: totalModels.toLocaleString(),
                    label: "Total Models",
                  },
                  {
                    icon: GaugeIcon,
                    count: totalEngines.toLocaleString(),
                    label: "Total Engines",
                  },
                  {
                    icon: CheckCircleIcon,
                    count: `${activeMakeCount}`,
                    label: "Active Makes",
                  },
                ].map((item, i) => (
                  <div
                    key={item.label}
                    style={{
                      padding: "var(--p-space-400)",
                      borderRight:
                        i < 3
                          ? "1px solid var(--p-color-border-secondary)"
                          : "none",
                      textAlign: "center",
                    }}
                  >
                    <BlockStack gap="200" inlineAlign="center">
                      <IconBadge
                        icon={item.icon}
                        color="var(--p-color-icon-emphasis)"
                      />
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
              {/* Plan limit progress (non-enterprise only) */}
              {limits.activeMakes > 0 && limits.activeMakes < 999_999 && (
                <Box padding="400">
                  <BlockStack gap="200">
                    <InlineStack
                      align="space-between"
                      blockAlign="center"
                    >
                      <Text as="span" variant="bodySm" tone="subdued">
                        Active makes used
                      </Text>
                      <Text as="span" variant="bodySm" fontWeight="medium">
                        {`${activeMakeCount} / ${limits.activeMakes}`}
                      </Text>
                    </InlineStack>
                    <ProgressBar progress={activePct} size="small" />
                  </BlockStack>
                </Box>
              )}
            </Card>

            {/* Breadcrumb navigation */}
            {renderBreadcrumb()}

            {/* Content based on current view */}
            {currentView === "makes" && renderMakesView()}
            {currentView === "models" && renderModelsView()}
            {currentView === "engines" && renderEnginesView()}
          </BlockStack>
        </Layout.Section>
      </Layout>

      {/* Engine detail modal */}
      {renderEngineModal()}
    </Page>
  );
}
