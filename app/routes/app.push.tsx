import { useState, useEffect, useCallback, useRef } from "react";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useLoaderData, useActionData, useNavigation, useNavigate, Form, useFetcher } from "react-router";
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
  Button,
  Banner,
  Box,
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
import db, { triggerEdgeFunction } from "../lib/db.server";
import { getPlanLimits, getTenant, assertFeature, getSerializedPlanLimits, getEffectivePlan } from "../lib/billing.server";
import { PlanGate } from "../components/PlanGate";
import { IconBadge } from "../components/IconBadge";
import { ensureMetafieldDefinitions } from "../lib/pipeline/metafield-definitions.server";
import { OperationProgress } from "../components/OperationProgress";
import { getJobProgressLabel, getJobCompletionMessage, isBannerDismissed, dismissBanner, formatJobType, formatDate, statMiniStyle, statGridStyle, equalHeightGridStyle, STATUS_TONES } from "../lib/design";
import { HowItWorks } from "../components/HowItWorks";
import { useAppData } from "../lib/use-app-data";
import type { PlanTier, CollectionStrategy } from "../lib/types";
import { RouteError } from "../components/RouteError";

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
    activeMakesCountResult,
  ] = await Promise.all([
    getTenant(shopId),
    // Count distinct products that have fitments (ready to push)
    db.from("vehicle_fitments")
      .select("product_id")
      .eq("shop_id", shopId),
    db.from("products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .neq("status", "staged")
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
      .in("type", ["push", "bulk_push", "collections", "vehicle_pages", "cleanup", "cleanup_tags", "cleanup_metafields", "cleanup_collections"])
      .order("created_at", { ascending: false })
      .limit(10),
    // Active makes count — seeds the stat bar so it renders correctly before polling
    db.from("tenant_active_makes")
      .select("ymme_make_id", { count: "exact", head: true })
      .eq("shop_id", shopId),
  ]);

  const plan: PlanTier = getEffectivePlan(tenant);
  const limits = getPlanLimits(plan);

  return {
    plan,
    limits,
    allLimits: getSerializedPlanLimits(),
    productsWithFitments: new Set((fitmentCountResult.data ?? []).map((r: any) => r.product_id)).size,
    pushedCount: pushedCountResult.count ?? 0,
    collectionCount: collectionCountResult.count ?? 0,
    activeMakesCount: activeMakesCountResult.count ?? 0,
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

  // Auto-save settings on checkbox change (no push needed)
  if (_action === "save_settings") {
    await db.from("app_settings").upsert({
      shop_id: shopId,
      push_tags: formData.get("pushTags") === "true",
      push_metafields: formData.get("pushMetafields") === "true",
      push_collections: formData.get("createCollections") === "true",
      push_vehicle_pages: formData.get("pushVehiclePages") === "true",
      push_images: formData.get("pushImages") === "true",
      updated_at: new Date().toISOString(),
    }, { onConflict: "shop_id" });
    return data({ saved: true });
  }

  if (_action !== "push") {
    return data({ error: "Unknown action" }, { status: 400 });
  }

  const pushTags = formData.get("pushTags") === "true";
  const pushMetafields = formData.get("pushMetafields") === "true";
  const createCollections = formData.get("createCollections") === "true";
  const strategy = (formData.get("strategy") as CollectionStrategy) || "make";
  const seoEnabled = formData.get("seoEnabled") === "true";
  const pushVehiclePages = formData.get("pushVehiclePages") === "true";
  const pushImages = formData.get("pushImages") === "true";
  const forceRepush = formData.get("forceRepush") === "true";

  // Save push settings so they persist between visits
  await db.from("app_settings").upsert(
    {
      shop_id: shopId,
      push_tags: pushTags,
      push_metafields: pushMetafields,
      push_collections: createCollections,
      collection_strategy: strategy,
      seo_enabled: seoEnabled,
      push_vehicle_pages: pushVehiclePages,
      push_images: pushImages,
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

  // Count ALL mapped products (vehicle parts + wheels) — unified push handles everything
  const { count: mappedCount } = await db
    .from("products")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId)
    .neq("status", "staged")
    .in("fitment_status", ["smart_mapped", "auto_mapped", "manual_mapped"]);

  // Helper to fire Edge Function (fire-and-forget)
  const fireEdgeFunction = (jobId: string) => triggerEdgeFunction(jobId, shopId);

  // Create push job + fire Edge Function immediately
  if (pushTags || pushMetafields) {
    const { data: pushJob, error: jobError } = await db
      .from("sync_jobs")
      .insert({
        shop_id: shopId,
        type: "push",
        status: "pending",
        progress: 0,
        total_items: mappedCount ?? 0,
        processed_items: 0,
        started_at: new Date().toISOString(),
        metadata: JSON.stringify({
          pushTags,
          pushMetafields,
          autoActivateMakes,
          pushImages,
          forceRepush,
        }),
      })
      .select("id")
      .single();

    if (jobError) {
      return data({ error: "Failed to create push job" }, { status: 500 });
    }
    if (pushJob) fireEdgeFunction(pushJob.id);
  }

  // Create collections job + fire Edge Function immediately
  if (createCollections) {
    // Duplicate prevention — don't create if one already running
    const { data: existingColJob } = await db
      .from("sync_jobs")
      .select("id")
      .eq("shop_id", shopId)
      .eq("type", "collections")
      .in("status", ["pending", "running"])
      .maybeSingle();
    if (existingColJob) {
      // Skip silently — collections job already in progress
    } else {
    // Let the Edge Function calculate the exact total on first invocation.
    // Previous behaviour: `existing + 50` — a bogus heuristic that caused the
    // job to declare "done" after only 200 collections, so year-level
    // collections (which run last) never got created. Setting total_items=0
    // triggers the real recalculation in processCollectionsChunk.
    const { data: colJob, error: jobError } = await db
      .from("sync_jobs")
      .insert({
        shop_id: shopId,
        type: "collections",
        status: "pending",
        progress: 0,
        total_items: 0,
        processed_items: 0,
        started_at: new Date().toISOString(),
        metadata: JSON.stringify({
          strategy,
          seoEnabled,
        }),
      })
      .select("id")
      .single();

    if (jobError) {
      return data({ error: "Failed to create collections job" }, { status: 500 });
    }
    if (colJob) fireEdgeFunction(colJob.id);
    } // close else (duplicate prevention)
  }

  // Create vehicle_pages job if enabled
  if (pushVehiclePages) {
    const { data: existingVpJob } = await db.from("sync_jobs")
      .select("id").eq("shop_id", shopId).eq("type", "vehicle_pages")
      .in("status", ["pending", "running"]).maybeSingle();
    if (!existingVpJob) {
      // Count vehicle specs for this shop's active makes
      const { data: activeMakeRows } = await db.from("tenant_active_makes")
        .select("ymme_make_id").eq("shop_id", shopId);
      let vpTotal = 0;
      if (activeMakeRows && activeMakeRows.length > 0) {
        const makeIds = activeMakeRows.map((m: { ymme_make_id: string }) => m.ymme_make_id);
        const { data: modelRows } = await db.from("ymme_models")
          .select("id").in("make_id", makeIds);
        if (modelRows && modelRows.length > 0) {
          const modelIds = modelRows.map((m: { id: string }) => m.id);
          const { count } = await db.from("ymme_engines")
            .select("id", { count: "exact", head: true })
            .in("model_id", modelIds);
          vpTotal = count ?? 0;
        }
      }
      const { data: vpJob } = await db.from("sync_jobs").insert({
        shop_id: shopId, type: "vehicle_pages", status: "pending",
        total_items: vpTotal, processed_items: 0,
        started_at: new Date().toISOString(), metadata: "{}",
      }).select("id").single();
      if (vpJob) fireEdgeFunction(vpJob.id);
    }
  }

  // Return immediately — Edge Function processes in background
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
    activeMakesCount,
    latestPushJob,
    latestCollectionJob,
    appSettings,
    pushHistory,
  } = useLoaderData<typeof loader>();

  const navigate = useNavigate();
  const rawActionData = useActionData<typeof action>();
  const actionData = rawActionData as { error?: string; message?: string; success?: boolean } | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Form state — initialize ALL settings from saved app_settings
  // Premium features: only restore saved state if the plan supports the feature.
  // If the plan doesn't include a feature, force it OFF — user can't toggle it.
  const [pushTags, setPushTags] = useState(
    limits.features.pushTags ? (appSettings?.push_tags ?? false) : false,
  );
  const [pushMetafields, setPushMetafields] = useState(
    limits.features.pushMetafields ? (appSettings?.push_metafields ?? false) : false,
  );
  const [createCollectionsChecked, setCreateCollectionsChecked] = useState(
    limits.features.smartCollections
      ? (appSettings?.push_collections ?? appSettings?.auto_create_collections ?? false)
      : false,
  );
  // Strategy + SEO are READ-ONLY here — managed on Collections page
  const strategy = appSettings?.collection_strategy ?? "make";
  const seoEnabled = appSettings?.seo_enabled ?? false;
  const [autoActivateMakes, setAutoActivateMakes] = useState(true);
  const [pushVehiclePages, setPushVehiclePages] = useState(
    limits.features.vehiclePages ? (appSettings?.push_vehicle_pages ?? false) : false,
  );
  const [pushImages, setPushImages] = useState(appSettings?.push_images ?? false);
  const [forceRepush, setForceRepush] = useState(false);

  const nothingSelected = !pushTags && !pushMetafields && !createCollectionsChecked && !pushVehiclePages;
  const noProductsReady = productsWithFitments === 0;
  const pushDisabled = nothingSelected || noProductsReady || isSubmitting;

  const lastPushTime = latestPushJob?.completed_at ?? latestPushJob?.created_at;

  // Don't show "completed" banner when job was just created — the progress bar shows status
  const isJobCreated = actionData && "jobCreated" in actionData;
  const showError = actionData && "error" in actionData;

  // Unified data — ALL live stats from one source (useAppData).
  // Seed every field the UI reads with the real loader value so nothing flashes.
  const { stats: liveStats, activeJobs, jobs: allJobs } = useAppData({
    mapped: productsWithFitments,
    pushedProducts: pushedCount,
    collections: collectionCount,
    activeMakes: activeMakesCount,
  }, 3000);
  const activeJob = activeJobs.find((j) => j.type === "push" || j.type === "bulk_push" || j.type === "collections") ?? null;
  const completedPush = allJobs.find((j) => j.type === "push" && j.status === "completed") ?? null;

  // Push History — unified live view.
  // Seed with the loader's 10 rows so the table renders instantly, then overlay
  // the live feed from useAppData.jobs (polled every 3s via job-status). Same
  // pattern every other page uses for "real-time everywhere" — no separate
  // fetcher, no extra endpoint, just the single job-status polling channel.
  const PUSH_HISTORY_TYPES = new Set([
    "push", "bulk_push", "collections",
    "vehicle_pages", "delete_vehicle_pages",
    "cleanup", "cleanup_tags", "cleanup_metafields", "cleanup_collections",
  ]);
  const livePushHistory = (() => {
    const byId = new Map<string, typeof pushHistory[number]>();
    // Loader rows first (initial paint)
    for (const j of pushHistory) byId.set(j.id, j);
    // Overlay / upsert with live rows (includes status / processed_items changes)
    for (const j of allJobs) {
      if (PUSH_HISTORY_TYPES.has(j.type)) byId.set(j.id, j as typeof pushHistory[number]);
    }
    return [...byId.values()].sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at)),
    );
  })();
  // Use job-specific key so dismissing one push doesn't suppress future ones
  const completedPushKey = completedPush ? `push_complete_${completedPush.id}` : "push_complete";
  const [dismissedCompletionBanner, setDismissedCompletionBanner] = useState(() => isBannerDismissed(completedPushKey));

  const isJobRunning = !!activeJob;

  // ── Auto-save settings when any checkbox changes ──
  const settingsFetcher = useFetcher();
  const isFirstRender = useRef(true);

  const saveSettings = useCallback(() => {
    if (isFirstRender.current) return; // Skip initial mount — don't overwrite DB with defaults
    const formData = new FormData();
    formData.set("_action", "save_settings");
    formData.set("pushTags", String(pushTags));
    formData.set("pushMetafields", String(pushMetafields));
    formData.set("createCollections", String(createCollectionsChecked));
    formData.set("pushVehiclePages", String(pushVehiclePages));
    formData.set("pushImages", String(pushImages));
    settingsFetcher.submit(formData, { method: "POST" });
  }, [pushTags, pushMetafields, createCollectionsChecked, pushVehiclePages, pushImages]);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    saveSettings();
  }, [pushTags, pushMetafields, createCollectionsChecked, pushVehiclePages, pushImages]);

  return (
    <Page fullWidth title="Push to Shopify">
      <BlockStack gap="600">
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

        {/* Progress section — RIGHT below HowItWorks for visibility */}
        {(isSubmitting || isJobRunning) && (
          <Layout.Section>
            <OperationProgress
              label={getJobProgressLabel({ type: activeJob?.type ?? "push", status: activeJob?.status ?? "running", processed: activeJob?.processed_items ?? 0, total: activeJob?.total_items ?? 0, metadata: activeJob?.metadata })}
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

        {/* Show completion when job just finished */}
        {completedPush && !isJobRunning && !isSubmitting && !dismissedCompletionBanner && (
          <Layout.Section>
            <Banner tone="success" title="Push completed" onDismiss={() => { dismissBanner(completedPushKey); setDismissedCompletionBanner(true); }}>
              <p>{getJobCompletionMessage({ type: "push", status: "completed", processed: completedPush.processed_items, total: completedPush.total_items })}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Error banner */}
        {showError && (
          <Layout.Section>
            <Banner tone="critical">
              <p>{actionData?.error}</p>
            </Banner>
          </Layout.Section>
        )}

        {/* Summary stats — comprehensive push dashboard */}
        <Layout.Section>
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
                    <Text as="p" variant="headingMd" fontWeight="bold">{String(liveStats?.mapped ?? productsWithFitments)}</Text>
                    <Text as="p" variant="bodySm" tone="subdued">Ready to Push</Text>
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
        </Layout.Section>

        {/* Push Options — compact horizontal layout */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={SettingsIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingMd">Push Options</Text>
              </InlineStack>

              {/* 3-column grid: Tags | Metafields | Collections */}
              <div style={equalHeightGridStyle(3)}>
                <Box background="bg-surface-secondary" borderRadius="200" padding="300" minHeight="100%">
                  <Checkbox
                    label="Push Tags"
                    helpText={limits.features.pushTags ? "Adds tags for collection rules" : "Starter plan required"}
                    checked={pushTags}
                    onChange={setPushTags}
                    disabled={!limits.features.pushTags}
                  />
                </Box>
                <Box background="bg-surface-secondary" borderRadius="200" padding="300" minHeight="100%">
                  <Checkbox
                    label="Push Metafields"
                    helpText={limits.features.pushMetafields ? "Sets fitment data for storefront" : "Starter plan required"}
                    checked={pushMetafields}
                    onChange={setPushMetafields}
                    disabled={!limits.features.pushMetafields}
                  />
                </Box>
                <Box background="bg-surface-secondary" borderRadius="200" padding="300" minHeight="100%">
                  <Checkbox
                    label="Create Collections"
                    helpText="Smart collections by make/model"
                    checked={createCollectionsChecked}
                    onChange={setCreateCollectionsChecked}
                    disabled={!limits.features.smartCollections}
                  />
                </Box>
              </div>

              {/* Collection settings note — links to Collections page (single source of truth) */}
              {createCollectionsChecked && limits.features.smartCollections && (
                <Box background="bg-surface-secondary" borderRadius="200" padding="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="span" variant="bodySm" tone="subdued">
                      Collection strategy and SEO settings are managed on the Collections page.
                    </Text>
                    <Button variant="plain" size="slim" onClick={() => navigate("/app/collections")}>
                      Manage collections
                    </Button>
                  </InlineStack>
                </Box>
              )}

              {/* Row 2: Vehicle Pages + Images + Force Re-push */}
              <div style={equalHeightGridStyle(3)}>
                <Box background="bg-surface-secondary" borderRadius="200" padding="300" minHeight="100%">
                  <Checkbox
                    label="Vehicle Pages"
                    helpText={limits.features.vehiclePages ? "Create vehicle spec pages" : "Professional plan required"}
                    checked={pushVehiclePages}
                    onChange={setPushVehiclePages}
                    disabled={!limits.features.vehiclePages}
                  />
                </Box>
                <Box background="bg-surface-secondary" borderRadius="200" padding="300" minHeight="100%">
                  <Checkbox
                    label="Push Images"
                    helpText="Push product images to Shopify"
                    checked={pushImages}
                    onChange={setPushImages}
                  />
                </Box>
                <Box background="bg-surface-secondary" borderRadius="200" padding="300" minHeight="100%">
                  <Checkbox
                    label="Force Re-push All"
                    helpText="Push ALL products, even unchanged"
                    checked={forceRepush}
                    onChange={setForceRepush}
                  />
                </Box>
              </div>

              {/* Push button */}
              {limits.features.pushTags || limits.features.pushMetafields ? (
                <Form method="post">
                  <input type="hidden" name="_action" value="push" />
                  <input type="hidden" name="pushTags" value={String(pushTags)} />
                  <input type="hidden" name="pushMetafields" value={String(pushMetafields)} />
                  <input type="hidden" name="createCollections" value={String(createCollectionsChecked)} />
                  <input type="hidden" name="strategy" value={strategy} />
                  <input type="hidden" name="seoEnabled" value={String(seoEnabled)} />
                  <input type="hidden" name="autoActivateMakes" value={autoActivateMakes ? "true" : "false"} />
                  <input type="hidden" name="pushVehiclePages" value={String(pushVehiclePages)} />
                  <input type="hidden" name="pushImages" value={String(pushImages)} />
                  <input type="hidden" name="forceRepush" value={String(forceRepush)} />

                  <InlineStack align="start" gap="300" blockAlign="center">
                    <Button
                      variant="primary"
                      submit
                      disabled={pushDisabled}
                      loading={isSubmitting}
                    >
                      Push to Shopify
                    </Button>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {noProductsReady
                        ? "No products with fitments to push. Map fitments first."
                        : "Processing happens in the background. You can close this page."}
                    </Text>
                  </InlineStack>
                </Form>
              ) : (
                <PlanGate
                  feature="pushTags"
                  currentPlan={plan}
                  limits={limits}
                  allLimits={allLimits}
                >
                  <div />
                </PlanGate>
              )}

              {/* Smart Push Summary */}
              <Box background="bg-surface-secondary" borderRadius="200" padding="300">
                <InlineStack gap="400" wrap>
                  <Text as="span" variant="bodySm">
                    {`${liveStats?.mapped ?? productsWithFitments} products ready`}
                    {(liveStats?.stalePush ?? 0) > 0 && ` (${liveStats.stalePush} changed)`}
                  </Text>
                  {createCollectionsChecked && <Text as="span" variant="bodySm">{`${liveStats?.collections ?? 0} collections`}</Text>}
                  {pushVehiclePages && <Text as="span" variant="bodySm">Vehicle pages enabled</Text>}
                  {pushImages && <Text as="span" variant="bodySm">Images enabled</Text>}
                  {forceRepush && <Badge tone="attention" size="small">Force re-push all</Badge>}
                </InlineStack>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Push History card — live-updating via useAppData.jobs */}
        {livePushHistory.length > 0 && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={ChartVerticalIcon} color="var(--p-color-icon-emphasis)" />
                  <Text as="h2" variant="headingMd">Push History</Text>
                </InlineStack>
                <IndexTable
                  resourceName={{ singular: "job", plural: "jobs" }}
                  itemCount={livePushHistory.length}
                  headings={[
                    { title: "Date" },
                    { title: "Type" },
                    { title: "Items" },
                    { title: "Status" },
                  ]}
                  selectable={false}
                >
                  {livePushHistory.map((job: any, index: number) => {
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
      </BlockStack>
    </Page>
  );
}


export function ErrorBoundary() {
  return <RouteError pageName="Push to Shopify" />;
}
