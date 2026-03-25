import { useState, useCallback, useEffect, useRef } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, useRevalidator, Form } from "react-router";
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
  Pagination,
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
import { getPlanLimits, getTenant, PLAN_LIMITS, assertFeature, BillingGateError } from "../lib/billing.server";
import { PlanGate } from "../components/PlanGate";
import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import { useAppData } from "../lib/use-app-data";
import { OperationProgress } from "../components/OperationProgress";
import { statMiniStyle, statGridStyle, STATUS_TONES } from "../lib/design";
import type { PlanTier, CollectionStrategy } from "../lib/types";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Run ALL queries in parallel — including tenant lookup
  const [tenant, collectionsResult, appSettingsResult] = await Promise.all([
    getTenant(shopId),
    db.from("collection_mappings")
      .select("*")
      .eq("shop_id", shopId)
      .order("created_at", { ascending: false }),
    db.from("app_settings")
      .select("*")
      .eq("shop_id", shopId)
      .maybeSingle(),
  ]);

  const plan: PlanTier = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);

  if (collectionsResult.error) {
    console.error("Collection mappings query error:", collectionsResult.error);
  }

  // Count unique combos by querying DB with pagination (avoids 1000-row limit)
  const allFitments: Array<{ make: string; model: string; year_from: number | null; year_to: number | null }> = [];
  let fitOffset = 0;
  while (true) {
    const { data: batch } = await db.from("vehicle_fitments")
      .select("make, model, year_from, year_to")
      .eq("shop_id", shopId)
      .not("make", "is", null)
      .not("model", "is", null)
      .range(fitOffset, fitOffset + 999);
    if (!batch || batch.length === 0) break;
    allFitments.push(...(batch as typeof allFitments));
    fitOffset += batch.length;
    if (batch.length < 1000) break;
  }

  const uniqueMakes = [...new Set(allFitments.map(f => f.make))];
  const uniqueMakeModels = [...new Set(allFitments.map(f => `${f.make}|${f.model}`))];
  const uniqueMakeModelYears = [...new Set(
    allFitments
      .filter(f => f.year_from)
      .map(f => {
        const yr = f.year_to ? `${f.year_from}-${f.year_to}` : `${f.year_from}+`;
        return `${f.make}|${f.model}|${yr}`;
      })
  )];

  return {
    plan,
    limits,
    allLimits: PLAN_LIMITS,
    collections: collectionsResult.data ?? [],
    appSettings: appSettingsResult.data,
    uniqueMakes,
    uniqueMakeModelCount: uniqueMakeModels.length,
    uniqueMakeModelYearCount: uniqueMakeModelYears.length,
    loaderError: collectionsResult.error?.message ?? null,
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Plan gate: smartCollections feature required
  try {
    await assertFeature(shopId, "smartCollections");
  } catch (err: unknown) {
    if (err instanceof BillingGateError) {
      return data({ error: err.message }, { status: 403 });
    }
    throw err;
  }

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
    uniqueMakeModelYearCount,
    loaderError,
  } = useLoaderData<typeof loader>();

  const rawActionData = useActionData<typeof action>();
  const actionData = rawActionData as { error?: string; message?: string; success?: boolean } | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [strategy, setStrategy] = useState<string>(
    appSettings?.collection_strategy ?? "make"
  );
  const [autoCreate, setAutoCreate] = useState<boolean>(
    appSettings?.auto_create_collections ?? false
  );

  // Live stats + active jobs polling
  const { stats: polledStats, activeJobs, refresh: refreshData } = useAppData();
  const liveCollectionCount = polledStats.collections ?? collections.length;
  const liveFitmentCount = polledStats.fitments ?? 0;

  // Find active collection job for progress bar
  const collectionJob = (activeJobs || []).find((j: any) => j.type === "collections");
  const isCreating = !!collectionJob;

  // Revalidate loader data periodically while a collections job is active
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!isCreating) return;
    const interval = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 10000);
    return () => clearInterval(interval);
  }, [isCreating, revalidator]);

  // Also revalidate once when a collection job completes
  const prevCreating = useRef(isCreating);
  useEffect(() => {
    if (prevCreating.current && !isCreating) {
      if (revalidator.state === "idle") revalidator.revalidate();
    }
    prevCreating.current = isCreating;
  }, [isCreating, revalidator]);

  // Detect duplicates in the collection list
  const duplicateTitles = new Set<string>();
  const seenTitles = new Set<string>();
  for (const c of collections) {
    if (seenTitles.has(c.title)) duplicateTitles.add(c.title);
    else seenTitles.add(c.title);
  }
  const hasDuplicates = duplicateTitles.size > 0;

  // Pagination for existing collections
  const COLLECTIONS_PER_PAGE = 25;
  const [collPage, setCollPage] = useState(1);
  const totalCollPages = Math.max(1, Math.ceil(collections.length / COLLECTIONS_PER_PAGE));
  const pagedCollections = collections.slice(
    (collPage - 1) * COLLECTIONS_PER_PAGE,
    collPage * COLLECTIONS_PER_PAGE,
  );

  const showSuccess = actionData && "success" in actionData && actionData.success;
  const showError = actionData && "error" in actionData;

  // Calculate TOTAL expected collections (all levels combined for the strategy)
  const previewCount =
    strategy === "make"
      ? uniqueMakes.length
      : strategy === "make_model"
        ? uniqueMakes.length + uniqueMakeModelCount
        : uniqueMakes.length + uniqueMakeModelCount + uniqueMakeModelYearCount;

  return (
    <Page fullWidth title="Collections">
      <Layout>
        {/* How It Works */}
        <Layout.Section>
          <HowItWorks
            steps={[
              { number: 1, title: "Map Products First", description: "Collections are auto-generated from your fitment data. Map products to vehicles using auto-extraction or manual mapping before creating collections.", linkText: "Go to Fitment", linkUrl: "/app/fitment" },
              { number: 2, title: "Choose Strategy", description: "Select how collections are organized: by Make only (e.g. 'BMW Parts'), by Make & Model (e.g. 'BMW 3 Series Parts'), or by Make, Model & Year range." },
              { number: 3, title: "Auto-Create", description: "Collections are created with brand logos, SEO titles and descriptions, smart tag-based rules, and published to your Online Store automatically." },
            ]}
          />
        </Layout.Section>

        {/* Active collection creation progress */}
        {isCreating && collectionJob && (
          <Layout.Section>
            <OperationProgress
              label="Creating collections"
              status="running"
              processed={liveCollectionCount}
              total={previewCount}
              startedAt={collectionJob.started_at}
              badges={{
                "created": { count: liveCollectionCount, tone: "success" },
                "target": { count: previewCount, tone: "info" },
              }}
            />
          </Layout.Section>
        )}

        {/* Duplicate warning */}
        {hasDuplicates && (
          <Layout.Section>
            <Banner tone="warning" title={`${duplicateTitles.size} duplicate collections detected`}>
              <p>The following collections have duplicates: {[...duplicateTitles].slice(0, 5).join(", ")}{duplicateTitles.size > 5 ? ` and ${duplicateTitles.size - 5} more` : ""}. Delete duplicates from Shopify admin to clean up.</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Banners */}
        {showError && (
          <Layout.Section>
            <Banner tone="critical">
              <p>{actionData?.error}</p>
            </Banner>
          </Layout.Section>
        )}
        {loaderError && (
          <Layout.Section>
            <Banner tone="warning">
              <p>Failed to load collection data: {loaderError}</p>
            </Banner>
          </Layout.Section>
        )}

        {showSuccess && (
          <Layout.Section>
            <Banner tone="success">
              <p>{actionData?.message}</p>
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
                  <IconBadge icon={CollectionIcon} color="var(--p-color-icon-emphasis)" />
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

        {/* Collection Preview stat bar */}
        <Layout.Section>
          <Card padding="0">
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
              borderBottom: "1px solid var(--p-color-border-secondary)",
            }}>
              {[
                { icon: HashtagIcon, count: `${uniqueMakes.length}`, label: "Unique makes in fitments" },
                { icon: LinkIcon, count: `${uniqueMakeModelCount}`, label: "Unique make + model combos" },
                { icon: TargetIcon, count: String(previewCount), label: `Expected (${STRATEGY_LABELS[strategy]})` },
                { icon: CollectionFilledIcon, count: `${liveCollectionCount}`, label: "Existing collections" },
              ].map((item, i) => (
                <div key={item.label} style={{
                  padding: "var(--p-space-400)",
                  borderRight: i < 3 ? "1px solid var(--p-color-border-secondary)" : "none",
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
        </Layout.Section>


        {/* Make badges preview */}
        {strategy === "make" && uniqueMakes.length > 0 && (
          <Layout.Section>
            <Card>
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
            </Card>
          </Layout.Section>
        )}

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
                <IconBadge icon={CollectionFilledIcon} color="var(--p-color-icon-emphasis)" />
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
                <BlockStack gap="300">
                  <Text as="p" variant="bodySm" tone="subdued">
                    {`Showing ${(collPage - 1) * COLLECTIONS_PER_PAGE + 1}–${Math.min(collPage * COLLECTIONS_PER_PAGE, collections.length)} of ${collections.length} collections`}
                  </Text>
                  <IndexTable
                    resourceName={{
                      singular: "collection",
                      plural: "collections",
                    }}
                    itemCount={pagedCollections.length}
                    headings={[
                      { title: "Title" },
                      { title: "Handle" },
                      { title: "Strategy" },
                      { title: "Make" },
                      { title: "Model" },
                    ]}
                    selectable={false}
                  >
                    {pagedCollections.map((col: any, index: number) => (
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
                          <Badge tone={col.type === "make" ? "info" : col.type === "make_model_year" ? "warning" : "success"}>
                            {col.type === "make" ? "Make" : col.type === "make_model" ? "Make + Model" : col.type === "make_model_year" ? "Make + Model + Year" : col.type || "—"}
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
                  {totalCollPages > 1 && (
                    <InlineStack align="center">
                      <Pagination
                        hasPrevious={collPage > 1}
                        hasNext={collPage < totalCollPages}
                        onPrevious={() => setCollPage((p) => Math.max(1, p - 1))}
                        onNext={() => setCollPage((p) => Math.min(totalCollPages, p + 1))}
                        label={`Page ${collPage} of ${totalCollPages}`}
                      />
                    </InlineStack>
                  )}
                </BlockStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
