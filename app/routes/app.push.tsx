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
  ProgressBar,
  Spinner,
  Banner,
  Box,
  Divider,
  IndexTable,
} from "@shopify/polaris";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getPlanLimits, getTenant, assertFeature, PLAN_LIMITS } from "../lib/billing.server";
import { PlanGate } from "../components/PlanGate";
import { pushToShopify } from "../lib/pipeline/push.server";
import { createSmartCollections } from "../lib/pipeline/collections.server";
import type { PlanTier, CollectionStrategy } from "../lib/types";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Run ALL queries in parallel — including tenant lookup
  const [
    tenant,
    fitmentCountResult,
    pushedCountResult,
    latestPushJobResult,
    latestCollectionJobResult,
    collectionCountResult,
    appSettingsResult,
    pushHistoryResult,
  ] = await Promise.all([
    getTenant(shopId),
    db.from("vehicle_fitments")
      .select("product_id", { count: "exact", head: true })
      .eq("shop_id", shopId),
    db.from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .like("tags::text", "%_autosync_%"),
    db.from("sync_jobs")
      .select("*")
      .eq("shop_id", shopId)
      .eq("type", "push")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("sync_jobs")
      .select("*")
      .eq("shop_id", shopId)
      .eq("type", "collections")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("collection_mappings")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId),
    db.from("app_settings")
      .select("*")
      .eq("shop_id", shopId)
      .maybeSingle(),
    db.from("sync_jobs")
      .select("*")
      .eq("shop_id", shopId)
      .in("type", ["push", "collections"])
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const plan: PlanTier = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);

  return {
    plan,
    limits,
    allLimits: PLAN_LIMITS,
    productsWithFitments: fitmentCountResult.count ?? 0,
    pushedCount: pushedCountResult.count ?? 0,
    collectionCount: collectionCountResult.count ?? 0,
    latestPushJob: latestPushJobResult.data,
    latestCollectionJob: latestCollectionJobResult.data,
    appSettings: appSettingsResult.data,
    pushHistory: pushHistoryResult.data ?? [],
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const _action = formData.get("_action");

  if (_action !== "push") {
    return data({ error: "Unknown action" }, { status: 400 });
  }

  const pushTags = formData.get("pushTags") === "true";
  const pushMetafields = formData.get("pushMetafields") === "true";
  const createCollections = formData.get("createCollections") === "true";
  const strategy = (formData.get("strategy") as CollectionStrategy) || "make";
  const seoEnabled = formData.get("seoEnabled") === "true";

  // Gate features behind billing
  try {
    if (pushTags) await assertFeature(shopId, "pushTags");
    if (pushMetafields) await assertFeature(shopId, "pushMetafields");
    if (createCollections) await assertFeature(shopId, "smartCollections");
    if (seoEnabled) await assertFeature(shopId, "collectionSeoImages");
  } catch (err: any) {
    if (err.name === "BillingGateError") {
      return data(
        {
          error: err.message,
          feature: err.feature,
          currentPlan: err.currentPlan,
          requiredPlan: err.requiredPlan,
        },
        { status: 403 },
      );
    }
    throw err;
  }

  let pushResult = null;
  let collectionsResult = null;

  // Push tags and/or metafields
  if (pushTags || pushMetafields) {
    const { data: job, error: jobError } = await db
      .from("sync_jobs")
      .insert({
        shop_id: shopId,
        type: "push",
        status: "pending",
        progress: 0,
      })
      .select("id")
      .single();

    if (jobError || !job) {
      return data({ error: "Failed to create push job" }, { status: 500 });
    }

    try {
      pushResult = await pushToShopify(shopId, job.id, admin, {
        pushTags,
        pushMetafields,
      });
    } catch (err: any) {
      return data({ error: err.message ?? "Push failed" }, { status: 500 });
    }
  }

  // Create collections
  if (createCollections) {
    const { data: job, error: jobError } = await db
      .from("sync_jobs")
      .insert({
        shop_id: shopId,
        type: "collections",
        status: "pending",
        progress: 0,
      })
      .select("id")
      .single();

    if (jobError || !job) {
      return data({ error: "Failed to create collections job" }, { status: 500 });
    }

    try {
      collectionsResult = await createSmartCollections(shopId, admin, strategy, {
        seoEnabled,
      });

      // Update the job as completed
      await db
        .from("sync_jobs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    } catch (err: any) {
      await db
        .from("sync_jobs")
        .update({
          status: "failed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return data({ error: err.message ?? "Collections creation failed" }, { status: 500 });
    }
  }

  return data({
    success: true,
    pushResult,
    collectionsResult,
  });
};

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

const JOB_STATUS_BADGES: Record<string, { tone: "success" | "info" | "warning" | "critical" | "default"; label: string }> = {
  pending: { tone: "default", label: "Pending" },
  running: { tone: "info", label: "Running" },
  completed: { tone: "success", label: "Completed" },
  failed: { tone: "critical", label: "Failed" },
  cancelled: { tone: "warning", label: "Cancelled" },
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  const d = new Date(dateStr);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatJobType(type: string): string {
  switch (type) {
    case "push":
      return "Push";
    case "collections":
      return "Collections";
    default:
      return type;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Push() {
  const {
    plan,
    limits,
    allLimits,
    productsWithFitments,
    pushedCount,
    collectionCount,
    latestPushJob,
    latestCollectionJob,
    appSettings,
    pushHistory,
  } = useLoaderData<typeof loader>();

  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Form state
  const [pushTags, setPushTags] = useState(appSettings?.push_tags ?? true);
  const [pushMetafields, setPushMetafields] = useState(appSettings?.push_metafields ?? true);
  const [createCollectionsChecked, setCreateCollectionsChecked] = useState(false);
  const [strategy, setStrategy] = useState<string>(appSettings?.collection_strategy ?? "make");
  const [seoEnabled, setSeoEnabled] = useState(false);

  const nothingSelected = !pushTags && !pushMetafields && !createCollectionsChecked;
  const noProductsReady = productsWithFitments === 0;
  const pushDisabled = nothingSelected || noProductsReady || isSubmitting;

  const lastPushTime = latestPushJob?.completed_at ?? latestPushJob?.created_at;

  // Determine if a push just completed
  const showResults = actionData && "success" in actionData && actionData.success;
  const showError = actionData && "error" in actionData;

  const strategyOptions = [
    { label: "By Make", value: "make" },
    { label: "By Make & Model", value: "make_model" },
    { label: "By Make, Model & Year", value: "make_model_year" },
  ];

  return (
    <Page title="Push to Shopify">
      <Layout>
        {/* Error banner */}
        {showError && (
          <Layout.Section>
            <Banner tone="critical">
              <p>{(actionData as any).error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Success banner */}
        {showResults && (
          <Layout.Section>
            <Banner tone="success" title="Push completed successfully">
              <BlockStack gap="200">
                {(actionData as any).pushResult && (
                  <Text as="p" variant="bodyMd">
                    {(actionData as any).pushResult.tagsPushed} tags pushed,{" "}
                    {(actionData as any).pushResult.metafieldsPushed} metafields set,{" "}
                    {(actionData as any).pushResult.processed} products processed
                    {(actionData as any).pushResult.errors > 0 &&
                      ` (${(actionData as any).pushResult.errors} errors)`}
                  </Text>
                )}
                {(actionData as any).collectionsResult && (
                  <Text as="p" variant="bodyMd">
                    {(actionData as any).collectionsResult.created} collections created,{" "}
                    {(actionData as any).collectionsResult.updated} updated
                    {(actionData as any).collectionsResult.errors > 0 &&
                      ` (${(actionData as any).collectionsResult.errors} errors)`}
                  </Text>
                )}
              </BlockStack>
            </Banner>
          </Layout.Section>
        )}

        {/* Summary card */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Summary
              </Text>
              <InlineStack gap="800" wrap>
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {productsWithFitments}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Products ready to push
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {pushedCount}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Products already pushed
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="headingLg" fontWeight="bold">
                    {collectionCount}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Collections created
                  </Text>
                </BlockStack>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd">
                    {formatDate(lastPushTime)}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Last push
                  </Text>
                </BlockStack>
              </InlineStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Push Options card */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Push Options
              </Text>

              {/* Push Tags */}
              <PlanGate
                feature="pushTags"
                currentPlan={plan}
                limits={limits}
                allLimits={allLimits}
              >
                <Checkbox
                  label="Push Tags"
                  helpText="Adds _autosync_ prefixed tags to products for smart collection rules"
                  checked={pushTags}
                  onChange={setPushTags}
                />
              </PlanGate>

              {/* Push Metafields */}
              <PlanGate
                feature="pushMetafields"
                currentPlan={plan}
                limits={limits}
                allLimits={allLimits}
              >
                <Checkbox
                  label="Push Metafields"
                  helpText="Sets app-owned metafields with vehicle fitment data for storefront display"
                  checked={pushMetafields}
                  onChange={setPushMetafields}
                />
              </PlanGate>

              <Divider />

              {/* Create Collections */}
              <PlanGate
                feature="smartCollections"
                currentPlan={plan}
                limits={limits}
                allLimits={allLimits}
              >
                <Checkbox
                  label="Create Collections"
                  helpText="Creates smart collections based on vehicle makes and models"
                  checked={createCollectionsChecked}
                  onChange={setCreateCollectionsChecked}
                />
              </PlanGate>

              {/* Collection strategy (shown when collections is checked) */}
              {createCollectionsChecked && (
                <Box paddingInlineStart="800">
                  <BlockStack gap="300">
                    <Select
                      label="Collection strategy"
                      options={strategyOptions}
                      value={strategy}
                      onChange={setStrategy}
                    />

                    {/* Include SEO */}
                    <PlanGate
                      feature="collectionSeoImages"
                      currentPlan={plan}
                      limits={limits}
                      allLimits={allLimits}
                    >
                      <Checkbox
                        label="Include SEO"
                        helpText="Adds SEO title and description to created collections"
                        checked={seoEnabled}
                        onChange={setSeoEnabled}
                      />
                    </PlanGate>
                  </BlockStack>
                </Box>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Push button */}
        <Layout.Section>
          <Form method="post">
            <input type="hidden" name="_action" value="push" />
            <input type="hidden" name="pushTags" value={String(pushTags)} />
            <input type="hidden" name="pushMetafields" value={String(pushMetafields)} />
            <input type="hidden" name="createCollections" value={String(createCollectionsChecked)} />
            <input type="hidden" name="strategy" value={strategy} />
            <input type="hidden" name="seoEnabled" value={String(seoEnabled)} />

            <InlineStack align="start" gap="300">
              <Button
                variant="primary"
                submit
                disabled={pushDisabled}
                loading={isSubmitting}
              >
                Push to Shopify
              </Button>
              {noProductsReady && (
                <Text as="p" variant="bodySm" tone="subdued">
                  No products with fitments to push. Map fitments first.
                </Text>
              )}
            </InlineStack>
          </Form>
        </Layout.Section>

        {/* Progress section (during push) */}
        {isSubmitting && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" align="start" blockAlign="center">
                  <Spinner size="small" />
                  <Text as="p" variant="bodyMd">
                    {createCollectionsChecked
                      ? "Pushing data and creating collections..."
                      : "Pushing tags and metafields to Shopify..."}
                  </Text>
                </InlineStack>
                <ProgressBar progress={50} size="small" />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* Push History card */}
        {pushHistory.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Push History
                </Text>
                <IndexTable
                  resourceName={{ singular: "job", plural: "jobs" }}
                  itemCount={pushHistory.length}
                  headings={[
                    { title: "Date" },
                    { title: "Type" },
                    { title: "Items" },
                    { title: "Status" },
                  ]}
                  selectable={false}
                >
                  {pushHistory.map((job: any, index: number) => {
                    const statusBadge = JOB_STATUS_BADGES[job.status] ?? {
                      tone: "default" as const,
                      label: job.status,
                    };
                    return (
                      <IndexTable.Row
                        id={job.id}
                        key={job.id}
                        position={index}
                      >
                        <IndexTable.Cell>
                          <Text as="span" variant="bodyMd">
                            {formatDate(job.created_at)}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodyMd">
                            {formatJobType(job.type)}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text as="span" variant="bodyMd">
                            {job.total_items ?? job.progress ?? "—"}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Badge tone={statusBadge.tone}>
                            {statusBadge.label}
                          </Badge>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
