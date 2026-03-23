import { useState, useCallback, useEffect, useRef } from "react";
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
  Checkbox,
  Select,
  Button,
  ProgressBar,
  Spinner,
  Banner,
  Box,
  Divider,
  IndexTable,
  InlineGrid,
} from "@shopify/polaris";
import {
  ExportIcon,
  SettingsIcon,
  CollectionIcon,
  ChartVerticalIcon,
  ProductIcon,
  CheckIcon,
  ClockIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getPlanLimits, getTenant, assertFeature, PLAN_LIMITS } from "../lib/billing.server";
import { PlanGate } from "../components/PlanGate";
import { IconBadge } from "../components/IconBadge";
import { pushToShopify } from "../lib/pipeline/push.server";
import { createSmartCollections } from "../lib/pipeline/collections.server";
import { ensureMetafieldDefinitions } from "../lib/pipeline/metafield-definitions.server";
import { OperationProgress } from "../components/OperationProgress";
import { HowItWorks } from "../components/HowItWorks";
import { SkeletonCard } from "../components/SkeletonCard";
import { formatJobType, statMiniStyle, statGridStyle, STATUS_TONES } from "../lib/design";
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
      .not("synced_at", "is", null),
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

  // Save push settings so they persist between visits
  await db.from("app_settings").upsert(
    {
      shop_id: shopId,
      push_tags: pushTags,
      push_metafields: pushMetafields,
      push_collections: createCollections,
      collection_strategy: strategy,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "shop_id" },
  );

  // Gate features behind billing
  try {
    if (pushTags) await assertFeature(shopId, "pushTags");
    if (pushMetafields) await assertFeature(shopId, "pushMetafields");
    if (createCollections) await assertFeature(shopId, "smartCollections");
    if (seoEnabled) await assertFeature(shopId, "collectionSeoImages");
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "BillingGateError") {
      const billingErr = err as Error & { feature?: string; currentPlan?: string; requiredPlan?: string };
      return data(
        {
          error: billingErr.message,
          feature: billingErr.feature,
          currentPlan: billingErr.currentPlan,
          requiredPlan: billingErr.requiredPlan,
        },
        { status: 403 },
      );
    }
    throw err;
  }

  // ── Ensure metafield definitions exist (once per tenant) ──
  try {
    await ensureMetafieldDefinitions(shopId, admin);
  } catch (err) {
    console.error("[push] Metafield definitions error:", err instanceof Error ? err.message : err);
    // Non-fatal — continue with push even if definitions fail
  }

  // ── Job-based approach: create jobs and return instantly ──
  // The Supabase Edge Function (pg_cron every 30s) picks up and processes them.
  // No more Vercel timeouts!

  const autoActivateMakes = formData.get("autoActivateMakes") === "true";

  // Count mapped products for total_items
  const { count: mappedCount } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .not("fitment_status", "eq", "unmapped");

  // Create push job — Edge Function will process it
  if (pushTags || pushMetafields) {
    const { error: jobError } = await db
      .from("sync_jobs")
      .insert({
        shop_id: shopId,
        type: "push",
        status: "running",
        progress: 0,
        total_items: mappedCount ?? 0,
        processed_items: 0,
        started_at: new Date().toISOString(),
        metadata: JSON.stringify({
          pushTags,
          pushMetafields,
          autoActivateMakes,
        }),
      });

    if (jobError) {
      return data({ error: "Failed to create push job" }, { status: 500 });
    }
  }

  // Create collections job — Edge Function will process it
  if (createCollections) {
    const { error: jobError } = await db
      .from("sync_jobs")
      .insert({
        shop_id: shopId,
        type: "collections",
        status: "running",
        progress: 0,
        total_items: 0,
        processed_items: 0,
        started_at: new Date().toISOString(),
        metadata: JSON.stringify({
          strategy,
          seoEnabled,
        }),
      });

    if (jobError) {
      return data({ error: "Failed to create collections job" }, { status: 500 });
    }
  }

  // Return immediately — Edge Function does the work
  return data({
    success: true,
    jobCreated: true,
  });
};

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

const JOB_STATUS_BADGES: Record<string, { tone: "success" | "info" | "warning" | "critical" | undefined; label: string }> = {
  pending: { tone: undefined, label: "Pending" },
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

// formatJobType imported from ../lib/design


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
  const pageLoading = navigation.state === "loading";

  // Form state — initialize ALL settings from saved app_settings
  const [pushTags, setPushTags] = useState(appSettings?.push_tags ?? true);
  const [pushMetafields, setPushMetafields] = useState(appSettings?.push_metafields ?? true);
  const [createCollectionsChecked, setCreateCollectionsChecked] = useState(
    appSettings?.push_collections ?? appSettings?.auto_create_collections ?? false,
  );
  const [strategy, setStrategy] = useState<string>(appSettings?.collection_strategy ?? "make");
  const [seoEnabled, setSeoEnabled] = useState(appSettings?.push_collections ?? false);
  const [autoActivateMakes, setAutoActivateMakes] = useState(true);

  const nothingSelected = !pushTags && !pushMetafields && !createCollectionsChecked;
  const noProductsReady = productsWithFitments === 0;
  const pushDisabled = nothingSelected || noProductsReady || isSubmitting;

  const lastPushTime = latestPushJob?.completed_at ?? latestPushJob?.created_at;

  // Determine if a push just completed
  const showResults = actionData && "success" in actionData && actionData.success;
  const showError = actionData && "error" in actionData;

  // Poll for job progress + live stats (Edge Function processes in background)
  const [activeJob, setActiveJob] = useState<{
    type: string; status: string; processed_items: number; total_items: number; started_at: string | null;
  } | null>(null);
  const [liveStats, setLiveStats] = useState<{
    total: number; unmapped: number; autoMapped: number; smartMapped: number;
    manualMapped: number; fitments: number; collections: number;
  } | null>(null);
  const [completedPush, setCompletedPush] = useState<{
    processed_items: number; total_items: number; status: string;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollJobStatus = useCallback(async () => {
    try {
      const res = await fetch("/app/api/job-status?type=all");
      if (res.ok) {
        const result = await res.json();
        const allJobs = result.jobs || [];
        // Find running push or collections jobs
        const pushRunning = allJobs.find((j: any) => j.type === "push" && j.status === "running");
        const collectionsRunning = allJobs.find((j: any) => j.type === "collections" && j.status === "running");
        // Also find recently completed push job (within last 5 minutes)
        const pushCompleted = allJobs.find((j: any) => j.type === "push" && j.status === "completed");

        // Show running job first, then recently completed
        setActiveJob(pushRunning || collectionsRunning || null);

        // Track completed push separately for stats display
        if (pushCompleted) {
          setCompletedPush(pushCompleted);
        }

        if (result.stats) setLiveStats(result.stats);
      }
    } catch { /* non-fatal */ }
  }, []);

  // Start polling on mount and when action succeeds
  useEffect(() => {
    pollJobStatus(); // Initial check
    pollRef.current = setInterval(pollJobStatus, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [pollJobStatus]);

  // Also poll when action returns (job was just created)
  useEffect(() => {
    if (actionData && "jobCreated" in actionData) {
      pollJobStatus();
    }
  }, [actionData, pollJobStatus]);

  const isJobRunning = !!activeJob;

  const strategyOptions = [
    { label: "By Make", value: "make" },
    { label: "By Make & Model", value: "make_model" },
    { label: "By Make, Model & Year", value: "make_model_year" },
  ];

  return (
    <Page fullWidth title="Push to Shopify">
      <Layout>
        {/* How It Works */}
        <Layout.Section>
          <HowItWorks
            steps={[
              { number: 1, title: "Map Fitments", description: "Use auto-extraction or manual mapping to assign vehicle compatibility to your products. Each mapped product gets make, model, year, and engine data.", linkText: "Go to Fitment", linkUrl: "/app/fitment" },
              { number: 2, title: "Push Tags & Metafields", description: "Send vehicle fitment data to Shopify as app-prefixed tags and metafields. Tags power smart collections, metafields display on your storefront." },
              { number: 3, title: "Create Collections", description: "Auto-generate smart collections by make, model, and year. Each collection gets a logo, SEO description, and is published to your Online Store." },
              { number: 4, title: "Go Live", description: "Makes with products are automatically activated in the YMME widget. Customers can immediately search and filter parts by their vehicle." },
            ]}
          />
        </Layout.Section>

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

        {/* Summary stats — comprehensive push dashboard */}
        <Layout.Section>
          {pageLoading ? <SkeletonCard variant="stat" count={6} cols={3} /> : (
          <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
            {/* Products Status */}
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={ProductIcon} color="var(--p-color-icon-emphasis)" />
                  <Text as="h2" variant="headingSm">Products</Text>
                </InlineStack>
                <div style={statGridStyle(2)}>
                  <div style={statMiniStyle}>
                    <Text as="p" variant="headingMd" fontWeight="bold">{String(liveStats ? (liveStats.autoMapped + liveStats.smartMapped + liveStats.manualMapped) : productsWithFitments)}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">With Fitments</Text>
                  </div>
                  <div style={statMiniStyle}>
                    <Text as="p" variant="headingMd" fontWeight="bold">{String(liveStats?.pushedProducts ?? pushedCount)}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Pushed</Text>
                  </div>
                </div>
              </BlockStack>
            </Card>

            {/* Shopify Status */}
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={CollectionIcon} color="var(--p-color-icon-emphasis)" />
                  <Text as="h2" variant="headingSm">Shopify</Text>
                </InlineStack>
                <div style={statGridStyle(2)}>
                  <div style={statMiniStyle}>
                    <Text as="p" variant="headingMd" fontWeight="bold">{String(liveStats?.collections ?? collectionCount)}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Collections</Text>
                  </div>
                  <div style={statMiniStyle}>
                    <Text as="p" variant="headingMd" fontWeight="bold">{String(liveStats?.activeMakes ?? 0)}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Active Makes</Text>
                  </div>
                </div>
              </BlockStack>
            </Card>

            {/* Timing */}
            <Card>
              <BlockStack gap="300">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={ClockIcon} color="var(--p-color-icon-emphasis)" />
                  <Text as="h2" variant="headingSm">History</Text>
                </InlineStack>
                <div style={statGridStyle(1)}>
                  <div style={statMiniStyle}>
                    <Text as="p" variant="headingMd" fontWeight="bold">{formatDate(lastPushTime)}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Last Push</Text>
                  </div>
                </div>
              </BlockStack>
            </Card>
          </InlineGrid>
          )}
        </Layout.Section>

        {/* Push Options card */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={SettingsIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingMd">Push Options</Text>
              </InlineStack>

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

              <Divider />

              <Form method="post">
                <input type="hidden" name="_action" value="push" />
                <input type="hidden" name="pushTags" value={String(pushTags)} />
                <input type="hidden" name="pushMetafields" value={String(pushMetafields)} />
                <input type="hidden" name="createCollections" value={String(createCollectionsChecked)} />
                <input type="hidden" name="strategy" value={strategy} />
                <input type="hidden" name="seoEnabled" value={String(seoEnabled)} />

                <BlockStack gap="300">
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
                  <Text as="p" variant="bodySm" tone="subdued">
                    All processing happens in the background via our Edge Function. You can close this page — the push will continue automatically.
                  </Text>
                </BlockStack>
              </Form>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Progress section (during push) */}
        {(isSubmitting || isJobRunning) && (
          <Layout.Section>
            <OperationProgress
              label={activeJob?.type === "collections" ? "Creating collections" : "Pushing tags and metafields to Shopify"}
              status={isSubmitting ? "running" : (activeJob?.status === "running" ? "running" : "idle")}
              processed={activeJob?.processed_items ?? 0}
              total={activeJob?.total_items ?? productsWithFitments}
              startedAt={activeJob?.started_at}
              badges={{
                "pushed": { count: activeJob?.processed_items ?? 0, tone: "success" },
              }}
            />
          </Layout.Section>
        )}

        {/* Push History card */}
        {pushHistory.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={ChartVerticalIcon} color="var(--p-color-icon-emphasis)" />
                  <Text as="h2" variant="headingMd">Push History</Text>
                </InlineStack>
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
                      tone: undefined as undefined,
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
