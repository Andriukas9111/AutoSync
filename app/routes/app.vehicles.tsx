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
  ResourceList,
  ResourceItem,
  Spinner,
  Collapsible,
  EmptyState,
  Icon,
  Divider,
  Thumbnail,
  ProgressBar,
} from "@shopify/polaris";
import { SearchIcon, ChevronDownIcon, ChevronUpIcon } from "@shopify/polaris-icons";

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
  if (from && !to) return `${from}–present`;
  if (!from && to) return `–${to}`;
  if (from === to) return `${from}`;
  return `${from}–${to}`;
}

function formatDisplacement(cc: number | null): string {
  if (!cc) return "";
  return `${(cc / 1000).toFixed(1)}L`;
}

function fuelBadgeTone(fuel: string | null): "default" | "info" | "success" | "warning" | "critical" {
  if (!fuel) return "default";
  const f = fuel.toLowerCase();
  if (f.includes("petrol") || f.includes("gasoline")) return "warning";
  if (f.includes("diesel")) return "info";
  if (f.includes("electric")) return "success";
  if (f.includes("hybrid")) return "success";
  return "default";
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
  const [expandedMake, setExpandedMake] = useState<string | null>(null);
  const [models, setModels] = useState<ModelItem[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const [engines, setEngines] = useState<EngineItem[]>([]);
  const [enginesLoading, setEnginesLoading] = useState(false);

  const showError = actionData && "error" in actionData;

  // Filter makes by search
  const filteredMakes = makes.filter((make: MakeItem) =>
    make.name.toLowerCase().includes(searchValue.toLowerCase())
  );

  const handleExpandMake = useCallback(
    async (makeId: string) => {
      if (expandedMake === makeId) {
        setExpandedMake(null);
        setModels([]);
        setExpandedModel(null);
        setEngines([]);
        return;
      }
      setExpandedMake(makeId);
      setExpandedModel(null);
      setEngines([]);
      setModels([]);
      setModelsLoading(true);

      try {
        const response = await fetch(
          `/app/api/ymme?level=models&make_id=${makeId}`
        );
        if (response.ok) {
          const result = await response.json();
          setModels(result.models ?? result.data ?? []);
        }
      } catch (err) {
        console.error("Failed to fetch models:", err);
      } finally {
        setModelsLoading(false);
      }
    },
    [expandedMake]
  );

  const handleExpandModel = useCallback(
    async (modelId: string) => {
      if (expandedModel === modelId) {
        setExpandedModel(null);
        setEngines([]);
        return;
      }
      setExpandedModel(modelId);
      setEngines([]);
      setEnginesLoading(true);

      try {
        const response = await fetch(
          `/app/api/ymme?level=engines&model_id=${modelId}`
        );
        if (response.ok) {
          const result = await response.json();
          setEngines(result.engines ?? result.data ?? []);
        }
      } catch (err) {
        console.error("Failed to fetch engines:", err);
      } finally {
        setEnginesLoading(false);
      }
    },
    [expandedModel]
  );

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

  return (
    <Page
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
              <Text as="p" variant="bodySm" tone="subdued">Total Makes</Text>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {makes.length}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">Total Models</Text>
              <Text as="p" variant="headingXl" fontWeight="bold">
                {totalModels.toLocaleString()}
              </Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">Total Engines</Text>
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
                  {activeMakeCount} / {limits.activeMakes === 999_999 ? "∞" : limits.activeMakes}
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

        {/* Makes list */}
        <Card padding="0">
          {filteredMakes.length === 0 ? (
            <Box padding="400">
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
            </Box>
          ) : (
            <ResourceList
              resourceName={{ singular: "make", plural: "makes" }}
              items={filteredMakes}
              renderItem={(make: MakeItem) => {
                const isExpanded = expandedMake === make.id;

                return (
                  <ResourceItem
                    id={make.id}
                    onClick={() => handleExpandMake(make.id)}
                    verticalAlignment="center"
                  >
                    <BlockStack gap="300">
                      {/* Make Row */}
                      <InlineStack
                        align="space-between"
                        blockAlign="center"
                        wrap={false}
                      >
                        <InlineStack gap="300" blockAlign="center">
                          {/* Logo or initials */}
                          {make.logo_url ? (
                            <div
                              style={{
                                width: 36,
                                height: 36,
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
                                  width: 28,
                                  height: 28,
                                  objectFit: "contain",
                                }}
                              />
                              <span
                                style={{
                                  display: "none",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  width: 28,
                                  height: 28,
                                  fontSize: 11,
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
                                width: 36,
                                height: 36,
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
                          <BlockStack gap="0">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="span" variant="bodyMd" fontWeight="semibold">
                                {make.name}
                              </Text>
                              {make.country && (
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {make.country}
                                </Text>
                              )}
                            </InlineStack>
                            {make.nhtsa_make_id && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                NHTSA ID: {make.nhtsa_make_id}
                              </Text>
                            )}
                          </BlockStack>
                        </InlineStack>

                        <InlineStack gap="200" blockAlign="center">
                          {make.productCount > 0 && (
                            <Badge tone="info">
                              {make.productCount} fitment{make.productCount !== 1 ? "s" : ""}
                            </Badge>
                          )}
                          {make.isActive ? (
                            <Badge tone="success">Active</Badge>
                          ) : (
                            <Badge>Inactive</Badge>
                          )}
                          <div onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
                            <Button
                              size="slim"
                              variant={make.isActive ? "secondary" : "primary"}
                              onClick={() => handleToggleMake(make.id, make.isActive)}
                              loading={isToggling}
                            >
                              {make.isActive ? "Disable" : "Enable"}
                            </Button>
                          </div>
                          <Icon source={isExpanded ? ChevronUpIcon : ChevronDownIcon} />
                        </InlineStack>
                      </InlineStack>

                      {/* Expanded: Models */}
                      <Collapsible
                        open={isExpanded}
                        id={`models-${make.id}`}
                        transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
                      >
                        <Box
                          paddingInlineStart="600"
                          paddingBlockStart="200"
                          paddingBlockEnd="200"
                        >
                          {modelsLoading ? (
                            <InlineStack gap="200" blockAlign="center">
                              <Spinner size="small" />
                              <Text as="span" variant="bodySm" tone="subdued">
                                Loading models...
                              </Text>
                            </InlineStack>
                          ) : models.length > 0 ? (
                            <BlockStack gap="200">
                              <Text as="p" variant="bodyMd" fontWeight="semibold">
                                Models ({models.length})
                              </Text>
                              <Divider />
                              {models.map((model) => {
                                const isModelExpanded = expandedModel === model.id;
                                const yearRange = formatYearRange(model.year_from, model.year_to);

                                return (
                                  <BlockStack gap="100" key={model.id}>
                                    <div
                                      role="button"
                                      tabIndex={0}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleExpandModel(model.id);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          e.stopPropagation();
                                          handleExpandModel(model.id);
                                        }
                                      }}
                                      style={{
                                        cursor: "pointer",
                                        padding: "8px 12px",
                                        borderRadius: 8,
                                        backgroundColor: isModelExpanded
                                          ? "var(--p-color-bg-surface-hover)"
                                          : "transparent",
                                        transition: "background-color 0.15s",
                                      }}
                                    >
                                      <InlineStack align="space-between" blockAlign="center" wrap={false}>
                                        <InlineStack gap="200" blockAlign="center">
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
                                          <Icon source={isModelExpanded ? ChevronUpIcon : ChevronDownIcon} />
                                        </InlineStack>
                                      </InlineStack>
                                    </div>

                                    {/* Expanded: Engines */}
                                    <Collapsible
                                      open={isModelExpanded}
                                      id={`engines-${model.id}`}
                                      transition={{ duration: "200ms", timingFunction: "ease-in-out" }}
                                    >
                                      <Box paddingInlineStart="400" paddingBlockStart="100" paddingBlockEnd="200">
                                        {enginesLoading ? (
                                          <InlineStack gap="200" blockAlign="center">
                                            <Spinner size="small" />
                                            <Text as="span" variant="bodySm" tone="subdued">
                                              Loading engines...
                                            </Text>
                                          </InlineStack>
                                        ) : engines.length > 0 ? (
                                          <BlockStack gap="200">
                                            <Text as="p" variant="bodySm" fontWeight="semibold" tone="subdued">
                                              Engines ({engines.length})
                                            </Text>
                                            {engines.map((engine) => (
                                              <Box
                                                key={engine.id}
                                                padding="200"
                                                borderRadius="200"
                                                background="bg-surface-secondary"
                                              >
                                                <InlineStack align="space-between" blockAlign="center" wrap>
                                                  <InlineStack gap="200" blockAlign="center" wrap>
                                                    <Text as="span" variant="bodyMd" fontWeight="medium">
                                                      {engine.name || engine.code || "Unknown"}
                                                    </Text>
                                                    {engine.code && engine.name && (
                                                      <Badge>{engine.code}</Badge>
                                                    )}
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
                                                  </InlineStack>
                                                  <InlineStack gap="300" blockAlign="center" wrap>
                                                    {engine.power_hp && (
                                                      <Text as="span" variant="bodySm" tone="subdued">
                                                        {engine.power_hp} hp
                                                        {engine.power_kw ? ` (${engine.power_kw} kW)` : ""}
                                                      </Text>
                                                    )}
                                                    {engine.torque_nm && (
                                                      <Text as="span" variant="bodySm" tone="subdued">
                                                        {engine.torque_nm} Nm
                                                      </Text>
                                                    )}
                                                    {(engine.year_from || engine.year_to) && (
                                                      <Text as="span" variant="bodySm" tone="subdued">
                                                        {formatYearRange(engine.year_from, engine.year_to)}
                                                      </Text>
                                                    )}
                                                  </InlineStack>
                                                </InlineStack>
                                              </Box>
                                            ))}
                                          </BlockStack>
                                        ) : (
                                          <Text as="p" variant="bodySm" tone="subdued">
                                            No engines found for this model.
                                          </Text>
                                        )}
                                      </Box>
                                    </Collapsible>
                                  </BlockStack>
                                );
                              })}
                            </BlockStack>
                          ) : (
                            <Text as="p" variant="bodySm" tone="subdued">
                              No models found for this make.
                            </Text>
                          )}
                        </Box>
                      </Collapsible>
                    </BlockStack>
                  </ResourceItem>
                );
              }}
            />
          )}
        </Card>

        {/* Results count */}
        <Box paddingInlineStart="100">
          <Text as="span" variant="bodySm" tone="subdued">
            Showing {filteredMakes.length} of {makes.length} makes
            {searchValue ? " (filtered)" : ""}
          </Text>
        </Box>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
