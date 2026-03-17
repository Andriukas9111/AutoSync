import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, Form, useFetcher } from "react-router";
import { data } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
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
} from "@shopify/polaris";

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
  const [tenantResult, makesResult, activeResult, fitmentResult] = await Promise.all([
    getTenant(shopId),
    db.from("ymme_makes")
      .select("id, name, country, logo_url")
      .eq("active", true)
      .order("name", { ascending: true }),
    db.from("tenant_active_makes")
      .select("ymme_make_id")
      .eq("shop_id", shopId),
    db.from("vehicle_fitments")
      .select("make")
      .eq("shop_id", shopId)
      .not("make", "is", null),
  ]);

  const tenant = tenantResult;
  const plan: PlanTier = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);

  if (makesResult.error) {
    console.error("Makes query error:", makesResult.error);
  }
  if (activeResult.error) {
    console.error("Tenant active makes query error:", activeResult.error);
  }

  const allMakes = makesResult.data;
  const activeMakeIds = new Set(
    (activeResult.data ?? []).map((tam: any) => tam.ymme_make_id)
  );

  // Count products per make name
  const productCountByMake: Record<string, number> = {};
  if (fitmentResult.data) {
    for (const row of fitmentResult.data) {
      if (row.make) {
        productCountByMake[row.make] = (productCountByMake[row.make] || 0) + 1;
      }
    }
  }

  // Build makes list with enriched data
  const makes = (allMakes ?? []).map((make: any) => ({
    ...make,
    isActive: activeMakeIds.has(make.id),
    productCount: productCountByMake[make.name] || 0,
  }));

  return {
    plan,
    limits,
    allLimits: PLAN_LIMITS,
    makes,
    activeMakeCount: activeMakeIds.size,
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

    // Check plan limits before enabling
    if (enable) {
      const tenant = await getTenant(shopId);
      const plan: PlanTier = tenant?.plan ?? "free";
      const limits = getPlanLimits(plan);

      // Count current active makes
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

      // Insert
      const { error } = await db
        .from("tenant_active_makes")
        .insert({ shop_id: shopId, ymme_make_id: makeId });

      if (error) {
        // Ignore duplicate key errors
        if (!error.message.includes("duplicate")) {
          return data({ error: "Failed to enable make: " + error.message }, { status: 500 });
        }
      }
    } else {
      // Delete
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
// Component
// ---------------------------------------------------------------------------

interface MakeItem {
  id: string;
  name: string;
  country: string | null;
  logo_url: string | null;
  isActive: boolean;
  productCount: number;
}

export default function Vehicles() {
  const { plan, limits, allLimits, makes, activeMakeCount } =
    useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const fetcher = useFetcher();

  const [searchValue, setSearchValue] = useState("");
  const [expandedMake, setExpandedMake] = useState<string | null>(null);
  const [models, setModels] = useState<any[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

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
        return;
      }
      setExpandedMake(makeId);
      setModels([]);
      setModelsLoading(true);

      try {
        const response = await fetch(
          `/app/api/ymme?level=models&make_id=${makeId}`
        );
        if (response.ok) {
          const result = await response.json();
          setModels(result.data ?? result ?? []);
        }
      } catch (err) {
        console.error("Failed to fetch models:", err);
      } finally {
        setModelsLoading(false);
      }
    },
    [expandedMake]
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

  return (
    <Page title="Vehicles">
      <Layout>
        {/* Error banner */}
        {showError && (
          <Layout.Section>
            <Banner tone="critical">
              <p>{(actionData as any).error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Fetcher error */}
        {fetcher.data && "error" in (fetcher.data as any) && (
          <Layout.Section>
            <Banner tone="critical">
              <p>{(fetcher.data as any).error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Summary */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Vehicle Makes
              </Text>
              <InlineStack gap="600" wrap>
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {makes.length}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Total makes available
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {activeMakeCount}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Active for your store
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {limits.activeMakes === 999_999
                      ? "Unlimited"
                      : limits.activeMakes}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Plan limit
                  </Text>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Search */}
        <Layout.Section>
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
            />
          </Card>
        </Layout.Section>

        {/* Makes list */}
        <Layout.Section>
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
                        <InlineStack
                          align="space-between"
                          blockAlign="center"
                          wrap={false}
                        >
                          <InlineStack gap="300" blockAlign="center">
                            {make.logo_url && (
                              <img
                                src={make.logo_url}
                                alt={make.name}
                                style={{
                                  width: 28,
                                  height: 28,
                                  objectFit: "contain",
                                  borderRadius: 4,
                                }}
                              />
                            )}
                            <BlockStack gap="0">
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

                          <InlineStack gap="300" blockAlign="center">
                            {make.productCount > 0 && (
                              <Badge tone="info">
                                {make.productCount} fitment
                                {make.productCount !== 1 ? "s" : ""}
                              </Badge>
                            )}
                            {make.isActive ? (
                              <Badge tone="success">Active</Badge>
                            ) : (
                              <Badge>Inactive</Badge>
                            )}
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{ display: "inline-flex" }}
                            >
                              <Button
                                size="slim"
                                variant={make.isActive ? "secondary" : "primary"}
                                onClick={() =>
                                  handleToggleMake(make.id, make.isActive)
                                }
                                loading={isToggling}
                              >
                                {make.isActive ? "Disable" : "Enable"}
                              </Button>
                            </div>
                          </InlineStack>
                        </InlineStack>

                        {/* Expanded models */}
                        <Collapsible
                          open={isExpanded}
                          id={`models-${make.id}`}
                          transition={{
                            duration: "200ms",
                            timingFunction: "ease-in-out",
                          }}
                        >
                          <Box
                            paddingInlineStart="400"
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
                                <Text
                                  as="p"
                                  variant="bodySm"
                                  fontWeight="semibold"
                                >
                                  Models ({models.length})
                                </Text>
                                <InlineStack gap="200" wrap>
                                  {models.map((model: any) => (
                                    <Badge key={model.id || model.name}>
                                      {model.name}
                                    </Badge>
                                  ))}
                                </InlineStack>
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
        </Layout.Section>

        {/* Results count */}
        <Layout.Section>
          <Box paddingInlineStart="100">
            <Text as="span" variant="bodySm" tone="subdued">
              Showing {filteredMakes.length} of {makes.length} makes
              {searchValue ? " (filtered)" : ""}
            </Text>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
