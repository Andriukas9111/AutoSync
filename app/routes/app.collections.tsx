import { useState, useCallback } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, Form } from "react-router";
import { data } from "react-router";
import {
  Page,
  Layout,
  Card,
  Text,
  BlockStack,
  InlineStack,
  Badge,
  Checkbox,
  Select,
  Button,
  Banner,
  Box,
  Divider,
  IndexTable,
  EmptyState,
  Icon,
} from "@shopify/polaris";
import {
  CollectionIcon,
  ChartVerticalIcon,
  CollectionFilledIcon,
  HashtagIcon,
  LinkIcon,
  TargetIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getPlanLimits, getTenant, PLAN_LIMITS } from "../lib/billing.server";
import { PlanGate } from "../components/PlanGate";
import type { PlanTier, CollectionStrategy } from "../lib/types";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Run ALL queries in parallel — including tenant lookup
  const [tenant, collectionsResult, appSettingsResult, fitmentMakesResult, fitmentMakeModelsResult] = await Promise.all([
    getTenant(shopId),
    db.from("collection_mappings")
      .select("*")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false }),
    db.from("app_settings")
      .select("*")
      .eq("shop_id", shopId)
      .maybeSingle(),
    db.from("vehicle_fitments")
      .select("make")
      .eq("shop_id", shopId)
      .not("make", "is", null),
    db.from("vehicle_fitments")
      .select("make, model")
      .eq("shop_id", shopId)
      .not("make", "is", null)
      .not("model", "is", null),
  ]);

  const plan: PlanTier = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);

  if (collectionsResult.error) {
    console.error("Collection mappings query error:", collectionsResult.error);
  }

  // Deduplicate makes and make+model combos in JS
  const uniqueMakes = fitmentMakesResult.data
    ? [...new Set(fitmentMakesResult.data.map((f: any) => f.make).filter(Boolean))]
    : [];

  const uniqueMakeModels = fitmentMakeModelsResult.data
    ? [...new Set(
        fitmentMakeModelsResult.data.map((f: any) => `${f.make}|${f.model}`)
      )]
    : [];

  return {
    plan,
    limits,
    allLimits: PLAN_LIMITS,
    collections: collectionsResult.data ?? [],
    appSettings: appSettingsResult.data,
    uniqueMakes,
    uniqueMakeModelCount: uniqueMakeModels.length,
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

  if (_action === "save_collection_settings") {
    const collectionStrategy = formData.get("collection_strategy") as string || "make";
    const autoCreateCollections = formData.get("auto_create_collections") === "true";

    // Upsert app_settings
    const { data: existing } = await db
      .from("app_settings")
      .select("id")
      .eq("shop_id", shopId)
      .maybeSingle();

    if (existing) {
      const { error } = await db
        .from("app_settings")
        .update({
          collection_strategy: collectionStrategy,
          auto_create_collections: autoCreateCollections,
          updated_at: new Date().toISOString(),
        })
        .eq("shop_id", shopId);

      if (error) {
        return data({ error: "Failed to save settings: " + error.message }, { status: 500 });
      }
    } else {
      const { error } = await db
        .from("app_settings")
        .insert({
          shop_id: shopId,
          collection_strategy: collectionStrategy,
          auto_create_collections: autoCreateCollections,
        });

      if (error) {
        return data({ error: "Failed to save settings: " + error.message }, { status: 500 });
      }
    }

    return data({ success: true, message: "Collection settings saved" });
  }

  return data({ error: "Unknown action" }, { status: 400 });
};

// ---------------------------------------------------------------------------
// Strategy labels
// ---------------------------------------------------------------------------

const STRATEGY_OPTIONS = [
  { label: "By Make (e.g. BMW, Audi)", value: "make" },
  { label: "By Make & Model (e.g. BMW 3 Series)", value: "make_model" },
  { label: "By Make, Model & Year (e.g. BMW 3 Series 2020)", value: "make_model_year" },
];

const STRATEGY_LABELS: Record<string, string> = {
  make: "By Make",
  make_model: "By Make & Model",
  make_model_year: "By Make, Model & Year",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Collections() {
  const {
    plan,
    limits,
    allLimits,
    collections,
    appSettings,
    uniqueMakes,
    uniqueMakeModelCount,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [strategy, setStrategy] = useState<string>(
    appSettings?.collection_strategy ?? "make"
  );
  const [autoCreate, setAutoCreate] = useState<boolean>(
    appSettings?.auto_create_collections ?? false
  );

  const showSuccess = actionData && "success" in actionData && actionData.success;
  const showError = actionData && "error" in actionData;

  // Calculate preview count based on strategy
  const previewCount =
    strategy === "make"
      ? uniqueMakes.length
      : strategy === "make_model"
        ? uniqueMakeModelCount
        : uniqueMakeModelCount; // make_model_year would be more, but we approximate

  return (
    <Page fullWidth title="Collections">
      <Layout>
        {/* Banners */}
        {showError && (
          <Layout.Section>
            <Banner tone="critical">
              <p>{(actionData as any).error}</p>
            </Banner>
          </Layout.Section>
        )}

        {showSuccess && (
          <Layout.Section>
            <Banner tone="success">
              <p>{(actionData as any).message}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Collection Strategy */}
        <Layout.Section>
          <PlanGate
            feature="smartCollections"
            currentPlan={plan}
            limits={limits}
            allLimits={allLimits}
          >
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <div style={{
                    width: "28px", height: "28px",
                    borderRadius: "var(--p-border-radius-200)",
                    background: "var(--p-color-bg-surface-secondary)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "var(--p-color-icon-emphasis)",
                  }}>
                    <Icon source={CollectionIcon} />
                  </div>
                  <Text as="h2" variant="headingMd">Collection Strategy</Text>
                </InlineStack>
                <Text as="p" variant="bodyMd" tone="subdued">
                  Choose how AutoSync creates smart collections from your vehicle
                  fitment data. Collections group products by vehicle compatibility.
                </Text>

                <Select
                  label="Strategy"
                  options={STRATEGY_OPTIONS}
                  value={strategy}
                  onChange={setStrategy}
                />

                <Divider />

                <Checkbox
                  label="Auto-create collections on push"
                  helpText="Automatically create or update smart collections whenever you push fitment data to Shopify"
                  checked={autoCreate}
                  onChange={setAutoCreate}
                />

                <Divider />

                {/* SEO Images gating */}
                <PlanGate
                  feature="collectionSeoImages"
                  currentPlan={plan}
                  limits={limits}
                  allLimits={allLimits}
                >
                  <BlockStack gap="200">
                    <InlineStack gap="200" blockAlign="center">
                      <Badge tone="info">Professional+</Badge>
                      <Text as="span" variant="bodyMd">
                        SEO titles, descriptions, and images are included with
                        collections on your plan.
                      </Text>
                    </InlineStack>
                  </BlockStack>
                </PlanGate>
              </BlockStack>
            </Card>
          </PlanGate>
        </Layout.Section>

        {/* Collection Preview */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <div style={{
                  width: "28px", height: "28px",
                  borderRadius: "var(--p-border-radius-200)",
                  background: "var(--p-color-bg-surface-secondary)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--p-color-icon-emphasis)",
                }}>
                  <Icon source={ChartVerticalIcon} />
                </div>
                <Text as="h2" variant="headingMd">Preview</Text>
              </InlineStack>
              <Text as="p" variant="bodyMd" tone="subdued">
                Based on your current fitment data and selected strategy, AutoSync
                would create the following collections.
              </Text>

              <InlineStack gap="600" wrap>
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{
                      width: "22px", height: "22px",
                      borderRadius: "var(--p-border-radius-200)",
                      background: "var(--p-color-bg-surface-secondary)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "var(--p-color-icon-emphasis)",
                    }}>
                      <Icon source={HashtagIcon} />
                    </div>
                    <Text as="p" variant="headingLg" fontWeight="bold">
                      {uniqueMakes.length}
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Unique makes in fitments
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{
                      width: "22px", height: "22px",
                      borderRadius: "var(--p-border-radius-200)",
                      background: "var(--p-color-bg-surface-secondary)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "var(--p-color-icon-emphasis)",
                    }}>
                      <Icon source={LinkIcon} />
                    </div>
                    <Text as="p" variant="headingLg" fontWeight="bold">
                      {uniqueMakeModelCount}
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Unique make + model combos
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <InlineStack gap="200" blockAlign="center">
                    <div style={{
                      width: "22px", height: "22px",
                      borderRadius: "var(--p-border-radius-200)",
                      background: "var(--p-color-bg-surface-secondary)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: "var(--p-color-icon-emphasis)",
                    }}>
                      <Icon source={TargetIcon} />
                    </div>
                    <Text as="p" variant="headingLg" fontWeight="bold">
                      ~{previewCount}
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Collections to create ({STRATEGY_LABELS[strategy]})
                  </Text>
                </BlockStack>
              </InlineStack>

              {strategy === "make" && uniqueMakes.length > 0 && (
                <Box paddingBlockStart="200">
                  <InlineStack gap="200" wrap>
                    {uniqueMakes.slice(0, 20).map((make) => (
                      <Badge key={make as string} tone="info">
                        {make as string}
                      </Badge>
                    ))}
                    {uniqueMakes.length > 20 && (
                      <Badge>{`+${uniqueMakes.length - 20} more`}</Badge>
                    )}
                  </InlineStack>
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Save Button */}
        <Layout.Section>
          <PlanGate
            feature="smartCollections"
            currentPlan={plan}
            limits={limits}
            allLimits={allLimits}
          >
            <Form method="post">
              <input type="hidden" name="_action" value="save_collection_settings" />
              <input type="hidden" name="collection_strategy" value={strategy} />
              <input
                type="hidden"
                name="auto_create_collections"
                value={String(autoCreate)}
              />
              <Button variant="primary" submit loading={isSubmitting}>
                Save Collection Settings
              </Button>
            </Form>
          </PlanGate>
        </Layout.Section>

        {/* Existing Collections */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <div style={{
                  width: "28px", height: "28px",
                  borderRadius: "var(--p-border-radius-200)",
                  background: "var(--p-color-bg-surface-secondary)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "var(--p-color-icon-emphasis)",
                }}>
                  <Icon source={CollectionFilledIcon} />
                </div>
                <Text as="h2" variant="headingMd">Existing Collections</Text>
              </InlineStack>

              {collections.length === 0 ? (
                <EmptyState
                  heading="No collections yet"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>
                    Collections will appear here once you push fitment data with
                    collection creation enabled, or use the Push page.
                  </p>
                </EmptyState>
              ) : (
                <IndexTable
                  resourceName={{
                    singular: "collection",
                    plural: "collections",
                  }}
                  itemCount={collections.length}
                  headings={[
                    { title: "Title" },
                    { title: "Handle" },
                    { title: "Strategy" },
                    { title: "Make" },
                    { title: "Model" },
                  ]}
                  selectable={false}
                >
                  {collections.map((col: any, index: number) => (
                    <IndexTable.Row
                      id={col.id}
                      key={col.id}
                      position={index}
                    >
                      <IndexTable.Cell>
                        <Text as="span" variant="bodyMd" fontWeight="semibold">
                          {col.title || "—"}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodyMd">
                          {col.handle || "—"}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Badge>
                          {STRATEGY_LABELS[col.strategy] || col.strategy || "—"}
                        </Badge>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodyMd">
                          {col.make || "—"}
                        </Text>
                      </IndexTable.Cell>
                      <IndexTable.Cell>
                        <Text as="span" variant="bodyMd">
                          {col.model || "—"}
                        </Text>
                      </IndexTable.Cell>
                    </IndexTable.Row>
                  ))}
                </IndexTable>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
