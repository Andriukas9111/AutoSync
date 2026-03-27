import { useState } from "react";
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
} from "@shopify/polaris";
import {
  ExportIcon,
  PersonIcon,
  DatabaseIcon,
  AlertDiamondIcon,
  SearchIcon,
  LockIcon,
  CheckSmallIcon,
} from "@shopify/polaris-icons";

import { authenticate } from "../shopify.server";
import db from "../lib/db.server";
import { getTenant, getPlanLimits } from "../lib/billing.server";
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

  const plan: PlanTier = tenant?.plan ?? "free";
  const limits = getPlanLimits(plan);

  return {
    plan,
    limits,
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
    const autoPushTags = formData.get("auto_push_tags") === "true";
    const autoPushMetafields = formData.get("auto_push_metafields") === "true";
    const tagPrefix = (formData.get("tag_prefix") as string) || "_autosync_";
    const notificationEmail =
      (formData.get("notification_email") as string) || "";

    // Note: collection_strategy and auto_create_collections are managed
    // on the Collections page only — not duplicated here

    const { data: existing } = await db
      .from("app_settings")
      .select("id")
      .eq("shop_id", shopId)
      .maybeSingle();

    const settingsPayload = {
      shop_id: shopId,
      tag_prefix: tagPrefix,
      push_tags: autoPushTags,
      push_metafields: autoPushMetafields,
      notification_email: notificationEmail || null,
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

    return data({ success: true, message: "Settings saved successfully" });
  }

  // ---- Delete All Fitment Data (DB only) ----
  if (_action === "delete_fitments") {
    const { error: fitmentError } = await db
      .from("vehicle_fitments")
      .delete()
      .eq("shop_id", shopId);

    if (fitmentError) {
      return data(
        { error: "Failed to delete fitment data: " + fitmentError.message },
        { status: 500 },
      );
    }

    await db
      .from("products")
      .update({ fitment_status: "unmapped" })
      .eq("shop_id", shopId);

    return data({
      success: true,
      message: "All fitment data deleted and product statuses reset to unmapped.",
    });
  }

  // ---- Delete All Products from DB ----
  if (_action === "delete_products") {
    // Delete fitments first (FK dependency)
    await db.from("vehicle_fitments").delete().eq("shop_id", shopId);
    const { error } = await db.from("products").delete().eq("shop_id", shopId);
    if (error)
      return data({ error: "Failed to delete products: " + error.message }, { status: 500 });

    // Reset cached counters on tenant
    await db.from("tenants").update({ product_count: 0, fitment_count: 0 }).eq("shop_id", shopId);

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
  if (_action === "remove_shopify_tags") {
    try {
      const result = await removeAllTags(shopId, admin);
      if (result.processed === 0 && result.removed === 0) {
        return data({
          success: true,
          message: "No products with AutoSync tags found. Nothing to remove.",
        });
      }
      return data({
        success: true,
        message: `Removed ${result.removed} AutoSync tags from ${result.processed} products.${result.errors.length > 0 ? ` (${result.errors.length} errors)` : ""}`,
      });
    } catch (err) {
      return data(
        { error: "Failed to remove tags: " + (err instanceof Error ? err.message : String(err)) },
        { status: 500 },
      );
    }
  }

  // ---- Remove Metafields from Shopify ----
  if (_action === "remove_shopify_metafields") {
    try {
      const result = await removeAllMetafields(shopId, admin);
      if (result.processed === 0 && result.removed === 0) {
        return data({
          success: true,
          message: "No products with AutoSync metafields found. Nothing to remove.",
        });
      }
      return data({
        success: true,
        message: `Removed ${result.removed} AutoSync metafields from ${result.processed} products.${result.errors.length > 0 ? ` (${result.errors.length} errors)` : ""}`,
      });
    } catch (err) {
      return data(
        { error: "Failed to remove metafields: " + (err instanceof Error ? err.message : String(err)) },
        { status: 500 },
      );
    }
  }

  // ---- Remove Collections from Shopify ----
  if (_action === "remove_shopify_collections") {
    try {
      const result = await removeAllCollections(shopId, admin);
      return data({
        success: true,
        message: `Deleted ${result.deleted} AutoSync collections from Shopify.${result.errors.length > 0 ? ` (${result.errors.length} errors)` : ""}`,
      });
    } catch (err) {
      return data(
        { error: "Failed to remove collections: " + (err instanceof Error ? err.message : String(err)) },
        { status: 500 },
      );
    }
  }

  // ---- Full Cleanup — Shopify + DB ----
  if (_action === "full_cleanup") {
    // Create a background cleanup job — Edge Function will process in batches
    // This handles stores of ANY size without timing out
    const { data: existingJob } = await db
      .from("sync_jobs")
      .select("id")
      .eq("shop_id", shopId)
      .eq("type", "cleanup")
      .in("status", ["running", "pending", "processing"])
      .maybeSingle();

    if (existingJob) {
      return data({ error: "A cleanup operation is already in progress" }, { status: 409 });
    }

    // 1. DB cleanup first (instant)
    await db.from("vehicle_fitments").delete().eq("shop_id", shopId);
    await db.from("collection_mappings").delete().eq("shop_id", shopId);
    await db.from("vehicle_page_sync").delete().eq("shop_id", shopId);
    await db.from("tenant_active_makes").delete().eq("shop_id", shopId);
    await db.from("products").update({ fitment_status: "unmapped", synced_at: null }).eq("shop_id", shopId);
    await db.from("tenants").update({ fitment_count: 0 }).eq("shop_id", shopId);

    // 2. Create Shopify cleanup job for Edge Function
    // Store the Shopify access token so Edge Function can make API calls
    const { data: tenant } = await db
      .from("tenants")
      .select("shopify_access_token")
      .eq("shop_id", shopId)
      .maybeSingle();

    await db.from("sync_jobs").insert({
      shop_id: shopId,
      type: "cleanup",
      status: "pending",
      progress: 0,
      metadata: {
        phases: ["tags", "metafields", "collections", "vehicle_pages"],
        current_phase: "tags",
        access_token: tenant?.shopify_access_token ?? null,
      },
    });

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
      <InlineStack align="space-between" blockAlign="center" wrap={false}>
        <BlockStack gap="100">
          <Text as="p" variant="bodyMd" fontWeight="semibold">
            {title}
          </Text>
          <Text as="p" variant="bodySm" tone="subdued">
            {description}
          </Text>
        </BlockStack>
        <div style={{ flexShrink: 0 }}>
          <Button tone="critical" onClick={() => setOpen(true)} loading={isLoading}>
            {buttonLabel}
          </Button>
        </div>
      </InlineStack>

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
];

function isFilterAvailable(plan: string, requiredPlans: string[]): boolean {
  return requiredPlans.includes(plan);
}

export default function Settings() {
  const { plan, limits, shopId, appSettings, counts: loaderCounts } = useLoaderData<typeof loader>();

  // Live stats polling — updates data counts every 5 seconds
  const { stats: polledStats } = useAppData();

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

  // Form state — Push Settings (respect plan limits — force OFF if feature not available)
  const [autoPushTags, setAutoPushTags] = useState(
    limits.features.pushTags ? (appSettings?.push_tags ?? false) : false,
  );
  const [autoPushMetafields, setAutoPushMetafields] = useState(
    limits.features.pushMetafields ? (appSettings?.push_metafields ?? false) : false,
  );
  // Tag prefix is locked to "_autosync_" — used system-wide, never user-configurable

  // Form state — Notifications
  const [notificationEmail, setNotificationEmail] = useState(
    appSettings?.notification_email ?? "",
  );

  const showSuccess =
    actionData && "success" in actionData && actionData.success;
  const showError = actionData && "error" in actionData;

  return (
    <Page fullWidth title="Settings">
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

        {/* Main Settings Form */}
        <Layout.Section>
          <Form method="post">
            <input type="hidden" name="_action" value="save_settings" />
            <input type="hidden" name="auto_push_tags" value={String(autoPushTags)} />
            <input
              type="hidden"
              name="auto_push_metafields"
              value={String(autoPushMetafields)}
            />
            <input type="hidden" name="tag_prefix" value="_autosync_" />
            {/* Collection settings managed on Collections page */}
            <input type="hidden" name="notification_email" value={notificationEmail} />

            <BlockStack gap="500">
              {/* Push Settings */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={ExportIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">
                      Push Settings
                    </Text>
                  </InlineStack>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Configure how fitment data is pushed to your Shopify store.
                  </Text>
                  <FormLayout>
                    <Checkbox
                      label="Auto-push tags on fitment mapping"
                      helpText="Automatically push _autosync_ tags to Shopify when a product is mapped"
                      checked={autoPushTags}
                      onChange={setAutoPushTags}
                    />
                    <Checkbox
                      label="Auto-push metafields on fitment mapping"
                      helpText="Automatically set app-owned vehicle metafields on products"
                      checked={autoPushMetafields}
                      onChange={setAutoPushMetafields}
                    />
                    <Text as="p" variant="bodySm" tone="subdued">
                      Tag prefix: <Text as="span" fontWeight="semibold">_autosync_</Text> (e.g. _autosync_BMW). This prefix is used system-wide and cannot be changed.
                    </Text>
                  </FormLayout>
                </BlockStack>
              </Card>

              {/* Collection settings are on the Collections page — no duplication */}

              {/* Notifications */}
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="200" blockAlign="center">
                    <IconBadge icon={PersonIcon} color="var(--p-color-icon-emphasis)" />
                    <Text as="h2" variant="headingMd">
                      Notifications
                    </Text>
                  </InlineStack>
                  <FormLayout>
                    <TextField
                      label="Notification email"
                      type="email"
                      value={notificationEmail}
                      onChange={setNotificationEmail}
                      helpText="Receive notifications for sync completions and errors"
                      autoComplete="email"
                      placeholder="you@example.com"
                    />
                  </FormLayout>
                </BlockStack>
              </Card>

              <InlineStack align="start">
                <Button variant="primary" submit loading={isSubmitting}>
                  Save Settings
                </Button>
              </InlineStack>
            </BlockStack>
          </Form>
        </Layout.Section>

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
                          <div style={{
                            width: 24, height: 24, borderRadius: 6,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            backgroundColor: available
                              ? "var(--p-color-bg-fill-success-secondary)"
                              : "var(--p-color-bg-fill-critical-secondary)",
                            flexShrink: 0,
                          }}>
                            <Icon source={available ? CheckSmallIcon : LockIcon} tone={available ? "success" : "critical"} />
                          </div>
                          <BlockStack gap="050">
                            <InlineStack gap="200" blockAlign="center">
                              <Text as="p" variant="bodyMd" fontWeight="semibold">{filter.name}</Text>
                              <Badge tone={available ? "success" : "info"} size="small">
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

        {/* ─── Data Management ─────────────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={DatabaseIcon} color="var(--p-color-icon-emphasis)" />
                <Text as="h2" variant="headingMd">
                  Data Management
                </Text>
              </InlineStack>
              <Text as="p" variant="bodyMd" tone="subdued">
                Current data: {counts.products} products, {counts.fitments} fitments,{" "}
                {counts.collections} collections, {counts.providers} providers.
              </Text>

              <Divider />

              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Shopify Store Cleanup
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Remove data that AutoSync pushed to your Shopify store. This does not
                  delete data from AutoSync&apos;s database.
                </Text>
              </BlockStack>

              <DangerAction
                title="Remove All AutoSync Tags"
                description="Remove all _autosync_ prefixed tags from your Shopify products."
                buttonLabel="Remove Tags"
                actionName="remove_shopify_tags"
                modalTitle="Remove All AutoSync Tags?"
                modalBody="This will scan all your products and remove every tag starting with _autosync_. Your products will no longer be grouped by smart collections based on these tags."
              />

              <Divider />

              <DangerAction
                title="Remove All AutoSync Metafields"
                description="Remove all autosync_fitment.* metafields from your Shopify products."
                buttonLabel="Remove Metafields"
                actionName="remove_shopify_metafields"
                modalTitle="Remove All AutoSync Metafields?"
                modalBody="This will delete all vehicle fitment metafields (autosync_fitment.*) from your Shopify products. Storefront widgets will stop showing vehicle data until you re-push."
              />

              <Divider />

              <DangerAction
                title="Remove All AutoSync Collections"
                description="Delete all smart collections created by AutoSync from your Shopify store."
                buttonLabel="Remove Collections"
                actionName="remove_shopify_collections"
                modalTitle="Remove All AutoSync Collections?"
                modalBody="This will delete all smart collections that AutoSync created from your Shopify store. Your collection mappings in AutoSync will also be cleared."
              />

              <Divider />

              <Banner tone="warning">
                <Text as="p" variant="bodySm" fontWeight="semibold">
                  Database cleanup — removes data from AutoSync only. Your Shopify store is not affected.
                </Text>
              </Banner>

              <DangerAction
                title="Delete All Fitment Data"
                description={`Remove all ${counts.fitments} vehicle fitment mappings and reset products to unmapped.`}
                buttonLabel="Delete Fitments"
                actionName="delete_fitments"
                modalTitle="Delete All Fitment Data?"
                modalBody="This will permanently delete all vehicle fitment mappings and reset all product statuses to unmapped. Products, providers, and settings remain intact."
              />

              <Divider />

              <DangerAction
                title="Delete All Products"
                description={`Remove all ${counts.products} products and their fitments from AutoSync's database.`}
                buttonLabel="Delete Products"
                actionName="delete_products"
                modalTitle="Delete All Products?"
                modalBody="This will permanently delete all products and their fitment mappings from AutoSync's database. Your Shopify products are NOT affected — only our internal records. You can re-sync products from Shopify at any time."
              />

              <Divider />

              <DangerAction
                title="Delete All Providers"
                description={`Remove all ${counts.providers} data providers.`}
                buttonLabel="Delete Providers"
                actionName="delete_providers"
                modalTitle="Delete All Providers?"
                modalBody="This will permanently delete all provider configurations. You will need to re-create them to import fitment data."
              />
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* ─── Danger Zone ─────────────────────────────────────────── */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="200" blockAlign="center">
                <IconBadge icon={AlertDiamondIcon} bg="var(--p-color-bg-fill-critical-secondary)" color="var(--p-color-icon-critical)" />
                <Text as="h2" variant="headingMd" tone="critical">
                  Danger Zone
                </Text>
                <Badge tone="critical">Destructive</Badge>
              </InlineStack>

              <Divider />

              <DangerAction
                title="Full Cleanup — Shopify + Database"
                description="Remove all AutoSync tags, metafields, and collections from Shopify AND clear all fitment data from our database."
                buttonLabel="Full Cleanup"
                actionName="full_cleanup"
                modalTitle="Full Cleanup — Shopify + Database?"
                modalBody="This will: (1) Remove all _autosync_ tags from Shopify products, (2) Delete all autosync_fitment metafields, (3) Delete all AutoSync smart collections, (4) Clear all fitment mappings from our database. Products and providers remain intact."
              />

              <Divider />

              <DangerAction
                title="Disconnect Store"
                description="Remove ALL AutoSync data — from Shopify AND our database. Deletes products, fitments, providers, collections, settings — everything."
                buttonLabel="Disconnect Store"
                actionName="disconnect_store"
                modalTitle="Disconnect Store — Remove Everything?"
                modalBody="This is the nuclear option. It will remove ALL AutoSync data from your Shopify store (tags, metafields, collections) AND delete ALL data from our database (products, fitments, providers, settings, sync history). Your tenant will be marked as uninstalled."
              />
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
