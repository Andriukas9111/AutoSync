import { useState, useEffect, useRef } from "react";
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
  Checkbox,
  Select,
  Button,
  Banner,
  Divider,
  TextField,
  FormLayout,
  Modal,
  Badge,
  ProgressBar,
  List,
  Icon,
  InlineGrid,
  Box,
} from "@shopify/polaris";
import {
  ExportIcon,
  DatabaseIcon,
  AlertDiamondIcon,
  SearchIcon,
  LockIcon,
  CheckSmallIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db, { triggerEdgeFunction, syncAfterDelete } from "../lib/db.server";
import { getTenant, getPlanLimits, getEffectivePlan, getSerializedPlanLimits } from "../lib/billing.server";
import { PlanGate } from "../components/PlanGate";
import { IconBadge } from "../components/IconBadge";
import { HowItWorks } from "../components/HowItWorks";
import { useAppData } from "../lib/use-app-data";
import { statMiniStyle, statGridStyle, STATUS_TONES } from "../lib/design";
import {
  removeAllTags,
  removeAllMetafields,
  removeAllCollections,
} from "../lib/pipeline/cleanup.server";
import { deleteVehiclePages } from "../lib/pipeline/vehicle-pages.server";
import type { PlanTier } from "../lib/types";
import { RouteError } from "../components/RouteError";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shopId = session.shop;

  // Run queries in parallel
  const [tenant, appSettingsResult, fitmentCount, productCount, collectionCount, providerCount] =
    await Promise.all([
      getTenant(shopId),
      db
        .from("app_settings")
        .select("*")
        .eq("shop_id", shopId)
        .maybeSingle(),
      db
        .from("vehicle_fitments")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId),
      db
        .from("products")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId),
      db
        .from("collection_mappings")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId),
      db
        .from("providers")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId),
    ]);

  const plan: PlanTier = getEffectivePlan(tenant);
  const limits = getPlanLimits(plan);

  return {
    plan,
    limits,
    allLimits: getSerializedPlanLimits(),
    shopId,
    appSettings: appSettingsResult.data,
    counts: {
      fitments: fitmentCount.count ?? 0,
      products: productCount.count ?? 0,
      collections: collectionCount.count ?? 0,
      providers: providerCount.count ?? 0,
    },
  };
};

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shopId = session.shop;

  const formData = await request.formData();
  const _action = formData.get("_action");

  // ---- Save Settings ----
  if (_action === "save_settings") {
    // Push settings are managed on the Push page — NOT here
    // Collection settings are managed on the Collections page — NOT here
    const hideWatermarkVal = formData.get("hide_watermark") === "true";

    const { data: existing } = await db
      .from("app_settings")
      .select("id")
      .eq("shop_id", shopId)
      .maybeSingle();

    const settingsPayload: Record<string, unknown> = {
      shop_id: shopId,
      hide_watermark: hideWatermarkVal,
      updated_at: new Date().toISOString(),
    };

    if (existing) {
      const { error } = await db
        .from("app_settings")
        .update(settingsPayload)
        .eq("shop_id", shopId);
      if (error)
        return data({ error: "Failed to save settings: " + error.message }, { status: 500 });
    } else {
      const { error } = await db.from("app_settings").insert(settingsPayload);
      if (error)
        return data({ error: "Failed to save settings: " + error.message }, { status: 500 });
    }

    // Sync the hide_watermark setting to a shop-level metafield
    // so Liquid templates can read it at render time (zero-flash watermark control)
    try {
      // Get the shop GID first
      const shopQuery = await admin.graphql(`{ shop { id } }`);
      const shopJson = await shopQuery.json();
      const shopGid = shopJson?.data?.shop?.id;
      if (shopGid) {
        await admin.graphql(`
          mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { id }
              userErrors { message }
            }
          }
        `, {
          variables: {
            metafields: [{
              namespace: "$app:autosync",
              key: "hide_watermark",
              type: "boolean",
              value: String(hideWatermarkVal),
              ownerId: shopGid,
            }],
          },
        });
      }
    } catch (e) {
      // Non-critical — DB setting still works, metafield is for zero-flash only
      console.error("[settings] Failed to sync hide_watermark metafield:", e);
    }

    return data({ success: true, message: "Settings saved successfully" });
  }

  // ---- Delete All Fitment Data (DB only) ----
  if (_action === "delete_fitments") {
    const [{ error: fitmentError }, { error: wheelError }] = await Promise.all([
      db.from("vehicle_fitments").delete().eq("shop_id", shopId),
      db.from("wheel_fitments").delete().eq("shop_id", shopId),
    ]);

    if (fitmentError || wheelError) {
      return data(
        { error: "Failed to delete fitment data: " + (fitmentError?.message ?? wheelError?.message) },
        { status: 500 },
      );
    }

    await db
      .from("products")
      .update({ fitment_status: "unmapped" })
      .eq("shop_id", shopId);

    // Comprehensive post-delete sync: counts, active makes, stale vehicle pages, cleanup jobs
    await syncAfterDelete(shopId);

    return data({
      success: true,
      message: "All fitment data deleted and product statuses reset to unmapped.",
    });
  }

  // ---- Delete All Products from DB ----
  if (_action === "delete_products") {
    // Delete all fitments first (FK dependency), then products
    await Promise.all([
      db.from("vehicle_fitments").delete().eq("shop_id", shopId),
      db.from("wheel_fitments").delete().eq("shop_id", shopId),
    ]);
    const { error } = await db.from("products").delete().eq("shop_id", shopId);
    if (error)
      return data({ error: "Failed to delete products: " + error.message }, { status: 500 });

    // Comprehensive post-delete sync: counts, active makes, stale vehicle pages, cleanup jobs
    await syncAfterDelete(shopId);

    return data({
      success: true,
      message: "All products and fitments deleted from AutoSync database.",
    });
  }

  // ---- Delete All Providers ----
  if (_action === "delete_providers") {
    const { error } = await db.from("providers").delete().eq("shop_id", shopId);
    if (error)
      return data({ error: "Failed to delete providers: " + error.message }, { status: 500 });

    return data({ success: true, message: "All providers deleted." });
  }

  // ---- Remove Tags from Shopify ----
  // ---- Remove Tags / Metafields / Collections from Shopify ----
  // ALL cleanup operations run on Edge Function (NOT Vercel) so they:
  // 1. Don't timeout (Edge has 150s vs Vercel 60s)
  // 2. Continue if user closes the browser
  // 3. Show progress via job polling
  if (_action === "remove_shopify_tags" || _action === "remove_shopify_metafields" || _action === "remove_shopify_collections" || _action === "remove_vehicle_pages") {
    const cleanupType = _action === "remove_shopify_tags" ? "cleanup_tags"
      : _action === "remove_shopify_metafields" ? "cleanup_metafields"
      : _action === "remove_vehicle_pages" ? "delete_vehicle_pages"
      : "cleanup_collections";

    const { data: cleanupJob, error: jobErr } = await db
      .from("sync_jobs")
      .insert({
        shop_id: shopId,
        type: cleanupType,
        status: "running",
        progress: 0,
        total_items: 0,
        processed_items: 0,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (jobErr || !cleanupJob) {
      return data({ error: "Failed to create cleanup job" }, { status: 500 });
    }

    // Fire-and-forget: invoke Edge Function
    triggerEdgeFunction(cleanupJob.id, shopId);

    const label = _action === "remove_shopify_tags" ? "Tag removal"
      : _action === "remove_shopify_metafields" ? "Metafield removal"
      : _action === "remove_vehicle_pages" ? "Vehicle page removal"
      : "Collection removal";

    return data({
      success: true,
      message: `${label} started. Processing in background...`,
    });
  }

  // ---- Full Cleanup — Shopify + DB ----
  if (_action === "full_cleanup") {
    // Check for ANY conflicting job (cleanup, push, or collections)
    const { data: conflictingJob } = await db
      .from("sync_jobs")
      .select("id, type")
      .eq("shop_id", shopId)
      .in("type", ["push", "collections", "cleanup"])
      .in("status", ["running", "pending", "processing"])
      .maybeSingle();

    if (conflictingJob) {
      return data({ error: `Cannot start cleanup while a ${conflictingJob.type} job is running` }, { status: 409 });
    }

    // 1. DB cleanup first (instant)
    await db.from("vehicle_fitments").delete().eq("shop_id", shopId);
    await db.from("wheel_fitments").delete().eq("shop_id", shopId);
    await db.from("collection_mappings").delete().eq("shop_id", shopId);
    await db.from("vehicle_page_sync").delete().eq("shop_id", shopId);
    await db.from("tenant_active_makes").delete().eq("shop_id", shopId);
    await db.from("products").update({ fitment_status: "unmapped", synced_at: null }).eq("shop_id", shopId);
    await db.from("tenants").update({ fitment_count: 0 }).eq("shop_id", shopId);

    // 2. Duplicate job prevention — don't allow simultaneous cleanup jobs
    const { data: existingCleanup } = await db
      .from("sync_jobs")
      .select("id")
      .eq("shop_id", shopId)
      .in("type", ["cleanup", "cleanup_tags", "cleanup_metafields", "cleanup_collections"])
      .in("status", ["pending", "running"])
      .maybeSingle();
    if (existingCleanup) {
      return data({ error: "A cleanup job is already running. Please wait for it to complete." }, { status: 409 });
    }

    // Create Shopify cleanup job for Edge Function
    // Edge Function fetches access_token from tenants table at execution time (no secrets in metadata)
    const { data: cleanupJob } = await db.from("sync_jobs").insert({
      shop_id: shopId,
      type: "cleanup",
      status: "pending",
      progress: 0,
      metadata: {
        phases: ["tags", "metafields", "collections", "vehicle_pages"],
        current_phase: "tags",
      },
    }).select("id").maybeSingle();

    // Fire-and-forget: invoke Edge Function directly (no pg_cron dependency)
    if (cleanupJob) {
      triggerEdgeFunction(cleanupJob.id, shopId);
    }

    return data({
      success: true,
      message: "Database cleaned. Shopify cleanup started in background — removing tags, metafields, collections, and vehicle pages. This may take a few minutes for large stores.",
    });
  }

  // ---- Disconnect Store (Nuclear) ----
  if (_action === "disconnect_store") {
    // Remove from Shopify first (best effort) — tags, metafields, collections, metaobjects
    try {
      await Promise.all([
        removeAllTags(shopId, admin),
        removeAllMetafields(shopId, admin),
        removeAllCollections(shopId, admin),
        deleteVehiclePages(admin, shopId).catch(() => ({ deleted: 0 })),
      ]);
    } catch {
      // Continue even if Shopify cleanup fails
    }

    // Delete all data for this shop (order matters — FK dependencies)
    await db.from("extraction_results").delete().eq("shop_id", shopId);
    await db.from("vehicle_fitments").delete().eq("shop_id", shopId);
    await db.from("vehicle_page_sync").delete().eq("shop_id", shopId);
    await db.from("tenant_active_makes").delete().eq("shop_id", shopId);
    await db.from("collection_mappings").delete().eq("shop_id", shopId);
    await db.from("search_events").delete().eq("shop_id", shopId);
    await db.from("conversion_events").delete().eq("shop_id", shopId);
    await db.from("plate_lookups").delete().eq("shop_id", shopId);
    await db.from("provider_imports").delete().eq("shop_id", shopId);
    await db.from("provider_column_mappings").delete().eq("shop_id", shopId);
    await db.from("app_settings").delete().eq("shop_id", shopId);
    await db.from("products").delete().eq("shop_id", shopId);
    await db.from("providers").delete().eq("shop_id", shopId);
    await db.from("sync_jobs").delete().eq("shop_id", shopId);

    // Mark tenant as uninstalled
    await db
      .from("tenants")
      .update({
        uninstalled_at: new Date().toISOString(),
        plan_status: "cancelled",
      })
      .eq("shop_id", shopId);

    return data({
      success: true,
      message: "Store disconnected. All AutoSync data removed from Shopify and our database.",
    });
  }

  return data({ error: "Unknown action" }, { status: 400 });
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// Collection strategy options moved to Collections page

/** A single danger zone row with a useFetcher submit */
function DangerAction({
  title,
  description,
  buttonLabel,
  actionName,
  modalTitle,
  modalBody,
}: {
  title: string;
  description: string;
  buttonLabel: string;
  actionName: string;
  modalTitle: string;
  modalBody: string;
}) {
  const fetcher = useFetcher();
  const [open, setOpen] = useState(false);
  const isLoading = fetcher.state !== "idle";

  // Show result banner from this specific fetcher
  const result = fetcher.data as { success?: boolean; message?: string; error?: string } | undefined;

  return (
    <>
      {result?.success && (
        <Banner tone="success" onDismiss={() => {}}>
          <p>{result.message}</p>
        </Banner>
      )}
      {result?.error && (
        <Banner tone="critical" onDismiss={() => {}}>
          <p>{result.error}</p>
        </Banner>
      )}
      <Box background="bg-surface-secondary" borderRadius="200" padding="300">
        <BlockStack gap="200">
          <Text as="p" variant="bodyMd" fontWeight="semibold">{title}</Text>
          <Text as="p" variant="bodySm" tone="subdued">{description}</Text>
          <Button tone="critical" size="slim" onClick={() => setOpen(true)} loading={isLoading} fullWidth>
            {buttonLabel}
          </Button>
        </BlockStack>
      </Box>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={modalTitle}
        primaryAction={{
          content: buttonLabel,
          destructive: true,
          loading: isLoading,
          onAction: () => {
            setOpen(false);
            fetcher.submit({ _action: actionName }, { method: "post" });
          },
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setOpen(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="300">
            <Banner tone="critical">
              <p>This action cannot be undone.</p>
            </Banner>
            <Text as="p" variant="bodyMd">
              {modalBody}
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Storefront filter config — all dynamic, no hardcoded plan names
// ---------------------------------------------------------------------------

const STOREFRONT_FILTERS = [
  { name: "Vehicle Make", description: "Filter products by make (e.g. BMW, Ford)", requiredPlans: ["starter", "growth", "professional", "business", "enterprise"], badgeLabel: "Starter+" },
  { name: "Vehicle Model", description: "Filter products by model (e.g. 3 Series, Focus)", requiredPlans: ["growth", "professional", "business", "enterprise"], badgeLabel: "Growth+" },
  { name: "Vehicle Year", description: "Filter products by year range", requiredPlans: ["growth", "professional", "business", "enterprise"], badgeLabel: "Growth+" },
  { name: "Engine / Generation", description: "Filter by engine type or generation", requiredPlans: ["professional", "business", "enterprise"], badgeLabel: "Professional+" },
  { name: "Wheel PCD", description: "Filter wheels by bolt pattern (e.g. 5x112)", requiredPlans: ["business", "enterprise"], badgeLabel: "Business+" },
  { name: "Wheel Diameter", description: "Filter wheels by size (e.g. 18 inch)", requiredPlans: ["business", "enterprise"], badgeLabel: "Business+" },
  { name: "Wheel Width", description: "Filter wheels by width (e.g. 8.5J)", requiredPlans: ["business", "enterprise"], badgeLabel: "Business+" },
  { name: "Wheel Offset", description: "Filter wheels by ET offset", requiredPlans: ["business", "enterprise"], badgeLabel: "Business+" },
  { name: "Wheel Center Bore", description: "Filter wheels by hub center bore", requiredPlans: ["business", "enterprise"], badgeLabel: "Business+" },
];

function isFilterAvailable(plan: string, requiredPlans: string[]): boolean {
  return requiredPlans.includes(plan);
}

export default function Settings() {
  const { plan, limits, allLimits, shopId, appSettings, counts: loaderCounts } = useLoaderData<typeof loader>();

  // Live stats polling — updates data counts every 5 seconds
  const { stats: polledStats } = useAppData({
    total: loaderCounts.products,
    fitments: loaderCounts.fitments,
    collections: loaderCounts.collections,
    providers: loaderCounts.providers,
  });

  const counts = {
    products: polledStats?.total ?? loaderCounts.products,
    fitments: polledStats?.fitments ?? loaderCounts.fitments,
    collections: polledStats?.collections ?? loaderCounts.collections,
    providers: polledStats?.providers ?? loaderCounts.providers,
  };

  const rawActionData = useActionData<typeof action>();
  const actionData = rawActionData as { error?: string; message?: string; success?: boolean } | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Push settings are managed on the Push to Shopify page — not duplicated here
  // Collection settings are managed on the Collections page — not duplicated here

  // Notifications removed — no email service connected. Will add when we integrate a provider.

  // Form state — Widget branding (auto-saves on toggle)
  const [hideWatermark, setHideWatermark] = useState(
    appSettings?.hide_watermark ?? false,
  );
  const settingsFetcher = useFetcher();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    const fd = new FormData();
    fd.set("_action", "save_settings");
    fd.set("hide_watermark", String(hideWatermark));
    settingsFetcher.submit(fd, { method: "POST" });
  }, [hideWatermark]);

  const showSuccess =
    actionData && "success" in actionData && actionData.success;
  const showError = actionData && "error" in actionData;

  return (
    <Page fullWidth title="Settings">
      <BlockStack gap="600">
      <Layout>
        {/* How It Works */}
        <Layout.Section>
          <HowItWorks
            steps={[
              { number: 1, title: "Configure Store", description: "Set up your store connection, plan, and billing preferences" },
              { number: 2, title: "Customize Widgets", description: "Configure YMME search, plate lookup, and compatibility display settings" },
              { number: 3, title: "Manage Data", description: "Import, export, and clean your product and fitment data" },
            ]}
          />
        </Layout.Section>

        {/* Global Banners from save_settings action */}
        {showError && (
          <Layout.Section>
            <Banner tone="critical">
              <p>{actionData?.error}</p>
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

        {/* Widget Branding — auto-saves on toggle */}
        {(limits.features.widgetCustomisation === "full" || limits.features.widgetCustomisation === "full_css") && (
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <InlineStack gap="200" blockAlign="center">
                  <IconBadge icon={ExportIcon} color="var(--p-color-icon-emphasis)" />
                  <Text as="h2" variant="headingMd">Widget Branding</Text>
                </InlineStack>
                <Checkbox
                  label="Hide AutoSync branding on storefront widgets"
                  helpText="Remove the 'Powered by AutoSync' watermark from all widget blocks"
                  checked={hideWatermark}
                  onChange={setHideWatermark}
                />
              </BlockStack>
            </Card>
          </Layout.Section>
        )}

        {/* ─── Storefront Filters ──────────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={SearchIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingMd">
                  Storefront Filters
                </Text>
              </InlineStack>
              <Text as="p" variant="bodyMd" tone="subdued">
                When you push products to Shopify, AutoSync automatically creates vehicle
                metafield definitions. You can then enable these as storefront filters in
                Shopify's Search & Discovery app so customers can filter by vehicle on
                your collection pages.
              </Text>

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  How to enable vehicle filters
                </Text>
                <List type="number">
                  <List.Item>
                    Push your products to Shopify — this creates the vehicle metafield
                    definitions automatically.
                  </List.Item>
                  <List.Item>
                    Go to Shopify Admin &rarr; Apps &rarr; Search & Discovery.
                  </List.Item>
                  <List.Item>
                    Click &quot;Filters&quot; &rarr; &quot;Add filter&quot;.
                  </List.Item>
                  <List.Item>
                    Select the vehicle filters: Vehicle Make, Vehicle Model, Vehicle
                    Year, etc.
                  </List.Item>
                  <List.Item>
                    Save — the filters will appear on your collection pages using your
                    theme&apos;s native filter UI.
                  </List.Item>
                </List>
              </BlockStack>

              <Banner tone="info">
                <p>
                  These filters use Shopify&apos;s native storefront filtering and work
                  automatically with your theme&apos;s built-in filter sidebar — no
                  custom code required.
                </p>
              </Banner>

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Available filters by plan
                </Text>
                <div style={statGridStyle(2)}>
                  {STOREFRONT_FILTERS.map((filter) => {
                    const available = isFilterAvailable(plan, filter.requiredPlans);
                    return (
                      <div key={filter.name} style={statMiniStyle}>
                        <InlineStack gap="200" blockAlign="center" wrap={false}>
                          <IconBadge
                            icon={available ? CheckSmallIcon : LockIcon}
                            color="var(--p-color-icon-emphasis)"
                            size={24}
                          />
                          <BlockStack gap="050">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="p" variant="bodyMd" fontWeight="semibold">{filter.name}</Text>
                              <Badge tone={available ? "info" : undefined} size="small">
                                {available ? "Active" : filter.badgeLabel}
                              </Badge>
                            </InlineStack>
                            <Text as="p" variant="bodySm" tone="subdued">{filter.description}</Text>
                          </BlockStack>
                        </InlineStack>
                      </div>
                    );
                  })}
                </div>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ─── Data Management — Compact Grid Layout ───────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={DatabaseIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingMd">Data Management</Text>
                <Badge tone="info">{`${counts.products} products · ${counts.fitments} fitments · ${counts.collections} collections`}</Badge>
              </InlineStack>

              {/* Shopify Cleanup — 2x2 grid */}
              <Text as="h3" variant="headingSm">Shopify Store Cleanup</Text>
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                <DangerAction title="Tags" description={`Remove _autosync_ tags`} buttonLabel="Remove Tags" actionName="remove_shopify_tags" modalTitle="Remove All Tags?" modalBody="Remove every _autosync_ prefixed tag from your Shopify products." />
                <DangerAction title="Metafields" description={`Remove vehicle metafields`} buttonLabel="Remove Metafields" actionName="remove_shopify_metafields" modalTitle="Remove All Metafields?" modalBody="Delete all vehicle fitment metafields from your Shopify products." />
                <DangerAction title="Collections" description={`Delete smart collections`} buttonLabel="Remove Collections" actionName="remove_shopify_collections" modalTitle="Remove All Collections?" modalBody="Delete all smart collections that AutoSync created from your Shopify store." />
                <DangerAction title="Vehicle Pages" description={`Delete vehicle spec pages`} buttonLabel="Remove Pages" actionName="remove_vehicle_pages" modalTitle="Remove All Vehicle Pages?" modalBody="Delete all vehicle specification pages (metaobjects) from your storefront." />
              </InlineGrid>

              <Divider />

              {/* Database Cleanup — 3-column grid */}
              <InlineStack gap="200" blockAlign="center">
                <Text as="h3" variant="headingSm">Database Cleanup</Text>
                <Badge tone="warning">AutoSync only</Badge>
              </InlineStack>
              <InlineGrid columns={{ xs: 1, sm: 3 }} gap="300">
                <DangerAction title="Fitments" description={`${counts.fitments} fitment mappings`} buttonLabel="Delete Fitments" actionName="delete_fitments" modalTitle="Delete All Fitments?" modalBody="Permanently delete all vehicle fitment mappings and reset products to unmapped." />
                <DangerAction title="Products" description={`${counts.products} products`} buttonLabel="Delete Products" actionName="delete_products" modalTitle="Delete All Products?" modalBody="Delete all products and fitments from AutoSync. Shopify products are NOT affected." />
                <DangerAction title="Providers" description={`${counts.providers} providers`} buttonLabel="Delete Providers" actionName="delete_providers" modalTitle="Delete All Providers?" modalBody="Delete all provider configurations. You will need to re-create them." />
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ─── Danger Zone — compact ──────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={AlertDiamondIcon} bg="var(--p-color-bg-fill-critical-secondary)" color="var(--p-color-icon-critical)" />
                <Text as="h2" variant="headingMd" tone="critical">Danger Zone</Text>
              </InlineStack>
              <InlineGrid columns={{ xs: 1, sm: 2 }} gap="300">
                <DangerAction title="Full Cleanup" description="Shopify + Database — remove all tags, metafields, collections, and fitments" buttonLabel="Full Cleanup" actionName="full_cleanup" modalTitle="Full Cleanup?" modalBody="Remove ALL AutoSync data from Shopify (tags, metafields, collections) AND clear all fitments from the database. Products and providers remain." />
                <DangerAction title="Disconnect Store" description="Remove ALL data — Shopify AND database" buttonLabel="Disconnect Store" actionName="disconnect_store" modalTitle="Disconnect Store?" modalBody="Remove ALL AutoSync data from Shopify and delete ALL data from our database. This cannot be undone." />
              </InlineGrid>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
      </BlockStack>
    </Page>
  );
}


export function ErrorBoundary() {
  return <RouteError pageName="Settings" />;
}
